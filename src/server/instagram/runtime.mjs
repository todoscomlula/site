import { createHash } from 'node:crypto';
import { send } from '@vercel/queue';
import { MetaClient } from '../../../scripts/instagram-publishing/meta-client.mjs';
import { API_VERSION, PublishingError, contentKey, publicSiteUrl, runPublisher, validateState } from '../../../scripts/instagram-publishing/core.mjs';
import { createBlobStore, storageRetrySeconds } from '../admin/blob.mjs';
import { AdminError } from '../admin/auth.mjs';
import { addActivity, selectMentions } from '../admin/state.mjs';

export const INSTAGRAM_STATE_PATH='queue/instagram-publishing-state.json';
export const INSTAGRAM_STATUS_PATH='queue/instagram-runtime.json';
export const INSTAGRAM_TOPIC='instagram-publishing';
const legacyUrl='https://raw.githubusercontent.com/todoscomlula/site/refs/heads/instagram-publishing-state/state.json';
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const configured=env=>env.INSTAGRAM_PUBLISHING_RUNTIME==='vercel'&&!!env.INSTAGRAM_ACCESS_TOKEN;

export class BlobPublishingState {
  constructor(store){this.store=store;this.expected=null;}
  async load(){const value=await this.store.readJson(INSTAGRAM_STATE_PATH);if(!value)throw new PublishingError('INSTAGRAM_STATE_NOT_MIGRATED');const state=validateState(value);this.expected=fingerprint(state);return structuredClone(state);}
  async save(value){
    const state=validateState(structuredClone(value));const expected=this.expected;
    if(!expected)throw new PublishingError('INSTAGRAM_STATE_NOT_LOADED');
    await this.store.mutateJson(INSTAGRAM_STATE_PATH,previous=>{if(!previous||fingerprint(validateState(previous))!==expected)throw new PublishingError('INSTAGRAM_STATE_CONFLICT');return state;});
    this.expected=fingerprint(state);
  }
}

export async function initializeInstagramState({store,fetchImpl=fetch,now=Date.now()}={}){
  const existing=await store.readJson(INSTAGRAM_STATE_PATH);if(existing)return validateState(existing);
  const response=await fetchImpl(legacyUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new PublishingError('INSTAGRAM_HISTORY_UNAVAILABLE');
  const raw=await response.text();if(raw.length>2*1024*1024)throw new PublishingError('INVALID_PUBLIC_STATE');
  const previous=validateState(JSON.parse(raw));
  if(previous.lease&&Date.parse(previous.lease.expiresAt)>now)throw new PublishingError('PUBLISHING_LOCK_ACTIVE');
  previous.lease=null;
  return store.mutateJson(INSTAGRAM_STATE_PATH,current=>current?validateState(current):previous);
}

export async function enqueueInstagram({env=process.env,sendImpl=send,delaySeconds=0,idempotencyKey,now=Date.now()}={}){
  if(!configured(env))throw new PublishingError('VERCEL_INSTAGRAM_NOT_CONFIGURED');
  try{await sendImpl(INSTAGRAM_TOPIC,{version:1},{region:'iad1',retentionSeconds:604800,delaySeconds,idempotencyKey:idempotencyKey||`instagram-kick-${Math.floor(now/60000)}`});}
  catch{throw new PublishingError('INSTAGRAM_QUEUE_UNAVAILABLE');}
  return {ok:true,runtime:'vercel',queued:true};
}

export async function checkInstagramConnection({env=process.env,store=createBlobStore(env),fetchImpl=fetch,graph}={}){
  if(!configured(env))throw new PublishingError('VERCEL_INSTAGRAM_NOT_CONFIGURED');
  graph ||= new MetaClient({accessToken:env.INSTAGRAM_ACCESS_TOKEN,userId:env.INSTAGRAM_USER_ID,version:env.INSTAGRAM_API_VERSION||API_VERSION,fetchImpl});
  const identity=await graph.verifyAccount();const quota=await graph.quota();
  const state=await store.readJson(INSTAGRAM_STATE_PATH);
  const result={runtime:'vercel',account:identity.username,quota,migrated:!!state};
  if(state){validateState(state);result.published=state.published.length;if(state.pending?.containerId){const status=await graph.containerStatus(state.pending.containerId);if(!['IN_PROGRESS','FINISHED','PUBLISHED','ERROR','EXPIRED'].includes(status))throw new PublishingError('UNKNOWN_CONTAINER_STATUS');result.pending={postId:state.pending.postId,stage:state.pending.stage,status};}}
  return result;
}

async function reconcileAdmin(store,publishing){
  const confirmed=new Map(publishing.published.map(item=>[item.contentHash,item]));
  const state=await store.load();
  if(!state.candidates.some(item=>item.approvedAt&&item.status!=='published'&&confirmed.has(contentKey(item))))return;
  await store.mutate(current=>{for(const item of current.candidates){const proof=confirmed.get(contentKey(item));if(item.approvedAt&&item.status!=='published'&&proof){item.status='published';item.publishedAt=proof.publishedAt;item.lastError=null;addActivity(current,'published',`Vídeo de @${item.source} confirmado no Instagram pela Vercel.`);}}});
}

export async function processInstagramTick({env=process.env,store=createBlobStore(env),fetchImpl=fetch,sendImpl=send,graph,messageId='manual',now=Date.now()}={}){
  if(!configured(env))throw new PublishingError('VERCEL_INSTAGRAM_NOT_CONFIGURED');
  await initializeInstagramState({store,fetchImpl,now});
  const publishingStore=new BlobPublishingState(store);const site=publicSiteUrl(env.PUBLIC_SITE_URL||'https://todos-com-lula.vercel.app');
  let mode='idle';let code=null;let delay=null;let postId=null;let published=false;
  try{
    const response=await fetchImpl(new URL('/feed.json',site),{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new PublishingError('PUBLIC_FEED_UNAVAILABLE');const raw=await response.text();if(raw.length>10000000)throw new PublishingError('INVALID_SITE_FEED');
    const feed=JSON.parse(raw);if(!Array.isArray(feed))throw new PublishingError('INVALID_SITE_FEED');
    const admin=await store.load();
    const posts=feed.map(post=>typeof post.publicationCaption==='string'?post:{...post,publicationMentionsRequired:true,mentionProfiles:selectMentions(admin.sources,post)});
    graph ||= new MetaClient({accessToken:env.INSTAGRAM_ACCESS_TOKEN,userId:env.INSTAGRAM_USER_ID,version:env.INSTAGRAM_API_VERSION||API_VERSION,fetchImpl});
    const result=await runPublisher({posts,siteUrl:site.href,publish:true,graph,store:publishingStore,fetchImpl,sleep:async()=>{throw new PublishingError('CONTAINER_PROCESSING_TIMEOUT');}});
    published=!!(result.published||result.recovered);postId=result.candidateId||null;
    if(result.quotaWait){mode='quota-wait';code='META_PUBLISHING_LIMIT';delay=900;}
    else if(published){mode='published';delay=10;}
  }catch(error){
    if(error instanceof AdminError&&storageRetrySeconds(error.code))throw error;
    code=error instanceof PublishingError?error.code:'INSTAGRAM_PROCESSING_FAILED';
    if(code==='CONTAINER_PROCESSING_TIMEOUT'){mode='processing';delay=60;}
    else if(['PUBLISHING_LOCK_ACTIVE','INSTAGRAM_STATE_CONFLICT'].includes(code)){mode='processing';delay=60;}
    else if(['PUBLISHING_RESULT_UNCERTAIN','WRONG_INSTAGRAM_ACCOUNT','INVALID_INSTAGRAM_USER_ID','INVALID_SITE_FEED'].includes(code)||(error instanceof PublishingError&&[190,10,200].includes(error.providerCode))){mode='attention';}
    else{mode='retry';delay=900;}
  }
  const state=await publishingStore.load();await reconcileAdmin(store,state);
  const status={runtime:'vercel',mode,code,postId:postId||state.pending?.postId||null,published:state.published.length,checkedAt:new Date(now).toISOString(),nextAttemptAt:delay===null?null:new Date(now+delay*1000).toISOString()};
  await store.putJson(INSTAGRAM_STATUS_PATH,status);
  if(delay!==null)await enqueueInstagram({env,sendImpl,delaySeconds:delay,idempotencyKey:`instagram-next-${messageId}`,now});
  return {...status,publishedThisTick:published};
}
