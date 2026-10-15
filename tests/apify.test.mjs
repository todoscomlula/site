import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApifyCollector, collectorConfiguration, instagramMediaUrl, normalizeReels, stageApifyReels } from '../scripts/admin/apify.mjs';

const instant=Date.parse('2026-10-15T12:00:00Z');
const now=()=>instant;
const runId='Run12345678901234';const datasetId='Data1234567890123';
const reel={ownerUsername:'lulaoficial',url:'https://www.instagram.com/reel/ABC123/',caption:'Descrição original do vídeo.',timestamp:new Date(instant-86400000).toISOString(),videoUrl:'https://scontent.cdninstagram.com/video.mp4?signature=private'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function memoryStore(entries={}){const data=new Map(Object.entries(entries));return {data,readJson:async path=>structuredClone(data.get(path)||null),putJson:async(path,value)=>data.set(path,structuredClone(value))};}
const env={APIFY_API_TOKEN:randomBytes(24).toString('hex'),COLLECTION_PROVIDER:'apify'};
const success=()=>json({data:{id:runId,status:'SUCCEEDED',defaultDatasetId:datasetId}});

test('cloud collection requires a protected key and emits configuration without the key',async()=>{
  const store=memoryStore();let calls=0;
  await assert.rejects(createApifyCollector({env:{COLLECTION_PROVIDER:'apify'},store,fetchImpl:async()=>{calls++;}}).collect('lulaoficial'),{code:'APIFY_NOT_CONFIGURED'});
  assert.equal(calls,0);assert.equal(store.data.size,0);
  const configuration=collectorConfiguration(env);assert.equal(configuration.provider,'apify');assert.equal(configuration.configured,true);assert.equal(JSON.stringify(configuration).includes(env.APIFY_API_TOKEN),false);
});

test('API authentication stays in headers and paid runs have cost and feature limits',async()=>{
  const store=memoryStore();let starts=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(url.origin,'https://api.apify.com');assert.equal(url.searchParams.has('token'),false);assert.equal(options.headers.Authorization,`Bearer ${env.APIFY_API_TOKEN}`);assert.equal(options.redirect,'error');
    if(options.method==='POST'){
      starts++;assert.equal(url.searchParams.get('maxTotalChargeUsd'),'0.02');assert.equal(url.searchParams.get('maxItems'),'2');assert.equal(url.searchParams.get('timeout'),'180');
      const input=JSON.parse(options.body);assert.deepEqual(input.username,['lulaoficial']);assert.equal(input.resultsLimit,2);assert.equal(input.includeDownloadedVideo,false);assert.equal(input.includeTranscript,false);assert.equal(input.includeSharesCount,false);assert.equal(input.skipPinnedPosts,true);
      assert.equal(store.data.get('queue/apify-budget.json').reservedCents,2);assert.equal(store.data.get('queue/apify-runs/lulaoficial.json').id,null);
      return json({data:{id:runId}});
    }
    return url.pathname.includes('datasets')?json([reel]):success();
  };
  const collector=createApifyCollector({env,store,fetchImpl,now});
  const first=await collector.collect('lulaoficial');assert.equal(first.reels.length,1);
  // A crash before completion retrieves the same run without a second charge.
  const retry=await collector.collect('lulaoficial');assert.equal(starts,1);assert.equal(retry.reels[0].permalink,reel.url);
  await first.complete();assert.equal(store.data.get('queue/apify-runs/lulaoficial.json').consumed,true);
  assert.equal(JSON.stringify([...store.data.values()]).includes(env.APIFY_API_TOKEN),false);
});

test('a lost start response never submits a second paid run automatically',async()=>{
  const store=memoryStore();let starts=0;
  const collector=createApifyCollector({env,store,now,fetchImpl:async()=>{starts++;throw new Error('upstream request contains private data');}});
  await assert.rejects(collector.collect('lulaoficial'),{code:'APIFY_UNAVAILABLE'});
  await assert.rejects(collector.collect('lulaoficial'),{code:'APIFY_START_UNCERTAIN'});
  assert.equal(starts,1);assert.equal(store.data.get('queue/apify-budget.json').reservedCents,2);
});

test('the monthly safety budget stops new calls and resets only in a new UTC month',async()=>{
  const store=memoryStore({'queue/apify-budget.json':{month:'2026-10',reservedCents:400}});let calls=0;
  const fetchImpl=async(url,options)=>{calls++;return options.method==='POST'?json({data:{id:runId}}):url.pathname.includes('datasets')?json([]):success();};
  await assert.rejects(createApifyCollector({env,store,fetchImpl,now}).collect('lulaoficial'),{code:'APIFY_BUDGET_REACHED'});assert.equal(calls,0);
  await createApifyCollector({env,store,fetchImpl,now:()=>Date.parse('2026-11-01T00:00:00Z')}).collect('lulaoficial');assert.equal(store.data.get('queue/apify-budget.json').reservedCents,2);
});

test('invalid credentials and rate limits expose only stable error codes',async()=>{
  for(const [status,code]of [[401,'APIFY_INVALID_KEY'],[402,'APIFY_CREDITS_REQUIRED'],[429,'APIFY_RATE_LIMIT']]){
    const store=memoryStore();await assert.rejects(createApifyCollector({env,store,now,fetchImpl:async()=>new Response('private upstream message',{status})}).collect('lulaoficial'),{code});
    assert.equal(store.data.get('queue/apify-runs/lulaoficial.json').consumed,true);
  }
});

test('pending and failed runs are distinguished and successful results require the saved run ID',async()=>{
  const path='queue/apify-runs/lulaoficial.json';
  for(const [status,code,consumed]of [['RUNNING','APIFY_RUN_PENDING',false],['FAILED','APIFY_RUN_FAILED',true]]){
    const store=memoryStore({[path]:{id:runId,consumed:false}});
    await assert.rejects(createApifyCollector({env,store,now,wait:async()=>{},fetchImpl:async()=>json({data:{id:runId,status}})}).collect('lulaoficial'),{code});assert.equal(store.data.get(path).consumed,consumed);
  }
  await assert.rejects(createApifyCollector({env,store:memoryStore({[path]:{id:runId,consumed:false}}),now,fetchImpl:async()=>json({data:{id:'Different12345678',status:'SUCCEEDED',defaultDatasetId:datasetId}})}).collect('lulaoficial'),{code:'INVALID_COLLECTION_RESULT'});
});

test('only recent videos from the requested profile are imported, with canonical attribution',()=>{
  const items=[{...reel,ownerUsername:'unrelated'}, {...reel,timestamp:'2020-01-01'}, {...reel,timestamp:'not a date'}, {...reel,url:'https://evil.test/reel/ABC123/'},reel,reel];
  const output=normalizeReels(items,'lulaoficial',instant);assert.equal(output.length,1);assert.equal(output[0].caption,reel.caption);assert.equal(output[0].source,'lulaoficial');assert.equal(output[0].permalink,reel.url);
  assert.throws(()=>normalizeReels([{error:'private provider error'}],'lulaoficial',instant),{code:'APIFY_SOURCE_UNAVAILABLE'});
});

test('signed media downloads cannot follow redirects to internal hosts or forward the API token',async()=>{
  for(const value of ['http://scontent.cdninstagram.com/a','https://localhost/a','https://127.0.0.1/a','https://cdninstagram.com.evil.test/a','https://scontent.cdninstagram.com:444/a','https://user:pass@scontent.cdninstagram.com/a'])assert.throws(()=>instagramMediaUrl(value),{code:'INVALID_COLLECTED_MEDIA'});
  let calls=0;
  await assert.rejects(stageApifyReels(normalizeReels([reel],'lulaoficial',instant),{fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers,undefined);assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});}}),{code:'INVALID_COLLECTED_MEDIA'});assert.equal(calls,1);
});

test('downloaded videos are bounded, checked as MP4, and signed links never enter metadata',async()=>{
  const reels=normalizeReels([reel],'lulaoficial',instant);
  await assert.rejects(stageApifyReels(reels,{fetchImpl:async()=>new Response('<html>not a video</html>')}),{code:'INVALID_COLLECTED_MEDIA'});
  await assert.rejects(stageApifyReels(reels,{fetchImpl:async()=>new Response('small',{headers:{'content-length':String(91*1024*1024)}})}),{code:'COLLECTION_RESPONSE_TOO_LARGE'});
  const staged=await stageApifyReels(reels,{fetchImpl:async()=>new Response(Buffer.from('0000ftypisom0000'))});
  try{const metadata=JSON.parse(await readFile(staged.metadataPath,'utf8'));assert.equal(metadata[0].caption,reel.caption);assert.equal(JSON.stringify(metadata).includes('signature='),false);assert.equal(metadata[0].videoUrl,undefined);}finally{await staged.cleanup();}
});

test('API media goes through the real quality and duplicate checks without launching a browser',async t=>{
  if(spawnSync('ffmpeg',['-version']).status!==0){t.skip('FFmpeg is required for the media integration check');return;}
  const root=await mkdtemp(join(tmpdir(),'lula-api-test-'));await mkdir('/tmp/lula-storiesig',{recursive:true});const seeds=await mkdtemp('/tmp/lula-storiesig/test-');
  try{
    for(const name of ['scripts','src/data','.cache/storiesig'])await mkdir(join(root,name),{recursive:true});
    await writeFile(join(root,'package.json'),'{"type":"module"}');await symlink(resolve('node_modules'),join(root,'node_modules'));
    for(const name of ['scrape-storiesig.mjs','storiesig-video-fingerprint.mjs','video-quality.mjs'])await copyFile(resolve('scripts',name),join(root,'scripts',name));
    await writeFile(join(root,'src/data/sources.json'),JSON.stringify([{username:'lulaoficial'}]));await writeFile(join(root,'src/data/storiesig-posts.json'),'[]');
    const video=join(seeds,'video.mp4');assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=10','-t','2','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);
    const metadata=join(seeds,'metadata.json');await writeFile(metadata,JSON.stringify([{source:'lulaoficial',tab:'reels',path:video,caption:reel.caption,permalink:reel.url}]));
    for(let attempt=0;attempt<2;attempt++){
      const result=spawnSync(process.execPath,[join(root,'scripts/scrape-storiesig.mjs'),'--source','lulaoficial','--seed-only','1','--seed-metadata',metadata],{env:{...process.env,CHROME_EXECUTABLE_PATH:'/browser-must-not-launch'},encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stderr?.slice(-400));
      const records=JSON.parse(await readFile(join(root,'src/data/storiesig-posts.json'),'utf8'));assert.equal(records.length,1);assert.equal(records[0].sourceUrl,'https://www.instagram.com/lulaoficial/reels/');assert.equal(records[0].permalink,reel.url);
    }
  }finally{await rm(root,{recursive:true,force:true});await rm(seeds,{recursive:true,force:true});}
});
