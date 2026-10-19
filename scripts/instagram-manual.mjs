import { pathToFileURL } from 'node:url';
import { API_VERSION,MANUAL_STATE_BRANCH,PublishingError,contentKey,publicSiteUrl,makeCaption,runPublishingQueue } from './instagram-publishing/core.mjs';
import { MetaClient } from './instagram-publishing/meta-client.mjs';
import { GithubStateStore } from './instagram-publishing/state-store.mjs';
import { createBlobStore } from '../src/server/admin/blob.mjs';

export const DEBATE_POST_IDS=['storiesig-ptbrasil-a038dc5bb63b','storiesig-ptbrasil-c84cc55e3702','storiesig-ptbrasil-83473b33c829'];
export function selectManualPosts(feed,ids=DEBATE_POST_IDS,now=Date.now()){
  if(!Array.isArray(feed)||ids.length<1||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!DEBATE_POST_IDS.includes(id)))throw new PublishingError('INVALID_MANUAL_BATCH');
  const posts=ids.map(id=>feed.find(post=>post.id===id));
  if(posts.some(post=>!post||post.kind!=='video'||!post.reviewApprovedAt||Date.parse(post.reviewApprovedAt)>now+300000||now-Date.parse(post.reviewApprovedAt)>2*86400000))throw new PublishingError('MANUAL_BATCH_NOT_APPROVED');
  for(const post of posts)makeCaption(post,new URL('https://todos-com-lula.vercel.app'));
  return posts;
}

export async function findExistingManualPosts(graph,posts,site){
  const matches=[];const remaining=new Set(posts.map(post=>post.id));let after;
  for(let page=0;page<3&&remaining.size;page++){
    const data=await graph.request(`${graph.userId}/media`,{query:{fields:'id,caption,permalink,timestamp',limit:'100',...(after?{after}:{})}});
    if(!Array.isArray(data.data))throw new PublishingError('INVALID_META_MEDIA_LIST');
    for(const item of data.data){
      if(typeof item.id!=='string'||!/^\d{1,40}$/.test(item.id)||typeof item.caption!=='string')continue;
      for(const post of posts){const link=new URL(`/conteudo/${post.id}/`,site).href;if(!remaining.has(post.id)||!item.caption.includes(link))continue;
        let permalink=null;try{const url=new URL(item.permalink);if(url.protocol==='https:'&&url.hostname==='www.instagram.com'&&/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)&&!url.search)permalink=url.href;}catch{}
        const publishedAt=new Date(item.timestamp).toISOString();matches.push({postId:post.id,contentHash:contentKey(post),mediaId:item.id,publishedAt,permalink});remaining.delete(post.id);
      }
    }
    after=data.paging?.cursors?.after;
    if(typeof after!=='string'||after.length>1000)break;
  }
  return matches;
}

export async function manualInstagram({env=process.env,fetchImpl=fetch,publish=false,graph,store,blobStore=createBlobStore(env),log=event=>console.log(JSON.stringify(event)),sleep}={}){
  const site=publicSiteUrl(env.PUBLIC_SITE_URL||'https://todos-com-lula.vercel.app');
  if(site.origin!=='https://todos-com-lula.vercel.app')throw new PublishingError('WRONG_MANUAL_SITE');
  const response=await fetchImpl(new URL('/feed.json',site),{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new PublishingError('PUBLIC_FEED_UNAVAILABLE');
  const raw=await response.text();if(raw.length>10000000)throw new PublishingError('INVALID_SITE_FEED');const posts=selectManualPosts(JSON.parse(raw));
  graph ||= new MetaClient({accessToken:env.INSTAGRAM_ACCESS_TOKEN,userId:env.INSTAGRAM_USER_ID,version:env.INSTAGRAM_API_VERSION||API_VERSION,fetchImpl});
  const identity=await graph.verifyAccount();const quota=await graph.quota();
  const existing=await findExistingManualPosts(graph,posts,site);
  log({mode:'manual-preflight',account:identity.username,quota,selected:posts.map(post=>post.id),alreadyPublished:existing.map(({postId,mediaId,permalink})=>({postId,mediaId,permalink}))});
  if(!publish)return {mode:'manual-preflight',account:identity.username,quota,alreadyPublished:existing.length};
  if(!env.ADMIN_WORKER_SECRET||env.ADMIN_WORKER_SECRET.length<40)throw new PublishingError('MANUAL_GUARD_NOT_DEPLOYED');
  const guard=await fetchImpl(new URL('/api/admin/worker/instagram/status/',site),{method:'POST',headers:{Authorization:`Bearer ${env.ADMIN_WORKER_SECRET}`,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(15000)});
  const guardStatus=guard.ok?await guard.json():null;
  if(!guardStatus?.manualLedger||guardStatus.manualHold!==true)throw new PublishingError('MANUAL_GUARD_NOT_DEPLOYED');
  // This one-off path is only for the unavailable Blob, while the deployed
  // native consumer observes this separate durable ledger before publishing.
  let blocked=false;try{await blobStore.load();}catch(error){if(error.code==='PRIVATE_STORAGE_BLOCKED')blocked=true;else throw error;}
  if(!blocked)throw new PublishingError('NATIVE_RUNTIME_AVAILABLE_USE_VERCEL');
  store ||= new GithubStateStore({token:env.GITHUB_TOKEN,repository:env.GITHUB_REPOSITORY,branch:MANUAL_STATE_BRANCH});
  const state=await store.load({create:true});
  if(state.lease&&Date.parse(state.lease.expiresAt)>Date.now())throw new PublishingError('PUBLISHING_LOCK_ACTIVE');
  if(state.pending&&!posts.some(post=>post.id===state.pending.postId))throw new PublishingError('MANUAL_PENDING_OUTSIDE_BATCH');
  for(const {permalink,...proof} of existing){if(!state.published.some(item=>item.contentHash===proof.contentHash))state.published.push(proof);if(state.pending?.contentHash===proof.contentHash)state.pending=null;}
  await store.save(state);
  const result=await runPublishingQueue({posts,siteUrl:site.href,publish:true,graph,store,fetchImpl,log,...(sleep?{sleep}:{})},{maximum:4,budgetMs:12*60*1000});
  const confirmed=await findExistingManualPosts(graph,posts,site);
  log({mode:'manual-confirmed',posts:confirmed.map(({postId,mediaId,permalink})=>({postId,mediaId,permalink}))});
  return {...result,confirmed:confirmed.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);const valid=args.length===1&&['--check','--publish'].includes(args[0]);
  (valid?manualInstagram({publish:args[0]==='--publish'}):Promise.reject(new PublishingError('USE_CHECK_OR_PUBLISH'))).catch(error=>{console.error(JSON.stringify({error:error instanceof PublishingError?error.code:'MANUAL_PUBLISHING_FAILED',status:error.status||null,providerCode:error.providerCode||null,providerSubcode:error.providerSubcode||null}));process.exitCode=1;});
}
