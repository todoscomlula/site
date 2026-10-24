import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const DEBATE_SOURCES={g1:'https://g1.globo.com/politica/eleicoes/2026/ao-vivo/debate-globo-segundo-turno.ghtml',uol:'https://noticias.uol.com.br/ao-vivo/2026/10/23/radar-da-eleicao-lula-e-flavio-debatem-na-globo-uol-confere-faz-checagem.htm',checagem:'https://checagemaovivo.org/'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const entities=value=>value.replace(/&(?:nbsp|amp|quot|lt|gt|apos);|&#(?:x[0-9a-f]+|[0-9]+);/gi,s=>{const named={'&nbsp;':' ','&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&apos;':"'"};if(named[s])return named[s];const number=s.startsWith('&#x')?parseInt(s.slice(3,-1),16):parseInt(s.slice(2,-1),10);return Number.isFinite(number)&&number<=0x10ffff?String.fromCodePoint(number):'';});
const strip=value=>clean(entities(String(value).replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')));
export function classifyEntry(title,text){
  // A candidate's accusation or an ordinary news report is not a fact-check.
  const lead=clean(title||text.split('\n')[0]);
  return /^(?:🔎\s*)?UOL Confere\s*:/i.test(lead)||/^É\s+#?(?:FAKE|FATO)\b/i.test(lead)||/^Fato ou Fake\s*(?::|$)/i.test(lead)||/\bCHECAGEM\s*:/i.test(text)?'factcheck':'news';
}
function entry(source,id,title,text,publishedAt=null,timeLabel=null){
  const body=text.trim().slice(0,4500);const heading=clean(title)||clean(body).slice(0,140);
  const stableHeading=heading.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLowerCase();
  return{id:source+':'+(id||hash(stableHeading).slice(0,24)),source,sourceUrl:DEBATE_SOURCES[source],title:heading,text:body,publishedAt:publishedAt&&Number.isFinite(Date.parse(publishedAt))?new Date(publishedAt).toISOString():null,timeLabel:timeLabel||null,kind:classifyEntry(title,body),reviewRequired:true,contentHash:hash(stableHeading+'\0'+clean(body))};
}
export function parseG1(data){
  if(!Array.isArray(data?.posts?.items))throw new Error('INVALID_G1_FEED');
  return data.posts.items.map(post=>{
    const blocks=post.body?.blocks||[];const item=entry('g1',post.id,post.title,blocks.map(block=>block.text||'').filter(Boolean).join('\n'),post.created);
    const badge=blocks.map(block=>block.data?.caption||'').map(caption=>caption.normalize('NFD').replace(/[\u0300-\u036f]/g,'')).find(caption=>/^Selo\s+(?:Fato|Fake|Nao e Bem Assim)\b/i.test(caption));
    const verdict=badge?.match(/^Selo\s+(Fato|Fake|Nao e Bem Assim)\b/i)?.[1].toUpperCase();
    item.verdict=verdict?.startsWith('NAO ')?'NAO_E_BEM_ASSIM':verdict||null;
    const links=[];const walk=value=>{if(typeof value==='string'&&/^https:\/\/g1\.globo\.com\/fato-ou-fake\//.test(value))links.push(value);else if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')Object.values(value).forEach(walk);};walk(post.body);item.links=[...new Set(links)];
    if(item.verdict)item.kind='factcheck';item.contentHash=hash(item.contentHash+'\0'+(item.verdict||'')+'\0'+item.links.join('\n'));return item;
  }).filter(item=>item.text);
}
export function parseUol(html){
  const headings=[...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  return headings.map((match,index)=>{const title=strip(match[1]);const body=strip(html.slice(match.index+match[0].length,headings[index+1]?.index||html.length)).split(/Continua após a publicidade|Newsletter|PRA COMEÇAR O DIA/i)[0].trim();return entry('uol',null,title,body.slice(0,4500));}).filter(item=>item.title&&item.text&&!/resumo da cobertura|newsletter|assine|sobre o uol/i.test(item.title));
}
export function parseChecagem(data){
  if(!Array.isArray(data?.claims))throw new Error('INVALID_CHECAGEM_FEED');
  const verdicts={falso:'FAKE',verdadeiro:'FATO',parcial:'NAO_E_BEM_ASSIM',inconclusivo:'INCONCLUSIVO'};
  return data.claims.filter(claim=>claim.publication==='published'&&claim.status==='completed'&&typeof claim.id==='string'&&typeof claim.quote==='string').map(claim=>{
    const speaker=clean(claim.speaker?.name||claim.speaker_name||'Não identificado');
    const item=entry('checagem',claim.id,speaker+': '+clean(claim.quote).slice(0,120),'FALA: '+claim.quote+'\nCHECAGEM: '+(claim.explanation||claim.text||''),claim.captured_at);
    item.kind='factcheck';item.verdict=verdicts[claim.verdict]||null;item.speaker=speaker;item.quote=claim.quote;
    item.reviewStatus=claim.review||'unknown';item.preliminary=claim.review!=='reviewed';
    item.explanation=String(claim.explanation||'').slice(0,8000);item.report=String(claim.report||'').slice(0,16000);
    item.links=(claim.sources||[]).map(source=>source.url).filter(url=>typeof url==='string'&&/^https?:\/\//.test(url));
    item.sourceUpdatedAt=claim.updated_at||null;
    item.contentHash=hash(item.contentHash+'\0'+(item.verdict||'')+'\0'+item.reviewStatus+'\0'+item.report+'\0'+item.links.join('\n'));return item;
  });
}
async function fetchChecagem(fetchImpl){
  const base='https://checagemaovivo.org/api/stream';
  const response=await fetchImpl(base+'/public/rooms/debate-sexta/manifest.json',{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('CHECAGEM_HTTP_'+response.status);
  const manifest=await response.json();
  if(manifest.available!==true||!Array.isArray(manifest.blocks))throw new Error('INVALID_CHECAGEM_MANIFEST');
  const blocks=await Promise.all(manifest.blocks.map(async path=>{
    if(typeof path!=='string'||!/^\/public\/rooms\/debate-sexta\/blocks\/[a-f0-9]{64}\.json$/.test(path))throw new Error('INVALID_CHECAGEM_BLOCK');
    const result=await fetchImpl(base+path,{signal:AbortSignal.timeout(20000)});if(!result.ok)throw new Error('CHECAGEM_BLOCK_HTTP_'+result.status);return result.json();
  }));
  return{source:'checagem',status:'public-feed',liveNow:manifest.room?.status==='live',entries:parseChecagem({claims:blocks.flatMap(block=>block.claims||[])})};
}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}
async function discoverG1(directory){
  const cache=await readJson(directory+'/g1-source.json',null);
  const valid=url=>/^https:\/\/bslive\.globo\.com\/v1\/live\/g1\/[a-f0-9-]{36}$/.test(url||'');
  if(cache?.sourceUrl===DEBATE_SOURCES.g1&&valid(cache.endpoint))return cache.endpoint;
  const{chromium}=await import('playwright');const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{const page=await browser.newPage();const endpoint=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('G1_FEED_NOT_FOUND')),30000);page.on('response',response=>{const url=response.url().split('?')[0];if(valid(url)){clearTimeout(timeout);resolve(url);}});});await page.goto(DEBATE_SOURCES.g1,{waitUntil:'domcontentloaded',timeout:30000});const url=await endpoint;await writeFile(directory+'/g1-source.json',JSON.stringify({sourceUrl:DEBATE_SOURCES.g1,endpoint:url})+'\n',{mode:0o600});return url;}finally{await browser.close();}
}
export async function collectDebate({directory='.cache/debate-live',uolSnapshot=null,fetchImpl=fetch}={}){
  await mkdir(directory,{recursive:true,mode:0o700});
  const results=await Promise.allSettled([
    (async()=>{const endpoint=await discoverG1(directory);const response=await fetchImpl(endpoint,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('G1_HTTP_'+response.status);const data=await response.json();return{source:'g1',status:'live',liveNow:data.live?.liveNow===true,entries:parseG1(data)};})(),
    (async()=>{const response=await fetchImpl(DEBATE_SOURCES.uol,{redirect:'follow',signal:AbortSignal.timeout(20000)});if(!response.ok){await response.body?.cancel();return{source:'uol',status:response.status===403?'blocked':'unavailable',httpStatus:response.status,entries:[]};}return{source:'uol',status:'public-page',entries:parseUol(await response.text())};})(),
    fetchChecagem(fetchImpl)
  ]);
  const sources=results.map((result,i)=>result.status==='fulfilled'?result.value:{source:['g1','uol','checagem'][i],status:'unavailable',entries:[]});
  if(uolSnapshot){const imported=await readJson(uolSnapshot,null);if(imported?.sourceUrl!==DEBATE_SOURCES.uol||!Array.isArray(imported.entries))throw new Error('INVALID_UOL_PUBLIC_SNAPSHOT');const source=sources.find(s=>s.source==='uol');if(source.entries.length===0){source.localStatus=source.status;source.status='imported-public-snapshot';source.snapshotObservedAt=imported.observedAt;source.snapshotAgeSeconds=Math.round((Date.now()-Date.parse(imported.observedAt))/1000);source.entries=imported.entries.map(item=>entry('uol',item.id,item.title,item.text,item.publishedAt,item.timeLabel));}}
  const seen=await readJson(directory+'/seen.json',{});const queue=await readJson(directory+'/queue.json',{});const publications=await readJson(directory+'/publications.json',{});const fresh=[];
  for(const source of sources)for(const item of source.entries){if(seen[item.id]!==item.contentHash){item.updated=Boolean(seen[item.id]);fresh.push(item);queue[item.id]=item;seen[item.id]=item.contentHash;}}
  for(const item of Object.values(queue))if(publications[item.id]){item.publication=publications[item.id];item.reviewRequired=Boolean(item.updated);}
  const observedAt=new Date().toISOString();await writeFile(directory+'/seen.json',JSON.stringify(seen,null,2)+'\n',{mode:0o600});await writeFile(directory+'/queue.json',JSON.stringify(queue,null,2)+'\n',{mode:0o600});
  const snapshot={observedAt,sources,newItems:fresh,publicationAutomatic:false};await writeFile(directory+'/latest.json',JSON.stringify(snapshot,null,2)+'\n',{mode:0o600});
  return{observedAt,sources:sources.map(({entries,...source})=>({...source,entries:entries.length})),newItems:fresh.length,newFactChecks:fresh.filter(item=>item.kind==='factcheck').length};
}
async function main(){const args=process.argv.slice(2);let minutes=0,interval=30,uolSnapshot=null;for(let i=0;i<args.length;i++){if(args[i]==='--watch-minutes')minutes=Number(args[++i]);else if(args[i]==='--interval-seconds')interval=Number(args[++i]);else if(args[i]==='--uol-snapshot')uolSnapshot=args[++i];else throw new Error('INVALID_ARGUMENT');}if(!Number.isFinite(minutes)||minutes<0||minutes>120||!Number.isFinite(interval)||interval<30||interval>300)throw new Error('INVALID_WATCH_INTERVAL');const end=Date.now()+minutes*60000;do{console.log(JSON.stringify(await collectDebate({uolSnapshot})));if(!minutes||Date.now()+interval*1000>end)break;await new Promise(resolve=>setTimeout(resolve,interval*1000));}while(Date.now()<end);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Não foi possível concluir a coleta do debate.');process.exitCode=1;});
