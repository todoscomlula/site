import { get, put, head, del, BlobPreconditionFailedError, BlobError, BlobAccessError, BlobStoreSuspendedError, BlobServiceRateLimited } from '@vercel/blob';
import { setTimeout as sleep } from 'node:timers/promises';
import { AdminError, digest } from './auth.mjs';
import { emptyAdminState, validateAdminState } from './state.mjs';

export const STATE_PATH = 'queue/admin-state.json';
const alreadyExists = (error) => error instanceof BlobError && /already exists/i.test(error.message);
export const storageRetrySeconds = code => ['PRIVATE_STORAGE_BLOCKED','PRIVATE_STORAGE_ACCESS_DENIED'].includes(code) ? 3600 : code==='PRIVATE_STORAGE_RATE_LIMIT' ? 300 : code==='PRIVATE_STORAGE_UNAVAILABLE' ? 60 : null;
export function createBlobStore(env = process.env, sdk = { get, put, head, del }, fetchImpl = fetch) {
  const options = { access: 'private', ...(env.ADMIN_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN ? { token: env.ADMIN_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN } : {}) };
  let blockedUntil=0;let blockedCode=null;
  const storageError=async(error,path)=>{
    if(error instanceof AdminError)return error;
    let code='PRIVATE_STORAGE_UNAVAILABLE';
    if(error instanceof BlobStoreSuspendedError)code='PRIVATE_STORAGE_BLOCKED';
    else if(error instanceof BlobServiceRateLimited)code='PRIVATE_STORAGE_RATE_LIMIT';
    else if(error instanceof BlobAccessError || /Failed to fetch blob: 403\b/.test(error?.message||'')){
      code='PRIVATE_STORAGE_ACCESS_DENIED';
      // SDK get() discards the CDN's reason for a 403. Probe only this failure,
      // with the credential in a header, and never expose its response body.
      if(path&&options.token)try{
        const meta=await sdk.head(path,options);const url=new URL(meta.url);
        if(url.protocol==='https:'&&url.hostname.endsWith('.private.blob.vercel-storage.com')&&!url.search&&!url.username&&!url.password){
          const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${options.token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
          if(response.status===403){const body=await response.text();if(body.length<4096&&/store (?:is |has been )?(?:blocked|suspended)/i.test(body))code='PRIVATE_STORAGE_BLOCKED';}
          else await response.body?.cancel();
        }
      }catch{/* A failed diagnostic cannot hide the original access error. */}
    }
    if(storageRetrySeconds(code)>=300){blockedUntil=Date.now()+60000;blockedCode=code;}
    return new AdminError(code,503);
  };
  const operation=async(path,task)=>{
    if(blockedCode&&Date.now()<blockedUntil)throw new AdminError(blockedCode,503);
    try{return await task();}catch(error){if(error instanceof BlobPreconditionFailedError||alreadyExists(error))throw error;throw await storageError(error,path);}
  };
  const read = async (path, maximum = 2 * 1024 * 1024) => {
    const result = await operation(path,()=>sdk.get(path,{...options,useCache:false,abortSignal:AbortSignal.timeout(30000)}));
    if (!result) return { value:null, etag:null };
    if (!result.stream || result.blob.size > maximum) throw new AdminError('INVALID_PRIVATE_RECORD',503);
    const raw = await new Response(result.stream).text();
    if (Buffer.byteLength(raw)>maximum) throw new AdminError('INVALID_PRIVATE_RECORD',503);
    // The private GET transport can prefix the stored entity tag with W/.
    // Blob's conditional-write API expects the original quoted entity tag.
    return { value:JSON.parse(raw), etag:result.blob.etag.replace(/^W\//,'') };
  };
  const write = (path,value,etag) => operation(path,()=>sdk.put(path,JSON.stringify(value),{...options,addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),contentType:'application/json',cacheControlMaxAge:60,abortSignal:AbortSignal.timeout(30000)}));
  return {
    async load(){const {value}=await read(STATE_PATH);return value===null?emptyAdminState():validateAdminState(value);},
    async mutate(change){
      for(let attempt=0;attempt<5;attempt++){
        const {value,etag}=await read(STATE_PATH);const state=value===null?emptyAdminState():validateAdminState(value);const original=JSON.stringify(state);const result=await change(state);
        validateAdminState(state);
        if(value!==null&&JSON.stringify(state)===original)return {state,result};
        try{await write(STATE_PATH,state,etag);return {state,result};}
        catch(error){if(!(error instanceof BlobPreconditionFailedError || alreadyExists(error)))throw error;await sleep(40*(attempt+1));}
      }
      throw new AdminError('STATE_BUSY',409);
    },
    async checkLoginRate(identifier,now=Date.now()){
      const path=`auth/rate-${digest(identifier)}.json`;
      for(let attempt=0;attempt<5;attempt++){
        const {value,etag}=await read(path,4096);const current=value&&Number.isInteger(value.attempts)&&Number.isFinite(value.until)&&value.until>now?value:{attempts:0,until:now+15*60_000};
        if(current.attempts>=10)throw new AdminError('LOGIN_RATE_LIMIT',429);
        current.attempts++;
        try{await write(path,current,etag);return;}catch(error){if(!(error instanceof BlobPreconditionFailedError||alreadyExists(error)))throw error;}
      }
      throw new AdminError('LOGIN_RATE_LIMIT',429);
    },
    async readJson(path){return (await read(path)).value;},
    async mutateJson(path,change){
      for(let attempt=0;attempt<5;attempt++){
        const {value,etag}=await read(path);const original=JSON.stringify(value);const next=await change(value);
        if(value!==null&&JSON.stringify(next)===original)return next;
        try{await write(path,next,etag);return next;}
        catch(error){if(!(error instanceof BlobPreconditionFailedError||alreadyExists(error)))throw error;}
      }
      throw new AdminError('STATE_BUSY',409);
    },
    async putJson(path,value){const previous=await read(path);if(previous.value!==null&&JSON.stringify(previous.value)===JSON.stringify(value))return;await write(path,value,previous.etag);},
    async upload(path,bytes,contentType){
      try{return await operation(path,()=>sdk.put(path,bytes,{...options,addRandomSuffix:false,allowOverwrite:false,contentType,cacheControlMaxAge:86400,abortSignal:AbortSignal.timeout(180000)}));}
      catch(error){if(alreadyExists(error))return operation(path,()=>sdk.head(path,options));throw await storageError(error,path);}
    },
    async download(path){const result=await operation(path,()=>sdk.get(path,{...options,useCache:true,abortSignal:AbortSignal.timeout(180000)}));if(!result?.stream)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',404);return Buffer.from(await new Response(result.stream).arrayBuffer());},
    async preview(path,range){
      const meta=await operation(path,()=>sdk.head(path,options));const url=new URL(meta.url);
      if(url.protocol!=='https:'||!url.hostname.endsWith('.private.blob.vercel-storage.com')||url.search||url.username||url.password)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',503);
      const result=await operation(path,()=>sdk.get(path,{...options,useCache:true,...(range?{headers:{Range:range}}:{}),abortSignal:AbortSignal.timeout(30000)}));
      if(!result?.stream)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',404);
      return {result,meta};
    },
    async remove(path){await operation(path,()=>sdk.del(path,options));},
  };
}
