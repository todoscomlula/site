import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { configureAdminFirewall,loginFirewallRule } from '../scripts/admin/configure-admin-firewall.mjs';
import { handleAdminRequest } from '../src/server/admin/service.mjs';
import { AdminError,hashPassword,readSession } from '../src/server/admin/auth.mjs';

test('verified Vercel firewall protects login without requiring private Blob access',async()=>{
  const password=randomBytes(20).toString('hex');
  const env={VERCEL:'1',ADMIN_LOGIN_RATE_LIMIT_MODE:'vercel-firewall',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:hashPassword(password),ADMIN_SESSION_SECRET:randomBytes(48).toString('hex')};
  let storageCalls=0;const store={checkLoginRate:async()=>{storageCalls++;throw new AdminError('PRIVATE_STORAGE_BLOCKED',503);}};
  const request=value=>new Request('https://example.test/api/admin/login/',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:value})});
  const response=await handleAdminRequest(request(password),{env,store});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  const session=readSession(new Request('https://example.test/admin/',{headers:{cookie:response.headers.get('set-cookie')}}),env);assert.equal(session.email,env.ADMIN_EMAIL);
  assert.equal((await handleAdminRequest(request('invalid'),{env,store})).status,401);assert.equal(storageCalls,0);
  // The environment setting alone cannot remove the limiter in local/preview hosts.
  assert.equal((await handleAdminRequest(request(password),{env:{...env,VERCEL:undefined},store})).status,503);assert.equal(storageCalls,1);
});

test('firewall setup preserves existing rules and enables storage-independent login only after verification',async()=>{
  const env={GITHUB_REPOSITORY:'todoscomlula/site',ADMIN_VERCEL_TOKEN:'PLACEHOLDER_FOR_OFFLINE_TEST',VERCEL_PROJECT_ID:'prj_example',VERCEL_ORG_ID:'team_example'};
  const unrelated={name:'Existing rule',id:'existing',active:true};let active={firewallEnabled:true,rules:[unrelated]};let enabled=false;const methods=[];
  const fetchImpl=async(url,options)=>{
    methods.push(options.method);assert.equal(options.headers.Authorization,`Bearer ${env.ADMIN_VERCEL_TOKEN}`);
    if(url.includes('/v9/projects/'))return Response.json({id:env.VERCEL_PROJECT_ID,name:'todos-com-lula'});
    if(url.includes('/env?')){const values=JSON.parse(options.body);assert.equal(values[0].key,'ADMIN_LOGIN_RATE_LIMIT_MODE');assert.ok(active.rules.some(rule=>rule.name===loginFirewallRule.name));enabled=true;return Response.json({});}
    if(options.method==='GET')return Response.json(active);
    assert.equal(options.method,'PATCH');const change=JSON.parse(options.body);assert.equal(change.action,'rules.insert');active={...active,rules:[...active.rules,{id:'login',...change.value}]};return Response.json({});
  };
  const result=await configureAdminFirewall({env,fetchImpl});assert.equal(result.configured,true);assert.equal(enabled,true);assert.deepEqual(active.rules[0],unrelated);assert.equal(methods.includes('PUT'),false);assert.equal(JSON.stringify(result).includes(env.ADMIN_VERCEL_TOKEN),false);
  enabled=false;active.rules=[unrelated];await assert.rejects(configureAdminFirewall({env,fetchImpl:async(url,options)=>options.method==='PATCH'?new Response('{}',{status:403}):fetchImpl(url,options)}),{message:'FIREWALL_CONFIGURATION_FAILED_403'});assert.equal(enabled,false);
});
