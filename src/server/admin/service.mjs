import { AdminError, authConfiguration, checkCredentials, constantEqual, createSession, requireSession, requireMutation, requireSameOrigin, readJson, readLoginInput, sessionCookie, digest } from './auth.mjs';
import { addActivity, cleanText, MAX_PENDING_BYTES, MAX_CANDIDATES, normalizeUsername, pendingBytes, selectMentions, validId } from './state.mjs';
import { createBlobStore, storageRetrySeconds } from './blob.mjs';
import { generateCaption, checkCaptionProvider, GUIDANCE_REVISION } from './captions.mjs';
import { randomUUID } from 'node:crypto';
import { PublishingError, validateState as validatePublishingState } from '../../../scripts/instagram-publishing/core.mjs';
import { enqueueInstagram, checkInstagramConnection, INSTAGRAM_STATE_PATH, INSTAGRAM_STATUS_PATH } from '../instagram/runtime.mjs';
import { readManualHistory } from '../../../scripts/instagram-publishing/manual-history.mjs';

const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','Vercel-CDN-Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'};
const json = (value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
let publicCache = { at:0, feed:[], published:[] };
async function publicStatus(env,fetchImpl){
  if(Date.now()-publicCache.at<20000)return publicCache;
  const origin=new URL(env.PUBLIC_SITE_URL||'https://todos-com-lula.vercel.app');
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.pathname!=='/')throw new AdminError('INVALID_SITE_CONFIGURATION',503);
  const results=await Promise.allSettled([
    fetchImpl(new URL('/feed.json',origin),{signal:AbortSignal.timeout(8000)}).then(async r=>{if(!r.ok)throw new Error();const text=await r.text();if(text.length>10000000)throw new Error();const v=JSON.parse(text);if(!Array.isArray(v))throw new Error();return v;}),
    fetchImpl('https://raw.githubusercontent.com/todoscomlula/site/refs/heads/instagram-publishing-state/state.json',{signal:AbortSignal.timeout(8000)}).then(async r=>{if(!r.ok)throw new Error();const text=await r.text();if(text.length>1000000)throw new Error();const v=JSON.parse(text);if(v.account!=='boraaalula2026'||!Array.isArray(v.published))throw new Error();return v.published;}),
    readManualHistory({fetchImpl}).then(state=>state.published),
  ]);
  publicCache={at:Date.now(),feed:results[0].status==='fulfilled'?results[0].value:publicCache.feed,published:results[1].status==='fulfilled'?results[1].value:publicCache.published,manualPublished:results[2].status==='fulfilled'?results[2].value:publicCache.manualPublished||[]};
  return publicCache;
}
function requireItem(state,id){const item=state.candidates.find(candidate=>candidate.id===id);if(!item)throw new AdminError('CANDIDATE_NOT_FOUND',404);return item;}
function editable(item){if(!['pending','approved','error'].includes(item.status))throw new AdminError('CANDIDATE_BUSY',409);}
function mentionsFor(state,item){try{return item.mentionProfiles?.length===5?item.mentionProfiles:selectMentions(state.sources,item);}catch{return [];}}
async function adminDashboard({env,store,fetchImpl}){
  const [status,records]=await Promise.all([publicStatus(env,fetchImpl),Promise.allSettled([store.load(),store.readJson?.('queue/collector-status.json')||null,store.readJson?.(INSTAGRAM_STATE_PATH)||null,store.readJson?.(INSTAGRAM_STATUS_PATH)||null])]);
  const failures=records.filter(result=>result.status==='rejected');
  for(const result of failures)if(!(result.reason instanceof AdminError)||!storageRetrySeconds(result.reason.code))throw result.reason;
  const unavailable=failures[0]?.reason.code||null;
  const [state,collector,instagramState,instagramRuntime]=records.map(result=>result.status==='fulfilled'?result.value:null);
  const readOnly=!!unavailable;
  const published=[...new Map([...(instagramState?validatePublishingState(instagramState).published:status.published),...(status.manualPublished||[])].map(proof=>[proof.contentHash,proof])).values()];
  const publishedIds=new Set(published.map(item=>item.postId));
  const candidates=readOnly?[]:state.candidates.map(item=>({...item,media:{video:{url:`/api/admin/media/${item.id}/video/`,bytes:item.media.video.bytes,width:item.media.video.width,height:item.media.video.height},poster:{url:`/api/admin/media/${item.id}/poster/`}},mentionProfiles:mentionsFor(state,item),status:publishedIds.has(item.id)?'published':item.status}));
  return {availability:{readOnly,code:unavailable},sources:readOnly?[]:state.sources,candidates,activity:readOnly?[]:state.activity,worker:readOnly?{lastRunAt:null,lastError:null}:state.worker,instagramRuntime:readOnly?{runtime:'vercel',mode:'paused',code:unavailable,nextAttemptAt:null}:instagramRuntime||null,archive:status.feed.map(post=>({id:post.id,title:post.title,source:post.source,kind:post.kind,imageUrl:post.imageUrl,url:post.url,instagramPublished:publishedIds.has(post.id)?true:readOnly?null:false})),counts:{pending:readOnly?null:candidates.filter(item=>item.status==='pending').length,queued:readOnly?null:candidates.filter(item=>!['pending','published','rejected'].includes(item.status)).length,site:status.feed.length,instagram:readOnly?null:published.length,activeSources:readOnly?null:state.sources.filter(source=>source.enabled).length},storage:{pendingBytes:readOnly?null:pendingBytes(state),maximumBytes:MAX_PENDING_BYTES},configuration:{collection:{provider:collector?.provider==='apify'?'apify':'storiesig',configured:collector?.configured===true},deepseek:!!(env.DEEPSEEK_API_KEY||env.DEEP_SEEK_API),model:env.DEEPSEEK_MODEL||'deepseek-flash',worker:!!env.ADMIN_WORKER_SECRET,skillRevision:GUIDANCE_REVISION,skillRepository:'https://github.com/sergebulaev/instagram-skills'}};
}
async function makeCaptionForItem(id,{store,env,fetchImpl}){
  const runPath=`queue/caption-runs/${id}.json`;const owner=randomUUID();
  if(store.mutateJson)await store.mutateJson(runPath,previous=>{if(previous?.owner&&Date.parse(previous.expiresAt)>Date.now())throw new AdminError('CANDIDATE_BUSY',409);return{owner,expiresAt:new Date(Date.now()+210000).toISOString()};});
  let candidate; let claimed=false;
  try{
    await store.mutate(state=>{const item=requireItem(state,id);if(item.status==='ready'||item.status==='publishing'||item.status==='awaiting_instagram'||item.status==='published'){candidate=structuredClone(item);return;}if(item.status==='generating'){if(!store.mutateJson)throw new AdminError('CANDIDATE_BUSY',409);item.status='approved';}if(!['approved','error'].includes(item.status)||!item.approvedAt)throw new AdminError('CANDIDATE_NOT_APPROVED',409);item.status='generating';item.lastError=null;candidate=structuredClone(item);claimed=true;});
    if(!claimed)return candidate.caption;
    const caption=await generateCaption(candidate,{env,fetchImpl,recordResponse:report=>store.putJson?.(`queue/caption-reports/${id}.json`,report)});
    await store.mutate(state=>{const item=requireItem(state,id);if(item.status!=='generating'||item.approvedAt!==candidate.approvedAt)throw new AdminError('CANDIDATE_CHANGED',409);item.caption=caption;item.status='ready';item.lastError=null;addActivity(state,'caption',`Legenda pronta para @${item.source}.`);});
    return caption;
  }catch(error){const code=error instanceof AdminError?error.code:'CAPTION_GENERATION_FAILED';if(claimed)await store.mutate(state=>{const item=requireItem(state,id);if(item.status==='generating'){item.status='approved';item.lastError=code;}});throw error instanceof AdminError?error:new AdminError('CAPTION_GENERATION_FAILED',502);}
  finally{if(store.mutateJson)await store.mutateJson(runPath,previous=>previous?.owner===owner?{owner:null,expiresAt:null}:previous);}
}
export async function handleAdminRequest(request,{env=process.env,store=createBlobStore(env),fetchImpl=fetch,clientAddress='unknown',background=null}={}){
  const action=new URL(request.url).pathname.replace(/^\/api\/admin\/?/,'').replace(/\/$/,'');
  try{
    if(['worker/caption','worker/status','worker/deepseek','worker/instagram','worker/instagram/check','worker/instagram/status'].includes(action)&&request.method==='POST'){
      if(!env.ADMIN_WORKER_SECRET||env.ADMIN_WORKER_SECRET.length<40)throw new AdminError('WORKER_NOT_CONFIGURED',503);
      if(!constantEqual(request.headers.get('authorization'),`Bearer ${env.ADMIN_WORKER_SECRET}`))throw new AdminError('UNAUTHENTICATED',401);
      if(action==='worker/instagram'){await readJson(request);return json(await enqueueInstagram({env}),202);}
      if(action==='worker/instagram/check'){await readJson(request);return json(await checkInstagramConnection({env,store,fetchImpl}));}
      if(action==='worker/instagram/status'){
        try{const [publishing,status]=await Promise.all([store.readJson(INSTAGRAM_STATE_PATH),store.readJson(INSTAGRAM_STATUS_PATH)]);return json({runtime:env.INSTAGRAM_PUBLISHING_RUNTIME||'github',manualLedger:true,configured:!!env.INSTAGRAM_ACCESS_TOKEN,migrated:!!publishing,published:publishing?.published?.length||0,status:status||null});}
        catch(error){if(!(error instanceof AdminError)||!storageRetrySeconds(error.code))throw error;return json({runtime:env.INSTAGRAM_PUBLISHING_RUNTIME||'vercel',manualLedger:true,configured:!!env.INSTAGRAM_ACCESS_TOKEN,migrated:null,published:null,availability:{readOnly:true,code:error.code},status:{mode:'paused',code:error.code,nextAttemptAt:null}});}
      }
      if(action==='worker/deepseek'){const input=await readJson(request);if(Object.keys(input).some(key=>!['mode','model'].includes(key))||('mode'in input&&!['metadata','probe'].includes(input.mode))||('model'in input&&typeof input.model!=='string'))throw new AdminError('INVALID_REQUEST');return json(await checkCaptionProvider({env,fetchImpl,metadata:input.mode==='metadata',model:input.model||null}));}
      if(action==='worker/status')return json({deepseek:!!(env.DEEPSEEK_API_KEY||env.DEEP_SEEK_API)});
      const input=await readJson(request);if(Object.keys(input).join(',')!=='id'||!validId(input.id))throw new AdminError('INVALID_CANDIDATE');
      await makeCaptionForItem(input.id,{store,env,fetchImpl});return json({ok:true});
    }
    if(action==='login'&&request.method==='POST'){
      requireSameOrigin(request);authConfiguration(env);const input=await readLoginInput(request);
      if(Object.keys(input).sort().join(',')!=='email,password'||typeof input.email!=='string'||typeof input.password!=='string')throw new AdminError('INVALID_CREDENTIALS',401);
      // This mode is enabled only after the project firewall rule is verified.
      // Local/preview instances retain the existing durable limiter.
      if(env.VERCEL!=='1'||env.ADMIN_LOGIN_RATE_LIMIT_MODE!=='vercel-firewall')await store.checkLoginRate(digest(env.ADMIN_SESSION_SECRET+'\0'+clientAddress));
      if(!checkCredentials(input.email,input.password,env))throw new AdminError('INVALID_CREDENTIALS',401);
      return json({ok:true},200,{'Set-Cookie':sessionCookie(createSession(env))});
    }
    const session=requireSession(request,env);
    if(action==='session'&&request.method==='GET')return json({email:session.email,csrf:session.csrf,expiresAt:session.expiresAt});
    if(action==='dashboard'&&request.method==='GET'){
      return json(await adminDashboard({env,store,fetchImpl}));
    }
    const media=action.match(/^media\/(storiesig-[a-z0-9_.]+-[a-f0-9]{12})\/(video|poster)$/);
    if(media&&request.method==='GET'){
      const state=await store.load();const item=requireItem(state,media[1]);const asset=item.media[media[2]];const range=request.headers.get('range');
      if(item.mediaRemoved)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',404);
      if(range&&!/^bytes=\d*-\d*$/.test(range))throw new AdminError('INVALID_RANGE',416);
      const {result}=await store.preview(asset.path,range);const contentRange=result.headers.get('content-range');
      const outputHeaders={...headers,'Content-Type':media[2]==='video'?'video/mp4':'image/jpeg','Accept-Ranges':'bytes','Content-Disposition':'inline','Cache-Control':'private, max-age=60'};
      if(result.headers.get('content-length'))outputHeaders['Content-Length']=result.headers.get('content-length');if(contentRange)outputHeaders['Content-Range']=contentRange;
      return new Response(result.stream,{status:contentRange?206:200,headers:outputHeaders});
    }
    if(!['POST','PATCH','DELETE'].includes(request.method))throw new AdminError('NOT_FOUND',404);
    requireMutation(request,env);
    if(action==='instagram'&&request.method==='POST'){await readJson(request);return json(await enqueueInstagram({env}),202);}
    if(action==='logout'&&request.method==='POST')return json({ok:true},200,{'Set-Cookie':sessionCookie('',true)});
    if(action==='sources'&&request.method==='POST'){
      const input=await readJson(request);const username=normalizeUsername(input.username);const name=cleanText(input.name||`@${username}`,80);
      await store.mutate(state=>{if(state.sources.length>=100)throw new AdminError('SOURCE_LIMIT',422);if(state.sources.some(source=>source.username===username))throw new AdminError('SOURCE_EXISTS',409);state.sources.push({username,name,enabled:true,autoCollect:false,requestedAt:new Date().toISOString(),lastCollectedAt:null,nextCollectAt:null,lastStatus:'queued',lastError:null});addActivity(state,'source',`@${username} adicionada à coleta.`);});return json({ok:true},201);
    }
    const sourceAction=action.match(/^sources\/([a-z0-9_.]{1,30})$/);
    if(sourceAction){
      const username=normalizeUsername(sourceAction[1]);const input=request.method==='PATCH'?await readJson(request):{};
      await store.mutate(state=>{const source=state.sources.find(value=>value.username===username);if(!source)throw new AdminError('SOURCE_NOT_FOUND',404);if(source.lastStatus==='collecting')throw new AdminError('SOURCE_BUSY',409);
        if(request.method==='DELETE'){state.sources=state.sources.filter(value=>value!==source);addActivity(state,'source',`@${username} removida das fontes.`);return;}
        if(request.method!=='PATCH'||Object.keys(input).some(key=>!['enabled','autoCollect','name'].includes(key)))throw new AdminError('INVALID_SOURCE');
        if('enabled'in input){if(typeof input.enabled!=='boolean')throw new AdminError('INVALID_SOURCE');source.enabled=input.enabled;if(!source.enabled){source.requestedAt=null;source.nextCollectAt=null;source.lastStatus='idle';}}
        if('autoCollect'in input){if(typeof input.autoCollect!=='boolean')throw new AdminError('INVALID_SOURCE');source.autoCollect=input.autoCollect;source.nextCollectAt=input.autoCollect&&source.enabled?new Date().toISOString():null;}
        if('name'in input)source.name=cleanText(input.name,80);
      });return json({ok:true});
    }
    if(action==='collect'&&request.method==='POST'){
      const input=await readJson(request);const username=input.username?normalizeUsername(input.username):null;
      await store.mutate(state=>{const selected=state.sources.filter(source=>source.enabled&&(!username||source.username===username));if(!selected.length)throw new AdminError('NO_ACTIVE_SOURCE',422);if(pendingBytes(state)>=MAX_PENDING_BYTES||state.candidates.filter(item=>!['published','rejected'].includes(item.status)).length>=100)throw new AdminError('REVIEW_QUEUE_FULL',422);for(const source of selected){if(source.lastStatus==='collecting')continue;source.requestedAt ||= new Date().toISOString();source.lastStatus='queued';source.lastError=null;}addActivity(state,'collect',`Coleta solicitada para ${selected.length} perfil(is).`);});return json({ok:true},202);
    }
    const candidateAction=action.match(/^candidates\/(storiesig-[a-z0-9_.]+-[a-f0-9]{12})(?:\/(approve|reject|preview|caption))?$/);
    if(candidateAction){
      const [,id,operation]=candidateAction;const input=await readJson(request);
      if(operation==='caption'){
        const item=requireItem(await store.load(),id);if(!item.approvedAt)throw new AdminError('CANDIDATE_NOT_APPROVED',409);
        const task=makeCaptionForItem(id,{store,env,fetchImpl});if(background){background(task.catch(()=>{}));return json({ok:true},202);}await task;return json({ok:true});
      }
      if(operation==='preview'){
        const state=await store.load();const item=requireItem(state,id);editable(item);const candidate={...item,notes:'notes'in input?cleanText(input.notes,2500):item.notes};const caption=await generateCaption(candidate,{env,fetchImpl});
        await store.mutate(current=>{const record=requireItem(current,id);editable(record);record.notes=candidate.notes;record.caption=caption;record.lastError=null;});return json({ok:true,caption});
      }
      await store.mutate(state=>{const item=requireItem(state,id);editable(item);if('notes'in input){const notes=cleanText(input.notes,2500);if(notes!==item.notes)item.caption=null;item.notes=notes;}
        if(operation==='approve'){item.mentionProfiles=selectMentions(state.sources,item);item.approvedAt=new Date().toISOString();item.status=item.caption?'ready':'approved';item.lastError=null;addActivity(state,'approval',`Vídeo de @${item.source} aprovado para site e Instagram.`);}
        else if(operation==='reject'){if(item.status!=='pending'&&item.status!=='error')throw new AdminError('CANDIDATE_BUSY',409);item.status='rejected';item.lastError=null;addActivity(state,'rejection',`Vídeo de @${item.source} não selecionado.`);}
        else if(request.method!=='PATCH')throw new AdminError('NOT_FOUND',404);
      });if(operation==='approve'&&background)background(makeCaptionForItem(id,{store,env,fetchImpl}).catch(()=>{}));return json({ok:true},operation==='approve'?202:200);
    }
    throw new AdminError('NOT_FOUND',404);
  }catch(error){const safe=error instanceof AdminError?error:error instanceof PublishingError?new AdminError(error.code,503):new AdminError('ADMIN_SERVICE_UNAVAILABLE',503);const retry=storageRetrySeconds(safe.code);return json({error:safe.code},safe.status,retry?{'Retry-After':String(retry)}:{});}
}
