import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {MetaClient} from './instagram-publishing/meta-client.mjs';
import {GithubStateStore} from './instagram-publishing/state-store.mjs';
import {MANUAL_STATE_BRANCH,PublishingError,contentKey,validateState} from './instagram-publishing/core.mjs';
import {connectLocalInstagram} from './instagram-local-auth.mjs';

export function validateDirectPost(post,now=Date.now()) {
  if(!post||!/^[a-zA-Z0-9_-]{1,160}$/.test(post.id)||typeof post.caption!=='string'||post.caption.length<15||Array.from(post.caption).length>2200||typeof post.title!=='string'||post.title.length>1000||!/^[a-f0-9]{64}$/.test(post.sha256||''))throw new PublishingError('INVALID_DIRECT_POST');
  const age=now-Date.parse(post.reviewApprovedAt);if(!Number.isFinite(age)||age< -300000||age>48*3600000)throw new PublishingError('DIRECT_POST_NOT_REVIEWED');
  let url;try{url=new URL(post.imageUrl);}catch{throw new PublishingError('INVALID_DIRECT_IMAGE');}
  const release=url.origin==='https://github.com'&&/^\/todoscomlula\/site\/releases\/download\/[a-zA-Z0-9_-]+\/[a-f0-9]{12}\.jpg$/.test(url.pathname);
  const raw=url.origin==='https://raw.githubusercontent.com'&&url.pathname==='/todoscomlula/site/instagram-media/'+post.sha256+'.jpg';
  if((!release&&!raw)||url.username||url.password||url.search||url.hash)throw new PublishingError('INVALID_DIRECT_IMAGE');
  return post;
}
export async function publishDirect({post,graph,store,publish=false,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=e=>console.log(JSON.stringify(e)),now=Date.now}={}) {
  validateDirectPost(post,now());await graph.verifyAccount();
  const key=contentKey({id:post.id,contentGroupId:post.id});
  const state=validateState(await store.load({create:publish}));
  const proof=state.published.find(p=>p.contentHash===key);
  const lookup=async()=>{const data=await graph.request(graph.userId+'/media',{query:{fields:'id,caption,permalink,timestamp',limit:'100'}});if(!Array.isArray(data.data))throw new PublishingError('INVALID_META_MEDIA_LIST');return data.data.find(p=>typeof p.caption==='string'&&p.caption.trim()===post.caption.trim());};
  if(proof){const media=await lookup();log({mode:'direct-existing',postId:post.id,permalink:media?.permalink||null});return{published:false,permalink:media?.permalink||null};}
  if(!publish){log({mode:'direct-ready',postId:post.id,runtime:'local',kind:'IMAGE'});return{published:false};}
  if(state.lease&&Date.parse(state.lease.expiresAt)>now())throw new PublishingError('PUBLISHING_LOCK_ACTIVE');
  if(state.pending&&state.pending.postId!==post.id)throw new PublishingError('DIRECT_PENDING_OUTSIDE_POST');
  const owner=randomUUID();state.lease={owner,expiresAt:new Date(now()+15*60000).toISOString()};
  const save=()=>store.save(validateState(state));await save();
  const finish=async media=>{if(!state.published.some(p=>p.contentHash===key))state.published.push({contentHash:key,postId:post.id,mediaId:media?.id||null,publishedAt:media?.timestamp?new Date(media.timestamp).toISOString():new Date(now()).toISOString()});state.pending=null;await save();};
  try {
    const existing=await lookup();if(existing){await finish(existing);log({mode:'direct-existing',postId:post.id,permalink:existing.permalink});return{published:false,permalink:existing.permalink};}
    if(state.pending?.stage==='publishing'){
      if(await graph.containerStatus(state.pending.containerId)!=='PUBLISHED')throw new PublishingError('PUBLISHING_RESULT_UNCERTAIN');
      const media=await lookup();await finish(media);return{published:false,recovered:true,permalink:media?.permalink||null};
    }
    if(!state.pending){
      const image=await fetchImpl(post.imageUrl,{redirect:'follow',signal:AbortSignal.timeout(30000)});if(!image.ok||image.headers.get('content-type')?.split(';')[0]!=='image/jpeg')throw new PublishingError('DIRECT_IMAGE_UNAVAILABLE');
      const declared=Number(image.headers.get('content-length'));if(declared>8*1024*1024)throw new PublishingError('DIRECT_IMAGE_TOO_LARGE');
      const chunks=[];let length=0;for await(const chunk of image.body){length+=chunk.length;if(length>8*1024*1024)throw new PublishingError('DIRECT_IMAGE_TOO_LARGE');chunks.push(chunk);}const bytes=Buffer.concat(chunks);
      if(createHash('sha256').update(bytes).digest('hex')!==post.sha256)throw new PublishingError('DIRECT_IMAGE_HASH_MISMATCH');
      const quota=await graph.quota();if(!Number.isInteger(quota.used)||!Number.isInteger(quota.maximum)||quota.used>=quota.maximum)throw new PublishingError('META_PUBLISHING_LIMIT');
      state.pending={postId:post.id,contentHash:key,containerId:null,stage:'reserved',createdAt:new Date(now()).toISOString()};await save();
    }
    if(!state.pending.containerId){
      const containerId=await graph.createContainer({kind:'IMAGE',mediaUrl:post.imageUrl,post:{title:post.title}},post.caption);if(typeof containerId!=='string'||!/^\d{1,40}$/.test(containerId))throw new PublishingError('INVALID_CONTAINER_ID');
      state.pending.containerId=containerId;state.pending.stage='processing';await save();
    }
    let status;for(let attempt=0;attempt<=5;attempt++){status=await graph.containerStatus(state.pending.containerId);if(['FINISHED','PUBLISHED'].includes(status))break;if(status!=='IN_PROGRESS')throw new PublishingError('DIRECT_CONTAINER_'+String(status).replace(/[^A-Z_]/g,''));if(attempt===5)throw new PublishingError('DIRECT_CONTAINER_NOT_READY');await sleep(60000);}
    if(status!=='PUBLISHED'){
      await graph.verifyAccount();state.pending.stage='publishing';await save();
      const mediaId=await graph.publishContainer(state.pending.containerId);if(typeof mediaId!=='string'||!/^\d{1,40}$/.test(mediaId))throw new PublishingError('INVALID_PUBLISHED_MEDIA_ID');
      await finish({id:mediaId});
    }else await finish(await lookup());
    const media=await lookup();log({mode:'direct-published',runtime:'local',postId:post.id,permalink:media?.permalink||null});return{published:true,permalink:media?.permalink||null};
  }finally{state.lease=null;await save();}
}
export async function main(args=process.argv.slice(2)) {
  if(args.length!==2||!['--check','--publish'].includes(args[0]))throw new PublishingError('USE_DIRECT_CHECK_OR_PUBLISH_WITH_POST_FILE');
  const post=validateDirectPost(JSON.parse(await readFile(args[1],'utf8')));
  let credentials;
  if(process.env.INSTAGRAM_ACCESS_TOKEN)credentials={accessToken:process.env.INSTAGRAM_ACCESS_TOKEN,userId:process.env.INSTAGRAM_USER_ID||undefined,version:process.env.INSTAGRAM_API_VERSION||'v26.0'};
  else{try{credentials=JSON.parse(await readFile('.cache/instagram-direct/credentials.json','utf8'));}catch{credentials=await connectLocalInstagram();}}
  const graph=new MetaClient(credentials);
  const token=process.env.GITHUB_TOKEN||execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const store=new GithubStateStore({token,repository:'todoscomlula/site',branch:MANUAL_STATE_BRANCH});
  return publishDirect({post,graph,store,publish:args[0]==='--publish'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({error:error instanceof PublishingError?error.code:'DIRECT_PUBLISHING_FAILED',status:error.status||null}));process.exitCode=1;});
