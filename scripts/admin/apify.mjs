import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { AdminError } from '../../src/server/admin/auth.mjs';
import { validUsername } from '../../src/server/admin/state.mjs';

// These limits are deliberately fixed. Extra paid actor features stay disabled.
export const APIFY_RUN_CENTS = 2;
export const APIFY_MONTH_CENTS = 400;
const api = 'https://api.apify.com/v2/';
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9]{10,40}$/.test(value);
export const collectorProvider = env => env.COLLECTION_PROVIDER === 'apify' || !!env.APIFY_API_TOKEN ? 'apify' : 'storiesig';
export const collectorConfiguration = env => ({provider:collectorProvider(env),configured:collectorProvider(env)!=='apify'||!!env.APIFY_API_TOKEN,checkedAt:new Date().toISOString()});

async function boundedBytes(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw new AdminError('COLLECTION_RESPONSE_TOO_LARGE',503);
  }
  const parts = []; let size = 0;
  for await (const part of response.body || []) {
    size += part.length;
    if (size > maximum) throw new AdminError('COLLECTION_RESPONSE_TOO_LARGE',503);
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export function instagramMediaUrl(value) {
  let url; try { url = new URL(value); } catch { throw new AdminError('INVALID_COLLECTED_MEDIA',503); }
  if (url.protocol!=='https:' || url.username || url.password || url.port ||
      !['cdninstagram.com','fbcdn.net'].some(domain => url.hostname.endsWith('.'+domain))) {
    throw new AdminError('INVALID_COLLECTED_MEDIA',503);
  }
  return url;
}

export function normalizeReels(items, username, now=Date.now()) {
  if (!validUsername(username) || !Array.isArray(items) || items.length>10) throw new AdminError('INVALID_COLLECTION_RESULT',503);
  const seen = new Set(); const result = [];
  for (const item of items) {
    if (!item || item.error) throw new AdminError('APIFY_SOURCE_UNAVAILABLE',503);
    if (item.ownerUsername?.toLowerCase()!==username || typeof item.videoUrl!=='string') continue;
    const at = Date.parse(item.timestamp);
    if (!Number.isFinite(at) || at<now-14*86400000 || at>now+3600000) continue;
    let url; try { url = new URL(item.url); } catch { continue; }
    if (url.protocol!=='https:' || !['www.instagram.com','instagram.com'].includes(url.hostname) ||
        url.username || url.password || url.port || !/^\/(?:reel|reels|p)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) continue;
    const permalink = 'https://www.instagram.com'+url.pathname.replace(/\/?$/,'/');
    if (seen.has(permalink)) continue;
    seen.add(permalink);
    const caption = typeof item.caption==='string' ? item.caption.slice(0,4000) : '';
    result.push({source:username,tab:'reels',permalink,caption,title:caption.split('\n').find(line=>line.trim())?.slice(0,120)||`Publicação de @${username}`,videoUrl:instagramMediaUrl(item.videoUrl).href,publishedLabel:new Date(at).toISOString()});
    if (result.length===2) break;
  }
  return result;
}

export function createApifyCollector({env=process.env,store,fetchImpl=fetch,wait=sleep,now=Date.now}={}) {
  async function request(path, body) {
    if (!env.APIFY_API_TOKEN) throw new AdminError('APIFY_NOT_CONFIGURED',503);
    let response;
    try {
      response = await fetchImpl(new URL(path,api),{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${env.APIFY_API_TOKEN}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    } catch { throw new AdminError('APIFY_UNAVAILABLE',503); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AdminError([401,403].includes(response.status)?'APIFY_INVALID_KEY':response.status===402?'APIFY_CREDITS_REQUIRED':response.status===429?'APIFY_RATE_LIMIT':'APIFY_UNAVAILABLE',503);
    }
    try { return JSON.parse((await boundedBytes(response,2*1024*1024)).toString('utf8')); }
    catch (error) { throw error instanceof AdminError ? error : new AdminError('INVALID_COLLECTION_RESULT',503); }
  }

  async function collect(username,{timeout=240000}={}) {
    if (!env.APIFY_API_TOKEN) throw new AdminError('APIFY_NOT_CONFIGURED',503);
    if (!validUsername(username)) throw new AdminError('INVALID_USERNAME');
    const path = `queue/apify-runs/${username}.json`;
    let checkpoint = await store.readJson(path);
    if (checkpoint && !checkpoint.consumed && !identifier(checkpoint.id)) throw new AdminError('APIFY_START_UNCERTAIN',503);
    if (!checkpoint || checkpoint.consumed) {
      const month = new Date(now()).toISOString().slice(0,7);
      const budgetPath = 'queue/apify-budget.json';
      const prior = await store.readJson(budgetPath);
      if (prior && (!/^\d{4}-\d{2}$/.test(prior.month) || !Number.isSafeInteger(prior.reservedCents) || prior.reservedCents<0)) throw new AdminError('INVALID_PRIVATE_RECORD',503);
      const reserved = prior?.month===month ? prior.reservedCents : 0;
      if (reserved+APIFY_RUN_CENTS>APIFY_MONTH_CENTS) throw new AdminError('APIFY_BUDGET_REACHED',503);
      // Worker lease serializes these writes. Reserve before submitting, even if the
      // response is lost: an ambiguous POST must never be retried automatically.
      await store.putJson(budgetPath,{month,reservedCents:reserved+APIFY_RUN_CENTS});
      checkpoint = {startedAt:new Date(now()).toISOString(),id:null,consumed:false};
      await store.putJson(path,checkpoint);
      let started;
      try {
        started = await request('actors/apify~instagram-reel-scraper/runs?timeout=180&maxItems=2&maxTotalChargeUsd=0.02&restartOnError=false',{
          username:[username],resultsLimit:2,onlyPostsNewerThan:new Date(now()-14*86400000).toISOString(),skipPinnedPosts:true,
          includeSharesCount:false,includeTranscript:false,includeDownloadedVideo:false,
        });
      } catch (error) {
        // Authentication and explicit credit errors cannot have started a run.
        if (['APIFY_NOT_CONFIGURED','APIFY_INVALID_KEY','APIFY_CREDITS_REQUIRED','APIFY_RATE_LIMIT'].includes(error.code)) await store.putJson(path,{...checkpoint,consumed:true});
        throw error;
      }
      if (!identifier(started?.data?.id)) throw new AdminError('APIFY_START_UNCERTAIN',503);
      checkpoint.id = started.data.id;
      await store.putJson(path,checkpoint);
    }
    const deadline = now()+Math.min(timeout,240000);
    for (let polls=0; polls<50 && now()<deadline; polls++) {
      const {data:run} = await request(`actor-runs/${checkpoint.id}`);
      if (!run || run.id!==checkpoint.id) throw new AdminError('INVALID_COLLECTION_RESULT',503);
      if (run.status==='SUCCEEDED') {
        if (!identifier(run.defaultDatasetId)) throw new AdminError('INVALID_COLLECTION_RESULT',503);
        const items = await request(`datasets/${run.defaultDatasetId}/items?format=json&clean=true&limit=2`);
        return {reels:normalizeReels(items,username,now()),async complete(){await store.putJson(path,{...checkpoint,consumed:true});}};
      }
      if (['FAILED','ABORTED','TIMED-OUT'].includes(run.status)) {
        await store.putJson(path,{...checkpoint,consumed:true});
        throw new AdminError('APIFY_RUN_FAILED',503);
      }
      await wait(5000);
    }
    // Keep the run ID so the next cycle can retrieve the same result.
    throw new AdminError('APIFY_RUN_PENDING',503);
  }

  return {collect,async check(){const result=await request('users/me');if(!result?.data?.id)throw new AdminError('APIFY_INVALID_KEY',503);return 'verified';}};
}

export async function stageApifyReels(reels,{fetchImpl=fetch}={}) {
  await mkdir('/tmp/lula-storiesig',{recursive:true,mode:0o700});
  const directory = await mkdtemp('/tmp/lula-storiesig/apify-');
  try {
    const seeds = [];
    for (const [index,reel] of reels.entries()) {
      let url=instagramMediaUrl(reel.videoUrl); let response;
      for (let redirects=0; redirects<4; redirects++) {
        try { response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(90000)}); }
        catch { throw new AdminError('COLLECTION_MEDIA_UNAVAILABLE',503); }
        if (![301,302,303,307,308].includes(response.status)) break;
        const location=response.headers.get('location');await response.body?.cancel();
        if(!location)throw new AdminError('INVALID_COLLECTED_MEDIA',503);
        url=instagramMediaUrl(new URL(location,url).href);
      }
      if (!response?.ok) throw new AdminError('COLLECTION_MEDIA_UNAVAILABLE',503);
      const bytes=await boundedBytes(response,90*1024*1024);
      if (bytes.length<12 || bytes.toString('ascii',4,8)!=='ftyp') throw new AdminError('INVALID_COLLECTED_MEDIA',503);
      const path=join(directory,`${index}.mp4`);
      await writeFile(path,bytes,{mode:0o600});
      const {videoUrl,...metadata}=reel;
      seeds.push({...metadata,path});
    }
    const metadataPath=join(directory,'metadata.json');
    await writeFile(metadataPath,JSON.stringify(seeds),{mode:0o600});
    return {metadataPath,async cleanup(){await rm(directory,{recursive:true,force:true});}};
  } catch(error) { await rm(directory,{recursive:true,force:true});throw error; }
}
