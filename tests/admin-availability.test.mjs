import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { configureAdminFirewall,loginFirewallRule } from '../scripts/admin/configure-admin-firewall.mjs';
import { handleAdminRequest } from '../src/server/admin/service.mjs';
import { AdminError,hashPassword,readSession,createSession,SESSION_COOKIE } from '../src/server/admin/auth.mjs';
import { createInstagramQueueHandler } from '../src/server/instagram/queue-handler.mjs';

test('verified Vercel firewall protects login without requiring private Blob access',async()=>{
  const password=randomBytes(20).toString('hex');
  const env={VERCEL:'1',ADMIN_LOGIN_RATE_LIMIT_MODE:'vercel-firewall',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:hashPassword(password),ADMIN_SESSION_SECRET:randomBytes(48).toString('hex')};
  let storageCalls=0;const store={checkLoginRate:async()=>{storageCalls++;throw new AdminError('PRIVATE_STORAGE_BLOCKED',503);}};
  const request=value=>new Request('https://example.test/api/admin/login/',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:value})});
  const response=await handleAdminRequest(request(password),{env,store});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  const session=readSession(new Request('https://example.test/admin/',{headers:{cookie:response.headers.get('set-cookie')}}),env);assert.equal(session.email,env.ADMIN_EMAIL);
  assert.equal((await handleAdminRequest(request('invalid'),{env,store})).status,401);assert.equal(storageCalls,0);
  // The environment setting alone cannot remove the limiter in local/preview hosts.
  assert.equal((await handleAdminRequest(request(password),{env:{...env,VERCEL:undefined},store})).status,503);assert.equal(storageCalls,1);
});

test('firewall setup preserves existing rules and enables storage-independent login only after verification',async()=>{
  const env={GITHUB_REPOSITORY:'todoscomlula/site',ADMIN_VERCEL_TOKEN:'PLACEHOLDER_FOR_OFFLINE_TEST',VERCEL_PROJECT_ID:'prj_example',VERCEL_ORG_ID:'team_example'};
  const unrelated={name:'Existing rule',id:'existing',active:true};let active={firewallEnabled:true,rules:[unrelated]};let enabled=false;const methods=[];
  const fetchImpl=async(url,options)=>{
    methods.push(options.method);assert.equal(options.headers.Authorization,`Bearer ${env.ADMIN_VERCEL_TOKEN}`);
    if(url.includes('/v9/projects/'))return Response.json({id:env.VERCEL_PROJECT_ID,name:'todos-com-lula'});
    if(url.includes('/env?')){const values=JSON.parse(options.body);assert.equal(values[0].key,'ADMIN_LOGIN_RATE_LIMIT_MODE');assert.ok(active.rules.some(rule=>rule.name===loginFirewallRule.name));enabled=true;return Response.json({});}
    if(options.method==='GET')return Response.json(active);
    assert.equal(options.method,'PATCH');const change=JSON.parse(options.body);assert.equal(change.action,'rules.insert');active={...active,rules:[...active.rules,{id:'login',...change.value}]};return Response.json({});
  };
  const result=await configureAdminFirewall({env,fetchImpl});assert.equal(result.configured,true);assert.equal(enabled,true);assert.deepEqual(active.rules[0],unrelated);assert.equal(methods.includes('PUT'),false);assert.equal(JSON.stringify(result).includes(env.ADMIN_VERCEL_TOKEN),false);
  enabled=false;active.rules=[unrelated];await assert.rejects(configureAdminFirewall({env,fetchImpl:async(url,options)=>options.method==='PATCH'?new Response('{}',{status:403}):fetchImpl(url,options)}),{message:'FIREWALL_CONFIGURATION_FAILED_403'});assert.equal(enabled,false);
});

test('blocked storage leaves the public archive readable without pretending the private queue is empty',async()=>{
  const env={ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:hashPassword(randomBytes(20).toString('hex')),ADMIN_SESSION_SECRET:randomBytes(48).toString('hex')};
  const request=new Request('https://example.test/api/admin/dashboard/',{headers:{cookie:`${SESSION_COOKIE}=${createSession(env)}`}});let writes=0;
  const unavailable=async()=>{throw new AdminError('PRIVATE_STORAGE_BLOCKED',503);};
  const response=await handleAdminRequest(request,{env,store:{load:unavailable,readJson:unavailable,mutate:async()=>{writes++;}},fetchImpl:async url=>Response.json(String(url).includes('raw.githubusercontent.com')?{account:'boraaalula2026',published:[]}:[{id:'sample',title:'Public archive',source:'lulaoficial',kind:'video',imageUrl:'/cover.jpg',url:'/conteudo/sample/'}])});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.availability.readOnly,true);assert.equal(result.counts.pending,null);assert.equal(result.counts.queued,null);assert.equal(result.counts.instagram,null);assert.equal(result.archive.length,1);assert.equal(result.archive[0].instagramPublished,null);assert.equal(writes,0);
});

test('blocked deliveries are acknowledged only after a durable replacement and coalesce their retry key',async()=>{
  const messages=[];const events=[];const failure=new AdminError('PRIVATE_STORAGE_BLOCKED',503);
  const processTick=async()=>{throw failure;};const handler=createInstagramQueueHandler(processTick,{reschedule:async value=>messages.push(value),report:value=>events.push(value),now:()=>1000000});
  const result=await handler({version:1},{messageId:'first'});await handler({version:1},{messageId:'second'});
  assert.equal(result.mode,'paused');assert.equal(result.code,'PRIVATE_STORAGE_BLOCKED');assert.equal(messages[0].delaySeconds,3600);assert.equal(messages[0].idempotencyKey,messages[1].idempotencyKey);assert.equal(events.length,2);
  const unavailable=createInstagramQueueHandler(processTick,{reschedule:async()=>{throw new Error('INSTAGRAM_QUEUE_UNAVAILABLE');},report:()=>assert.fail('must not acknowledge without durable retry')});
  await assert.rejects(unavailable({version:1},{messageId:'first'}),{message:'INSTAGRAM_QUEUE_UNAVAILABLE'});
});
