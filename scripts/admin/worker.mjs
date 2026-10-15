#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBlobStore } from '../../src/server/admin/blob.mjs';
import { AdminError } from '../../src/server/admin/auth.mjs';
import { addActivity, cleanText, MAX_CANDIDATES, MAX_PENDING_BYTES, pendingBytes, validUsername, validateAdminState } from '../../src/server/admin/state.mjs';
import { contentKey, publicSiteUrl, validateState } from '../instagram-publishing/core.mjs';

const root=process.cwd();const cache=resolve(root,'.cache/admin-worker');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const saveJson=async(path,value)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
const safeCodes=new Set(['rate_limited','access_restricted','challenge_required']);
function run(binary,args,{allowFailure=false,env=process.env,timeout=20*60_000}={}){
  return new Promise((resolveRun,reject)=>{const child=spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});let stdout='';let bytes=0;const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new AdminError('PROCESS_TIMEOUT',503));},timeout);child.stdout.on('data',part=>{bytes+=part.length;if(bytes<8*1024*1024)stdout+=part;});child.stderr.on('data',()=>{});child.on('error',()=>{clearTimeout(timer);reject(new AdminError('PROCESS_START_FAILED',503));});child.on('close',code=>{clearTimeout(timer);if(code&&!allowFailure)reject(new AdminError('PROCESS_FAILED',503));else resolveRun({code,stdout});});});
}
async function github(path,{method='GET',body,env=process.env}={}){
  if(env.GITHUB_REPOSITORY!=='todoscomlula/site'||!env.GITHUB_TOKEN)throw new AdminError('GITHUB_WORKER_NOT_CONFIGURED',503);
  let response;try{response=await fetch(`https://api.github.com/repos/todoscomlula/site/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new AdminError('GITHUB_UNAVAILABLE',503);}
  if(!response.ok)throw new AdminError(response.status===409||response.status===422?'GITHUB_CONFLICT':'GITHUB_REQUEST_FAILED',503);
  return response.status===204?null:response.json();
}
async function publicJson(path,env){const file=await github(`contents/${path}?ref=main`,{env});if(file.encoding!=='base64')throw new AdminError('INVALID_PUBLIC_CONTENT',503);return JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));}
export function candidateToPublic(item,assets){
  if(!item.approvedAt||!item.caption||item.mentionProfiles.length!==5||!['ready','publishing','awaiting_instagram','published'].includes(item.status))throw new AdminError('CANDIDATE_NOT_APPROVED',409);
  const video=assets.video.publicPath;const poster=assets.poster.publicPath;
  return {id:item.id,source:item.source,sourceUrl:item.sourceUrl,permalink:item.permalink,title:item.caption.title,excerpt:item.caption.text.slice(0,280),publishedAt:null,observedAt:item.observedAt,publishedLabel:null,kind:'video',mediaUrl:video,thumbnailUrl:poster,downloadUrl:video,media:[{kind:'video',url:video,thumbnailUrl:poster,filename:basename(video)}],contentGroupId:item.contentGroupId,videoQuality:{width:item.media.video.width,height:item.media.video.height,preservedSource:true},publicationCaption:item.caption.text,publicationHashtags:item.caption.hashtags,mentionProfiles:[...item.mentionProfiles],reviewApprovedAt:item.approvedAt,captionProvider:'deepseek',captionModel:item.caption.model,captionSkillRevision:item.caption.skillRevision};
}
export async function workerCheck({store=createBlobStore(),env=process.env}={}){
  const state=validateAdminState(await store.load());let deploymentCredential='missing';
  if(env.ADMIN_VERCEL_TOKEN&&env.VERCEL_PROJECT_ID&&env.VERCEL_ORG_ID){const response=await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`,{headers:{Authorization:`Bearer ${env.ADMIN_VERCEL_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new AdminError('DEPLOYMENT_CREDENTIAL_INVALID',503);const project=await response.json();if(project.id!==env.VERCEL_PROJECT_ID)throw new AdminError('DEPLOYMENT_CREDENTIAL_INVALID',503);deploymentCredential='verified';}
  const now=Date.now();return {deploymentCredential,sources:state.sources.length,requestedSources:state.sources.filter(source=>source.enabled&&(source.requestedAt||(source.autoCollect&&source.nextCollectAt&&Date.parse(source.nextCollectAt)<=now))).length,pending:state.candidates.filter(item=>item.status==='pending').length,approved:state.candidates.filter(item=>['approved','generating','ready','publishing'].includes(item.status)).length};
}
async function reconcile(store,env){
  const file=await github('contents/state.json?ref=instagram-publishing-state',{env});const published=validateState(JSON.parse(Buffer.from(file.content,'base64').toString('utf8'))).published;const keys=new Set(published.map(post=>post.contentHash));const state=await store.load();const updates=state.candidates.filter(item=>item.status!=='published'&&item.approvedAt&&keys.has(contentKey(item)));
  if(updates.length)await store.mutate(current=>{for(const original of updates){const item=current.candidates.find(item=>item.id===original.id);if(item){item.status='published';item.publishedAt=new Date().toISOString();item.lastError=null;addActivity(current,'published',`Vídeo de @${item.source} confirmado no Instagram.`);}}});
  for(const item of (await store.load()).candidates.filter(item=>['rejected','published'].includes(item.status)&&!item.mediaRemoved)){
    try{await store.remove(item.media.video.path);await store.remove(item.media.poster.path);await store.mutate(current=>{const record=current.candidates.find(record=>record.id===item.id);if(record)record.mediaRemoved=true;});}catch{/* Retried on a later cycle; no publication is repeated. */}
  }
}
async function uploadCandidate(record,source,store){
  const assets={};
  for(const [kind,url,extension] of [['video',record.mediaUrl,'mp4'],['poster',record.thumbnailUrl,'jpg']]){
    if(typeof url!=='string'||!new RegExp(`^/media/instagram/${source.username.replaceAll('.','\\.')}/[a-f0-9]{12}\\.${extension}$`).test(url))throw new AdminError('INVALID_COLLECTED_MEDIA',503);
    const file=resolve(root,'public',url.slice(1));const bytes=await readFile(file);const sha256=hash(bytes);const path=`queue/media/${record.id}/${sha256.slice(0,12)}.${extension}`;
    if(!bytes.length||bytes.length>90*1024*1024)throw new AdminError('MEDIA_TOO_LARGE',422);
    const metadata=JSON.parse((await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file])).stdout);const dimensions=metadata.streams?.[0];if(!dimensions)throw new AdminError('INVALID_COLLECTED_MEDIA',503);
    await store.upload(path,bytes,kind==='video'?'video/mp4':'image/jpeg');assets[kind]={path,sha256,bytes:bytes.length,width:dimensions.width,height:dimensions.height};
  }
  return {id:record.id,source:source.username,sourceName:source.name,sourceUrl:`https://www.instagram.com/${source.username}/reels/`,permalink:record.permalink||null,originalTitle:cleanText(record.title,120),originalCaption:cleanText(record.excerpt,4000),notes:'',observedAt:record.observedAt,contentGroupId:record.contentGroupId||record.id,media:assets,mediaRemoved:false,mentionProfiles:[],status:'pending',approvedAt:null,caption:null,lastError:null,sitePublishedAt:null,publishedAt:null};
}
async function collectSource(source,{store,env}){
  await store.mutate(state=>{const item=state.sources.find(item=>item.username===source.username);if(!item||!item.enabled)throw new AdminError('SOURCE_DISABLED',409);item.lastStatus='collecting';item.requestedAt=null;item.lastError=null;});
  const baseRecords=await publicJson('src/data/storiesig-posts.json',env);const snapshot=await store.load();
  const previous=[...baseRecords];const known=new Set(previous.map(item=>item.id));
  for(const candidate of snapshot.candidates){if(known.has(candidate.id))continue;const sha=candidate.media.video.sha256.slice(0,12);const poster=candidate.media.poster.sha256.slice(0,12);previous.push({id:candidate.id,source:candidate.source,sourceUrl:candidate.sourceUrl,kind:'video',title:candidate.originalTitle,excerpt:candidate.originalCaption,observedAt:candidate.observedAt,contentGroupId:candidate.contentGroupId,mediaUrl:`/media/instagram/${candidate.source}/${sha}.mp4`,thumbnailUrl:`/media/instagram/${candidate.source}/${poster}.jpg`});known.add(candidate.id);}
  await saveJson(resolve(root,'src/data/storiesig-posts.json'),previous);
  await saveJson(resolve(root,'src/data/sources.json'),snapshot.sources.map(item=>({username:item.username,name:item.name,category:'Comunidade',initials:item.username.slice(0,2).toUpperCase(),color:'green'})));
  const fingerprints=await store.readJson('queue/video-fingerprints.json');if(!fingerprints)throw new AdminError('FINGERPRINTS_NOT_INITIALIZED',503);await saveJson(resolve(root,'.cache/storiesig/video-fingerprints.json'),fingerprints);
  const result=await run('node',['scripts/scrape-storiesig.mjs','--source',source.username,'--max-posts','0','--max-reels','0','--additional-reels','2','--scan-reels','6','--max-age-days','14','--max-reel-mb','90','--max-total-mb','180'],{allowFailure:true,env,timeout:8*60_000});
  const records=await readJson(resolve(root,'src/data/storiesig-posts.json'));const added=records.filter(item=>item.kind==='video'&&!known.has(item.id));
  const report=await readJson(resolve(root,'data/storiesig-import-report.json'));const entry=report.sources?.find(item=>item.source===source.username);const status=entry?.status||report.status||'public_flow_unavailable';
  let imported=0;
  for(const record of added.slice(0,2)){
    const state=await store.load();if(state.candidates.some(item=>item.id===record.id))continue;
    const size=(await stat(resolve(root,'public',record.mediaUrl.slice(1)))).size+(await stat(resolve(root,'public',record.thumbnailUrl.slice(1)))).size;
    if(pendingBytes(state)+size>MAX_PENDING_BYTES||state.candidates.filter(item=>!['published','rejected'].includes(item.status)).length>=100)break;
    const candidate=await uploadCandidate(record,source,store);
    await store.mutate(current=>{if(current.candidates.some(item=>item.id===candidate.id))return;if(current.candidates.length>=MAX_CANDIDATES){const index=current.candidates.findIndex(item=>['published','rejected'].includes(item.status)&&item.mediaRemoved);if(index>=0)current.candidates.splice(index,1);else throw new AdminError('REVIEW_QUEUE_FULL',422);}current.candidates.unshift(candidate);addActivity(current,'collected',`Vídeo de @${source.username} disponível para revisão.`);});imported++;
  }
  await store.putJson('queue/video-fingerprints.json',await readJson(resolve(root,'.cache/storiesig/video-fingerprints.json')));
  await store.mutate(state=>{const item=state.sources.find(item=>item.username===source.username);if(!item)return;item.lastCollectedAt=new Date().toISOString();item.lastStatus=result.code&&!imported?'error':'success';item.lastError=item.lastStatus==='error'?(safeCodes.has(status)?'SOURCE_ACCESS_RESTRICTED':'COLLECTION_UNAVAILABLE'):null;item.nextCollectAt=item.enabled&&item.autoCollect?new Date(Date.now()+(item.lastError?24:6)*60*60_000).toISOString():null;addActivity(state,'collect',`Coleta de @${source.username}: ${imported} vídeo(s) para revisar.`);});
  return safeCodes.has(status);
}
async function releaseAsset(item,kind,{store,env,tag}){
  const media=item.media[kind];const extension=kind==='video'?'mp4':'jpg';const name=`${media.sha256.slice(0,12)}.${extension}`;const bytes=await store.download(media.path);if(bytes.length!==media.bytes||hash(bytes)!==media.sha256)throw new AdminError('MEDIA_INTEGRITY_FAILED',503);
  const file=resolve(cache,'release',name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,bytes);
  const ghEnv={...env,GH_TOKEN:env.GITHUB_TOKEN};const list=JSON.parse((await run('gh',['release','view',tag,'--repo','todoscomlula/site','--json','assets'],{env:ghEnv})).stdout).assets;
  const existing=list.find(asset=>asset.name===name);if(existing&&existing.size!==bytes.length)throw new AdminError('RELEASE_ASSET_CONFLICT',503);
  if(!existing)await run('gh',['release','upload',tag,'--repo','todoscomlula/site',file],{env:ghEnv});
  const publicPath=`/media/instagram/${item.source}/${name}`;return {publicPath,source:{url:`https://github.com/todoscomlula/site/releases/download/${tag}/${name}`,sha256:media.sha256,bytes:media.bytes}};
}
async function publishApproved(items,{store,env}){
  if(!env.ADMIN_VERCEL_TOKEN||!env.VERCEL_PROJECT_ID||!env.VERCEL_ORG_ID)throw new AdminError('DEPLOYMENT_NOT_CONFIGURED',503);
  const tag=`media-admin-${new Date().toISOString().slice(0,10)}`;const ghEnv={...env,GH_TOKEN:env.GITHUB_TOKEN};
  const releaseExists=await run('gh',['release','view',tag,'--repo','todoscomlula/site','--json','tagName'],{env:ghEnv,allowFailure:true});
  if(releaseExists.code)await run('gh',['release','create',tag,'--repo','todoscomlula/site','--target','main','--title','Mídias aprovadas na administração','--notes','Arquivos públicos selecionados na administração. Fontes e integridade registradas no manifesto.'],{env:ghEnv});
  const prepared=[];
  for(const original of items){await store.mutate(state=>{const item=state.candidates.find(item=>item.id===original.id);if(!item||!['ready','publishing'].includes(item.status)||!item.approvedAt)throw new AdminError('CANDIDATE_NOT_APPROVED',409);item.status='publishing';item.lastError=null;});const assets={video:await releaseAsset(original,'video',{store,env,tag}),poster:await releaseAsset(original,'poster',{store,env,tag})};prepared.push({item:original,assets,post:candidateToPublic(original,assets)});}
  let committed=false;
  for(let attempt=0;attempt<3&&!committed;attempt++){
    const ref=await github('git/ref/heads/main',{env});const base=await github(`git/commits/${ref.object.sha}`,{env});
    const [records,sources,registry]=await Promise.all(['src/data/storiesig-posts.json','src/data/sources.json','src/data/media-sources.json'].map(path=>publicJson(path,env)));
    for(const {item,assets,post}of prepared){if(!records.some(record=>record.id===post.id)){if(records.some(record=>record.contentGroupId===post.contentGroupId))throw new AdminError('CONTENT_ALREADY_IN_SITE',409);records.push(post);}for(const asset of Object.values(assets))registry[asset.publicPath]=asset.source;if(!sources.some(source=>source.username===item.source))sources.push({username:item.source,name:item.sourceName,category:'Comunidade',initials:item.source.slice(0,2).toUpperCase(),color:'green'});}
    const files={'src/data/storiesig-posts.json':JSON.stringify(records,null,2)+'\n','src/data/sources.json':JSON.stringify(sources,null,2)+'\n','src/data/media-sources.json':JSON.stringify(registry,null,2)+'\n'};
    const scan=resolve(cache,'public-scan');await mkdir(scan,{recursive:true});for(const [name,value]of Object.entries(files))await writeFile(resolve(scan,basename(name)),value);
    await run(resolve(root,'.git/tools/gitleaks'),['dir',scan,'--redact','--no-banner','--exit-code','1']);
    const tree=await github('git/trees',{method:'POST',env,body:{base_tree:base.tree.sha,tree:Object.entries(files).map(([path,content])=>({path,mode:'100644',type:'blob',content}))}});
    const commit=await github('git/commits',{method:'POST',env,body:{message:`Publish ${prepared.length} reviewed video(s) [skip ci]`,tree:tree.sha,parents:[ref.object.sha]}});
    try{await github('git/refs/heads/main',{method:'PATCH',env,body:{sha:commit.sha,force:false}});committed=true;}catch(error){if(error.code!=='GITHUB_CONFLICT')throw error;}
  }
  if(!committed)throw new AdminError('PUBLIC_COMMIT_CONFLICT',503);
  // Deploy the committed tree, without installing a Git integration or exposing a broad user token.
  await run('git',['fetch','origin','main'],{env:ghEnv});await run('git',['checkout','--force','FETCH_HEAD'],{env:ghEnv});
  await mkdir(resolve(root,'.vercel'),{recursive:true});await saveJson(resolve(root,'.vercel/project.json'),{projectId:env.VERCEL_PROJECT_ID,orgId:env.VERCEL_ORG_ID});
  await run('npx',['--yes','vercel@64.0.2','--prod','--yes'],{env:{...env,VERCEL_TOKEN:env.ADMIN_VERCEL_TOKEN},timeout:15*60_000});
  const site=publicSiteUrl(env.PUBLIC_SITE_URL);const response=await fetch(new URL('/feed.json',site),{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new AdminError('DEPLOYMENT_NOT_READY',503);const feed=await response.json();if(!prepared.every(({item})=>feed.some(post=>post.id===item.id)))throw new AdminError('DEPLOYMENT_NOT_READY',503);
  await store.mutate(state=>{for(const {item}of prepared){const current=state.candidates.find(value=>value.id===item.id);if(current){current.status='awaiting_instagram';current.sitePublishedAt=new Date().toISOString();current.lastError=null;addActivity(state,'site',`Vídeo de @${current.source} publicado no site.`);}}});
  await github('actions/workflows/instagram-publishing.yml/dispatches',{method:'POST',env,body:{ref:'main',inputs:{dry_run:'false',check_connection:'false',publish_all:'true'}}});
  return prepared.length;
}
export async function runAdminWorker({env=process.env,store=createBlobStore(env),log=event=>console.log(JSON.stringify(event))}={}){
  const now=Date.now();const initial=validateAdminState(await store.load());const due=initial.sources.filter(source=>source.enabled&&(source.requestedAt||(source.autoCollect&&source.nextCollectAt&&Date.parse(source.nextCollectAt)<=now)));
  const approved=initial.candidates.filter(item=>['approved','generating','ready','publishing','awaiting_instagram'].includes(item.status));const cleanup=initial.candidates.some(item=>['rejected','published'].includes(item.status)&&!item.mediaRemoved);
  if(!due.length&&!approved.length&&!cleanup){log({mode:'admin-idle'});return;}
  if(!due.length&&!cleanup&&approved.length&&approved.every(item=>['approved','generating'].includes(item.status))){
    const response=await fetch(new URL('/api/admin/worker/status/',publicSiteUrl(env.PUBLIC_SITE_URL)),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${env.ADMIN_WORKER_SECRET}`,'Content-Type':'application/json'},body:'{}'});
    if(response.ok&&!(await response.json()).deepseek){log({mode:'admin-awaiting-deepseek'});return;}
  }
  const owner=randomUUID();await store.mutate(state=>{if(state.worker.lease&&Date.parse(state.worker.lease.expiresAt)>Date.now())throw new AdminError('WORKER_BUSY',409);state.worker.lease={owner,expiresAt:new Date(Date.now()+40*60_000).toISOString()};state.worker.lastRunAt=new Date().toISOString();state.worker.lastError=null;});
  try{
    await reconcile(store,env);
    // Recover a stopped generation before making a fresh, bounded request.
    await store.mutate(state=>{for(const item of state.candidates)if(item.status==='generating')item.status='approved';});
    for(const item of (await store.load()).candidates.filter(item=>item.status==='approved').slice(0,5)){
      if(!env.ADMIN_WORKER_SECRET)throw new AdminError('WORKER_NOT_CONFIGURED',503);
      try{const response=await fetch(new URL('/api/admin/worker/caption/',publicSiteUrl(env.PUBLIC_SITE_URL)),{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${env.ADMIN_WORKER_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});if(!response.ok){const body=await response.json().catch(()=>({}));const code=typeof body.error==='string'&&/^[A-Z_]{1,80}$/.test(body.error)?body.error:'CAPTION_GENERATION_FAILED';log({mode:'caption-wait',code});if(code==='DEEPSEEK_NOT_CONFIGURED')break;}}
      catch{log({mode:'caption-wait',code:'CAPTION_SERVICE_UNAVAILABLE'});}
    }
    const ready=(await store.load()).candidates.filter(item=>['ready','publishing'].includes(item.status)).slice(0,5);if(ready.length){const count=await publishApproved(ready,{store,env});log({mode:'site-published',count});}
    for(const source of due.slice(0,4)){const state=await store.load();if(pendingBytes(state)>=MAX_PENDING_BYTES)break;try{const restricted=await collectSource(source,{store,env});if(restricted)break;}catch(error){const code=error instanceof AdminError?error.code:'COLLECTION_UNAVAILABLE';await store.mutate(current=>{const item=current.sources.find(value=>value.username===source.username);if(item){item.lastStatus='error';item.lastError=code;item.requestedAt=null;item.nextCollectAt=item.autoCollect?new Date(Date.now()+24*60*60_000).toISOString():null;}});log({mode:'collection-error',code});}}
  }catch(error){const code=error instanceof AdminError?error.code:'ADMIN_WORKER_FAILED';await store.mutate(state=>{state.worker.lastError=code;});throw error instanceof AdminError?error:new AdminError('ADMIN_WORKER_FAILED',503);}
  finally{await store.mutate(state=>{if(state.worker.lease?.owner===owner)state.worker.lease=null;});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const check=process.argv.slice(2).join(' ')==='--check';
  (check?workerCheck().then(report=>console.log(JSON.stringify({mode:'admin-check',...report}))):runAdminWorker()).catch(error=>{console.error(JSON.stringify({error:error instanceof AdminError?error.code:'ADMIN_WORKER_FAILED'}));process.exitCode=1;});
}
