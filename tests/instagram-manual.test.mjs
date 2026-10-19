import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState,validateState,contentKey,makeCaption,PublishingError } from '../scripts/instagram-publishing/core.mjs';
import { manualInstagram,selectManualPosts,findExistingManualPosts,DEBATE_POST_IDS } from '../scripts/instagram-manual.mjs';
import { readManualHistory,mergeManualHistory } from '../scripts/instagram-publishing/manual-history.mjs';
import { AdminError } from '../src/server/admin/auth.mjs';

const site=new URL('https://todos-com-lula.vercel.app');
const posts=DEBATE_POST_IDS.map((id,index)=>({id,contentGroupId:id,source:'ptbrasil',sourceName:'PT Brasil',sourceUrl:'https://www.instagram.com/ptbrasil/reels/',kind:'video',mediaUrl:`/media/instagram/ptbrasil/aaaaaaaaaaa${index}.mp4`,title:'Trecho do debate na Band',publicationCaption:'Trecho compartilhado pelo perfil de origem.',publicationHashtags:['DebateNaBand','ptbrasil','Reels'],mentionProfiles:['lulaoficial','uneoficial','andrejanones','seremosresistencia','brasilcomlula'],reviewApprovedAt:new Date().toISOString()}));
const proof=(post,id='123')=>({postId:post.id,contentHash:contentKey(post),mediaId:id,publishedAt:new Date().toISOString()});

test('manual publishing accepts only the three recent reviewed debate videos',()=>{
  assert.equal(selectManualPosts(posts).length,3);
  assert.throws(()=>selectManualPosts(posts,['unreviewed']),{code:'INVALID_MANUAL_BATCH'});
  assert.throws(()=>selectManualPosts(posts.map(post=>({...post,reviewApprovedAt:'2020-01-01T00:00:00.000Z'}))),{code:'MANUAL_BATCH_NOT_APPROVED'});
});
test('media lookup follows only a cursor on the verified account and recovers exact public post links',async()=>{
  const requests=[];const graph={userId:'123',request:async(path,options)=>{requests.push({path,options});return requests.length===1?{data:[],paging:{next:'https://untrusted.example/',cursors:{after:'opaque-cursor'}}}:{data:[{id:'456',caption:makeCaption(posts[0],site),timestamp:new Date().toISOString(),permalink:'https://www.instagram.com/reel/Test123/'}]};}};
  const matched=await findExistingManualPosts(graph,[posts[0]],site);assert.equal(matched[0].mediaId,'456');assert.equal(requests[1].path,'123/media');assert.equal(requests[1].options.query.after,'opaque-cursor');assert.equal(JSON.stringify(requests).includes('untrusted'),false);
});
test('unavailable manual history never turns into an empty successful checkpoint',async()=>{
  assert.deepEqual(await readManualHistory({fetchImpl:async()=>new Response(null,{status:404})}),emptyState());
  await assert.rejects(readManualHistory({fetchImpl:async()=>new Response(null,{status:503})}),{code:'MANUAL_HISTORY_UNAVAILABLE'});
  await assert.rejects(readManualHistory({fetchImpl:async()=>Response.json({...emptyState(),token:'PLACEHOLDER_FOR_OFFLINE_TEST'})}),{code:'INVALID_MANUAL_HISTORY'});
});
test('reconciliation preserves native history, deduplicates manual confirmations and blocks active or conflicting work',()=>{
  const native=emptyState();native.published=[proof(posts[0])];const manual=emptyState();manual.published=[proof(posts[1],'456')];
  const merged=mergeManualHistory(native,manual);assert.equal(merged.published.length,2);assert.equal(native.published.length,1);assert.deepEqual(mergeManualHistory(merged,manual),merged);
  manual.pending={postId:posts[2].id,contentHash:contentKey(posts[2]),containerId:'789',stage:'publishing',createdAt:new Date().toISOString()};assert.throws(()=>mergeManualHistory(native,manual),{code:'MANUAL_PUBLISHING_ACTIVE'});
  manual.pending=null;manual.published=[proof(posts[0],'999')];assert.throws(()=>mergeManualHistory(native,manual),{code:'MANUAL_PUBLISHING_CONFLICT'});
});

function fixture({existing=0,blocked=true,guard=true,state=emptyState(),publishError}={}){
  let saved=structuredClone(state);const media=posts.slice(0,existing).map((post,index)=>({id:String(800+index),caption:makeCaption(post,site),timestamp:new Date().toISOString(),permalink:`https://www.instagram.com/reel/Existing${index}/`}));let published=0;let created=0;const events=[];let activePost;
  const store={load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(validateState(value));}};
  const graph={userId:'123',verifyAccount:async()=>({username:'boraaalula2026'}),quota:async()=>({used:0,maximum:100}),request:async()=>({data:media}),createContainer:async candidate=>{assert.equal(saved.pending.stage,'reserved');activePost=candidate.post;created++;return String(1000+created);},containerStatus:async()=> 'FINISHED',publishContainer:async()=>{assert.equal(saved.pending.stage,'publishing');if(publishError)throw publishError;published++;const id=String(2000+published);media.push({id,caption:makeCaption(activePost,site),timestamp:new Date().toISOString(),permalink:`https://www.instagram.com/reel/Published${published}/`});return id;}};
  const options={env:{ADMIN_WORKER_SECRET:'PLACEHOLDER_FOR_OFFLINE_TEST'.repeat(2)},graph,store,publish:true,log:event=>events.push(event),blobStore:{load:async()=>{if(blocked)throw new AdminError('PRIVATE_STORAGE_BLOCKED',503);return{};}},fetchImpl:async(url,options)=>options?.method==='HEAD'?new Response(null,{headers:{'content-type':'video/mp4','content-length':'1234'}}):String(url).includes('/api/admin/')?Response.json({manualLedger:guard,manualHold:guard}):Response.json(posts)};
  return{options,events,get state(){return saved;},get published(){return published;},get created(){return created;}};
}
test('manual batch skips an existing Instagram post and durably confirms only the remaining selected clips',async()=>{
  const f=fixture({existing:1});const result=await manualInstagram(f.options);assert.equal(result.confirmed,3);assert.equal(f.published,2);assert.equal(f.created,2);assert.equal(f.state.published.length,3);assert.equal(f.state.pending,null);assert.equal(f.state.lease,null);
});
test('manual batch refuses a healthy native runtime or an undeployed reconciliation guard',async()=>{
  const healthy=fixture({blocked:false});await assert.rejects(manualInstagram(healthy.options),{code:'NATIVE_RUNTIME_AVAILABLE_USE_VERCEL'});assert.equal(healthy.created,0);
  const missing=fixture({guard:false});await assert.rejects(manualInstagram(missing.options),{code:'MANUAL_GUARD_NOT_DEPLOYED'});assert.equal(missing.created,0);
});
test('manual recovery never resends an interrupted publish request',async()=>{
  const f=fixture({publishError:new PublishingError('META_REQUEST_INTERRUPTED')});await assert.rejects(manualInstagram(f.options),{code:'META_REQUEST_INTERRUPTED'});assert.equal(f.state.pending.stage,'publishing');assert.equal(f.created,1);
  await assert.rejects(manualInstagram(f.options),{code:'PUBLISHING_RESULT_UNCERTAIN'});assert.equal(f.created,1);
});
