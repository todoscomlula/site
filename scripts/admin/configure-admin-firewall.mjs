import { pathToFileURL } from 'node:url';

export const LOGIN_RULE_NAME='Admin login protection';
export const loginFirewallRule={name:LOGIN_RULE_NAME,active:true,conditionGroup:[{conditions:[{type:'method',op:'eq',value:'POST'},{type:'path',op:'re',value:'^/(api/admin/login|admin/entrar)/?$'}]}],action:{mitigate:{action:'rate_limit',rateLimit:{algo:'fixed_window',window:600,limit:10,keys:['ip'],action:'deny'}}}};
export function matchesLoginFirewallRule(rule){
  const groups=rule?.conditionGroup;const rate=rule?.action?.mitigate?.rateLimit;
  return rule?.name===LOGIN_RULE_NAME&&rule.active===true&&groups?.length===1&&groups[0].conditions?.length===2&&loginFirewallRule.conditionGroup[0].conditions.every(expected=>groups[0].conditions.some(actual=>actual.type===expected.type&&actual.op===expected.op&&actual.value===expected.value&&!actual.neg))&&rule.action.mitigate.action==='rate_limit'&&rate?.algo==='fixed_window'&&rate.window===600&&rate.limit===10&&rate.keys?.length===1&&rate.keys[0]==='ip'&&rate.action==='deny';
}
export async function configureAdminFirewall({env=process.env,fetchImpl=fetch}={}){
  if(env.GITHUB_REPOSITORY!=='todoscomlula/site'||!env.ADMIN_VERCEL_TOKEN||!env.VERCEL_PROJECT_ID||!env.VERCEL_ORG_ID)throw new Error('MISSING_VERCEL_CONFIGURATION');
  const query=new URLSearchParams({projectId:env.VERCEL_PROJECT_ID,teamId:env.VERCEL_ORG_ID});
  const headers={Authorization:`Bearer ${env.ADMIN_VERCEL_TOKEN}`,'Content-Type':'application/json'};
  const request=async(path,method='GET',body)=>{
    const response=await fetchImpl(`https://api.vercel.com${path}${path.includes('?')?'&':'?'}${query}`,{method,headers,redirect:'error',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,ok:response.ok,body:await response.json().catch(()=>({}))};
  };
  const project=await request(`/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}`);
  if(!project.ok||project.body.id!==env.VERCEL_PROJECT_ID||project.body.name!=='todos-com-lula')throw new Error('VERCEL_PROJECT_NOT_AUTHORIZED');
  let active=await request('/v1/security/firewall/config/active');
  if(!active.ok&&active.status!==404)throw new Error('FIREWALL_READ_FAILED');
  if(!(active.body.rules||[]).some(matchesLoginFirewallRule)){
    // A missing config is initialized once. Existing rules are preserved.
    const existing=(active.body.rules||[]).find(rule=>rule.name===LOGIN_RULE_NAME);
    const update=active.status===404?await request('/v1/security/firewall/config','PUT',{firewallEnabled:true,rules:[loginFirewallRule]}):await request('/v1/security/firewall/config','PATCH',{action:existing?'rules.update':'rules.insert',...(existing?{id:existing.id}:{}),value:loginFirewallRule});
    if(!update.ok)throw new Error(`FIREWALL_CONFIGURATION_FAILED_${update.status}`);
    active=await request('/v1/security/firewall/config/active');
    if(!active.ok||!(active.body.rules||[]).some(rule=>rule.name===LOGIN_RULE_NAME&&rule.active)){
      const draft=await request('/v1/security/firewall/config/draft');
      const version=draft.body.id||update.body.id;
      if(typeof version!=='string'||!version||version.length>200)throw new Error('FIREWALL_ACTIVATION_REQUIRED');
      const activated=await request(`/v1/security/firewall/config/${encodeURIComponent(version)}/activate`,'POST');
      if(!activated.ok)throw new Error('FIREWALL_ACTIVATION_FAILED');
      active=await request('/v1/security/firewall/config/active');
    }
  }
  const rule=(active.body.rules||[]).find(rule=>rule.name===LOGIN_RULE_NAME&&rule.active);
  if(!active.ok||!active.body.firewallEnabled||!matchesLoginFirewallRule(rule))throw new Error('FIREWALL_VERIFICATION_FAILED');
  const configured=await request(`/v10/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}/env?upsert=true`,'POST',[{key:'ADMIN_LOGIN_RATE_LIMIT_MODE',value:'vercel-firewall',type:'plain',target:['production']}]);
  if(!configured.ok)throw new Error('LOGIN_ENV_CONFIGURATION_FAILED');
  return {configured:true,loginRateLimit:'vercel-firewall',requests:10,windowSeconds:600};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)configureAdminFirewall().then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:/^[A-Z_]+(?:_\d+)?$/.test(error.message)?error.message:'FIREWALL_CONFIGURATION_FAILED'}));process.exitCode=1;});
