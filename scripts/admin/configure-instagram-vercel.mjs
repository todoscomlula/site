import { pathToFileURL } from 'node:url';

// Runs only in the protected GitHub environment. The existing Instagram
// credential travels directly to Vercel's environment-variable API.
export async function configureInstagramVercel({env=process.env,fetchImpl=fetch}={}){
  if(env.GITHUB_REPOSITORY!=='todoscomlula/site'||!env.ADMIN_VERCEL_TOKEN||!env.VERCEL_PROJECT_ID||!env.VERCEL_ORG_ID||!env.INSTAGRAM_ACCESS_TOKEN||!env.ADMIN_WORKER_SECRET||env.ADMIN_WORKER_SECRET.length<40)throw new Error('MISSING_RUNTIME_CONFIGURATION');
  const base=`https://api.vercel.com/v10/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}`;
  const headers={Authorization:`Bearer ${env.ADMIN_VERCEL_TOKEN}`,'Content-Type':'application/json'};
  const check=await fetchImpl(`https://api.vercel.com/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!check.ok)throw new Error('VERCEL_PROJECT_NOT_AUTHORIZED');
  const project=await check.json();if(project.id!==env.VERCEL_PROJECT_ID||project.name!=='todos-com-lula')throw new Error('WRONG_VERCEL_PROJECT');
  const values=[{key:'INSTAGRAM_ACCESS_TOKEN',value:env.INSTAGRAM_ACCESS_TOKEN,type:'sensitive'},{key:'CRON_SECRET',value:env.ADMIN_WORKER_SECRET,type:'sensitive'},{key:'INSTAGRAM_API_VERSION',value:env.INSTAGRAM_API_VERSION||'v26.0',type:'plain'},{key:'INSTAGRAM_PUBLISHING_RUNTIME',value:'vercel',type:'plain'}];
  if(env.INSTAGRAM_USER_ID)values.push({key:'INSTAGRAM_USER_ID',value:env.INSTAGRAM_USER_ID,type:'sensitive'});
  if(['true','false'].includes(env.INSTAGRAM_NATIVE_PAUSED))values.push({key:'INSTAGRAM_NATIVE_PAUSED',value:env.INSTAGRAM_NATIVE_PAUSED,type:'plain'});
  const response=await fetchImpl(`${base}/env?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}&upsert=true`,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),body:JSON.stringify(values.map(item=>({...item,target:['production']})))});
  if(!response.ok)throw new Error('VERCEL_ENV_CONFIGURATION_FAILED');
  return{configured:true,project:'todos-com-lula',runtime:'vercel',variables:values.map(item=>item.key)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){configureInstagramVercel().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({error:['MISSING_RUNTIME_CONFIGURATION','VERCEL_PROJECT_NOT_AUTHORIZED','WRONG_VERCEL_PROJECT','VERCEL_ENV_CONFIGURATION_FAILED'].includes(error.message)?error.message:'RUNTIME_CONFIGURATION_FAILED'}));process.exitCode=1;});}
