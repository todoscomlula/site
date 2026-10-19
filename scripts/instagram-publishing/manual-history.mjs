import { MANUAL_STATE_BRANCH,PublishingError,emptyState,validateState } from './core.mjs';

export async function readManualHistory({fetchImpl=fetch,now=Date.now()}={}){
  let response;
  try{response=await fetchImpl(`https://raw.githubusercontent.com/todoscomlula/site/refs/heads/${MANUAL_STATE_BRANCH}/state.json?checkpoint=${Math.floor(now/10000)}`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}
  catch{throw new PublishingError('MANUAL_HISTORY_UNAVAILABLE');}
  if(response.status===404)return emptyState();
  if(!response.ok)throw new PublishingError('MANUAL_HISTORY_UNAVAILABLE');
  const raw=await response.text();if(raw.length>2*1024*1024)throw new PublishingError('INVALID_MANUAL_HISTORY');
  try{return validateState(JSON.parse(raw));}catch{throw new PublishingError('INVALID_MANUAL_HISTORY');}
}

export function mergeManualHistory(current,manual,now=Date.now()){
  const result=validateState(structuredClone(current));validateState(manual);
  if(manual.pending||(manual.lease&&Date.parse(manual.lease.expiresAt)>now))throw new PublishingError('MANUAL_PUBLISHING_ACTIVE');
  const completed=new Map(result.published.map(item=>[item.contentHash,item]));
  for(const proof of manual.published){
    const previous=completed.get(proof.contentHash);
    if(previous&&previous.mediaId&&proof.mediaId&&previous.mediaId!==proof.mediaId)throw new PublishingError('MANUAL_PUBLISHING_CONFLICT');
    if(!previous){result.published.push(structuredClone(proof));completed.set(proof.contentHash,proof);}
    if(result.pending?.contentHash===proof.contentHash)result.pending=null;
  }
  return validateState(result);
}
