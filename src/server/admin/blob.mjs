import { get, put, head, del, BlobPreconditionFailedError, BlobError } from '@vercel/blob';
import { setTimeout as sleep } from 'node:timers/promises';
import { AdminError, digest } from './auth.mjs';
import { emptyAdminState, validateAdminState } from './state.mjs';

export const STATE_PATH = 'queue/admin-state.json';
const alreadyExists = (error) => error instanceof BlobError && /already exists/i.test(error.message);
export function createBlobStore(env = process.env, sdk = { get, put, head, del }) {
  const options = { access: 'private', ...(env.ADMIN_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN ? { token: env.ADMIN_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN } : {}) };
  const read = async (path, maximum = 2 * 1024 * 1024) => {
    const result = await sdk.get(path,{...options,useCache:false,abortSignal:AbortSignal.timeout(30000)});
    if (!result) return { value:null, etag:null };
    if (!result.stream || result.blob.size > maximum) throw new AdminError('INVALID_PRIVATE_RECORD',503);
    const raw = await new Response(result.stream).text();
    if (Buffer.byteLength(raw)>maximum) throw new AdminError('INVALID_PRIVATE_RECORD',503);
    return { value:JSON.parse(raw), etag:result.blob.etag };
  };
  const write = (path,value,etag) => sdk.put(path,JSON.stringify(value),{...options,addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),contentType:'application/json',cacheControlMaxAge:60,abortSignal:AbortSignal.timeout(30000)});
  return {
    async load(){const {value}=await read(STATE_PATH);return value===null?emptyAdminState():validateAdminState(value);},
    async mutate(change){
      for(let attempt=0;attempt<5;attempt++){
        const {value,etag}=await read(STATE_PATH);const state=value===null?emptyAdminState():validateAdminState(value);const result=await change(state);
        validateAdminState(state);
        try{await write(STATE_PATH,state,etag);return {state,result};}
        catch(error){if(!(error instanceof BlobPreconditionFailedError || alreadyExists(error)))throw new AdminError('PRIVATE_STORAGE_UNAVAILABLE',503);await sleep(40*(attempt+1));}
      }
      throw new AdminError('STATE_BUSY',409);
    },
    async checkLoginRate(identifier,now=Date.now()){
      const path=`auth/rate-${digest(identifier)}.json`;
      for(let attempt=0;attempt<5;attempt++){
        const {value,etag}=await read(path,4096);const current=value&&Number.isInteger(value.attempts)&&Number.isFinite(value.until)&&value.until>now?value:{attempts:0,until:now+15*60_000};
        if(current.attempts>=10)throw new AdminError('LOGIN_RATE_LIMIT',429);
        current.attempts++;
        try{await write(path,current,etag);return;}catch(error){if(!(error instanceof BlobPreconditionFailedError||alreadyExists(error)))throw new AdminError('PRIVATE_STORAGE_UNAVAILABLE',503);}
      }
      throw new AdminError('LOGIN_RATE_LIMIT',429);
    },
    async readJson(path){return (await read(path)).value;},
    async putJson(path,value){const {etag}=await read(path);await write(path,value,etag);},
    async upload(path,bytes,contentType){
      try{return await sdk.put(path,bytes,{...options,addRandomSuffix:false,allowOverwrite:false,contentType,cacheControlMaxAge:86400,abortSignal:AbortSignal.timeout(180000)});}
      catch(error){if(alreadyExists(error))return sdk.head(path,options);throw new AdminError('PRIVATE_UPLOAD_FAILED',503);}
    },
    async download(path){const result=await sdk.get(path,{...options,useCache:true,abortSignal:AbortSignal.timeout(180000)});if(!result?.stream)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',404);return Buffer.from(await new Response(result.stream).arrayBuffer());},
    async preview(path,range){
      const meta=await sdk.head(path,options);const url=new URL(meta.url);
      if(url.protocol!=='https:'||!url.hostname.endsWith('.private.blob.vercel-storage.com')||url.search||url.username||url.password)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',503);
      const result=await sdk.get(path,{...options,useCache:true,...(range?{headers:{Range:range}}:{}),abortSignal:AbortSignal.timeout(30000)});
      if(!result?.stream)throw new AdminError('PRIVATE_MEDIA_UNAVAILABLE',404);
      return {result,meta};
    },
    async remove(path){await sdk.del(path,options);},
  };
}
