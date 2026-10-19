import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobError,BlobAccessError,BlobStoreSuspendedError } from '@vercel/blob';
import { createBlobStore } from '../src/server/admin/blob.mjs';
import { AdminError } from '../src/server/admin/auth.mjs';
import { emptyAdminState } from '../src/server/admin/state.mjs';
import { createInstagramQueueHandler,instagramQueueRetry } from '../src/server/instagram/queue-handler.mjs';
import { processInstagramTick } from '../src/server/instagram/runtime.mjs';
import { inspectVercel } from '../scripts/admin/inspect-vercel.mjs';
import { handleAdminRequest } from '../src/server/admin/service.mjs';

test('a blocked private download preserves data and reports a safe error instead of an empty queue',async()=>{
  const env={ADMIN_BLOB_READ_WRITE_TOKEN:'PLACEHOLDER_FOR_OFFLINE_TEST'};let reads=0;let probes=0;
  const sdk={get:async()=>{reads++;throw new BlobError('Failed to fetch blob: 403 Forbidden');},head:async()=>({url:'https://example.private.blob.vercel-storage.com/queue/admin-state.json'}),put:async()=>assert.fail('must not reset unreadable state')};
  const store=createBlobStore(env,sdk,async(url,options)=>{probes++;assert.equal(options.headers.Authorization,`Bearer ${env.ADMIN_BLOB_READ_WRITE_TOKEN}`);assert.equal(new URL(url).search,'');assert.equal(options.redirect,'error');return new Response('Your store is blocked',{status:403});});
  await assert.rejects(store.load(),{code:'PRIVATE_STORAGE_BLOCKED'});
  await assert.rejects(store.mutate(state=>{state.candidates=[];}),{code:'PRIVATE_STORAGE_BLOCKED'});
  assert.equal(reads,1);assert.equal(probes,1);
});
test('a 403 probe never forwards credentials to an untrusted metadata URL',async()=>{
  const store=createBlobStore({ADMIN_BLOB_READ_WRITE_TOKEN:'PLACEHOLDER_FOR_OFFLINE_TEST'},{get:async()=>{throw new BlobAccessError();},head:async()=>({url:'https://attacker.example/file'})},async()=>assert.fail('credential must not leave private Blob'));
  await assert.rejects(store.load(),{code:'PRIVATE_STORAGE_ACCESS_DENIED'});
});
test('suspended writes stay distinguishable from transient storage failures',async()=>{
  const store=createBlobStore({}, {get:async()=>null,put:async()=>{throw new BlobStoreSuspendedError();}});
  await assert.rejects(store.putJson('queue/test.json',{version:1}),{code:'PRIVATE_STORAGE_BLOCKED'});
});
test('unchanged private records do not consume a write or erase entity tags',async()=>{
  const state=emptyAdminState();let writes=0;
  const sdk={get:async()=>({stream:new Response(JSON.stringify(state)).body,blob:{size:1024,etag:'"version"'}}),put:async()=>{writes++;}};
  const store=createBlobStore({},sdk);await store.mutate(()=>{});await store.mutateJson('queue/test.json',value=>value);await store.putJson('queue/test.json',state);assert.equal(writes,0);
  await store.mutate(value=>{value.sources[0].enabled=false;});assert.equal(writes,1);
});
test('storage failure prevents Meta calls and remains a durable hourly retry',async()=>{
  const error=new AdminError('PRIVATE_STORAGE_BLOCKED',503);let ticks=0;
  const handler=createInstagramQueueHandler(async()=>{ticks++;return processInstagramTick({env:{INSTAGRAM_PUBLISHING_RUNTIME:'vercel',INSTAGRAM_ACCESS_TOKEN:'PLACEHOLDER_FOR_OFFLINE_TEST'},store:{readJson:async()=>{throw error;}},graph:{verifyAccount:async()=>assert.fail('cannot post without checkpoint access')},fetchImpl:async()=>assert.fail('must not migrate unreadable history')});});
  await assert.rejects(handler({version:1},{messageId:'incoming'}),problem=>problem===error);
  assert.deepEqual(instagramQueueRetry(error,{deliveryCount:20}),{afterSeconds:3600});assert.equal(ticks,1);
  assert.deepEqual(instagramQueueRetry(new Error(),{deliveryCount:1}),{afterSeconds:300});
  assert.deepEqual(instagramQueueRetry(new Error(),{deliveryCount:20}),{afterSeconds:3600});
});
test('protected status explicitly reports a paused publisher when storage is blocked',async()=>{
  const env={ADMIN_WORKER_SECRET:'PLACEHOLDER_FOR_OFFLINE_TEST'.repeat(2)};
  const request=new Request('https://example.test/api/admin/worker/instagram/status/',{method:'POST',headers:{Authorization:`Bearer ${env.ADMIN_WORKER_SECRET}`},body:'{}'});
  const response=await handleAdminRequest(request,{env,store:{readJson:async()=>{throw new AdminError('PRIVATE_STORAGE_BLOCKED',503);}}});
  assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);const result=await response.json();assert.equal(result.status.mode,'paused');assert.equal(result.status.code,'PRIVATE_STORAGE_BLOCKED');assert.equal(result.published,null);assert.equal(result.migrated,null);
});
test('Vercel inspection reports only approved fields and validates the target before reading its stores',async()=>{
  const env={GITHUB_REPOSITORY:'todoscomlula/site',ADMIN_VERCEL_TOKEN:'PLACEHOLDER_FOR_OFFLINE_TEST',VERCEL_PROJECT_ID:'prj_example',VERCEL_ORG_ID:'team_example'};
  const paths=[];const fetchImpl=async(url,options)=>{paths.push(new URL(url).pathname);assert.equal(options.headers.Authorization,`Bearer ${env.ADMIN_VERCEL_TOKEN}`);return Response.json(url.includes('/v9/projects/')?{id:env.VERCEL_PROJECT_ID,name:'todos-com-lula',secret:env.ADMIN_VERCEL_TOKEN}:url.includes('/storage/stores')?{stores:[{id:'store_example',type:'blob',status:'limits-exceeded-suspended',billingState:'suspended',usageQuotaExceeded:true,token:env.ADMIN_VERCEL_TOKEN}]}:{billing:{plan:'hobby'},featureBlocks:{blob:{blockedFrom:'2026-10-18T12:00:00Z',blockedUntil:'2026-11-18T12:00:00Z'}}});};
  const report=await inspectVercel({env,fetchImpl,store:{load:async()=>{throw new AdminError('PRIVATE_STORAGE_BLOCKED',503);}}});
  assert.equal(report.authorized,true);assert.equal(report.stores[0].usageQuotaExceeded,true);assert.equal(report.blobBlock.blockedUntil,'2026-11-18T12:00:00.000Z');assert.equal(JSON.stringify(report).includes(env.ADMIN_VERCEL_TOKEN),false);
  const wrong=await inspectVercel({env,fetchImpl:async()=>Response.json({id:'other',name:'other'}),store:{load:async()=>emptyAdminState()}});assert.equal(wrong.authorized,false);assert.equal(wrong.stores,undefined);
});
