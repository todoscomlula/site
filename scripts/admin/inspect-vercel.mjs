import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createBlobStore } from '../../src/server/admin/blob.mjs';

// Output is an allowlist: never serialize provider responses, credentials,
// environment variables, private files, or raw exception messages.
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:null;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export async function inspectVercel({env=process.env,fetchImpl=fetch,store=createBlobStore(env)}={}){
  if(env.GITHUB_REPOSITORY!=='todoscomlula/site'||!env.ADMIN_VERCEL_TOKEN||!env.VERCEL_PROJECT_ID||!env.VERCEL_ORG_ID)throw new Error('MISSING_VERCEL_CONFIGURATION');
  const request=async path=>{
    const response=await fetchImpl(`https://api.vercel.com${path}${path.includes('?')?'&':'?'}teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`,{headers:{Authorization:`Bearer ${env.ADMIN_VERCEL_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(20000)});
    const body=await response.json().catch(()=>({}));return{ok:response.ok,status:response.status,body};
  };
  const project=await request(`/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}`);
  const authorized=project.ok&&project.body.id===env.VERCEL_PROJECT_ID&&project.body.name==='todos-com-lula';
  const report={authorized,projectStatus:project.status,projectError:label(project.body.error?.code)};
  if(authorized){
    const stores=await request('/v1/storage/stores');
    report.storageStatus=stores.status;
    report.stores=(stores.body.stores||[]).filter(item=>item.type==='blob').map(item=>({id:label(item.id),status:label(item.status),billingState:label(item.billingState),usageQuotaExceeded:item.usageQuotaExceeded===true}));
    const team=await request(`/v2/teams/${encodeURIComponent(env.VERCEL_ORG_ID)}`);
    const block=team.body.featureBlocks?.blob;
    report.plan=label(team.body.billing?.plan);report.blobBlock=block?{blockedFrom:date(block.blockedFrom),blockedUntil:date(block.blockedUntil)}:null;
  }
  try{const state=await store.load();report.privateStorage={readable:true,candidates:state.candidates.length};}
  catch(error){report.privateStorage={readable:false,code:/^PRIVATE_STORAGE_[A-Z_]+$/.test(error.code||'')?error.code:'PRIVATE_STORAGE_CHECK_FAILED'};}
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  inspectVercel().then(async report=>{console.log(JSON.stringify(report));if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`authorized=${report.authorized}\n`);}).catch(()=>{console.error(JSON.stringify({error:'VERCEL_INSPECTION_FAILED'}));process.exitCode=1;});
}
