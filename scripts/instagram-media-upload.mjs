import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PublishingError} from './instagram-publishing/core.mjs';

export async function uploadDirectImage({bytes,id,scanDirectory}) {
  const configuration='{"git":{"deploymentEnabled":false}}\n';
  await writeFile(scanDirectory+'/vercel.json',configuration,{mode:0o600});
  execFileSync('.git/tools/gitleaks',['dir',scanDirectory,'--redact','--no-banner','--no-color'],{stdio:['ignore','pipe','pipe']});
  const token=execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const request=async(path,{method='GET',body,missing=false}={})=>{
    const response=await fetch('https://api.github.com/repos/todoscomlula/site/'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(missing&&response.status===404)return null;if(!response.ok)throw new PublishingError('DIRECT_MEDIA_UPLOAD_FAILED',response.status);return response.json();
  };
  const sha256=createHash('sha256').update(bytes).digest('hex');const filename=sha256+'.jpg';
  const branch=await request('git/ref/heads/instagram-media',{missing:true});
  if(!branch){
    const blob=await request('git/blobs',{method:'POST',body:{content:bytes.toString('base64'),encoding:'base64'}});
    const tree=await request('git/trees',{method:'POST',body:{tree:[{path:filename,mode:'100644',type:'blob',sha:blob.sha},{path:'vercel.json',mode:'100644',type:'blob',content:configuration}]}});
    const commit=await request('git/commits',{method:'POST',body:{message:'Add reviewed Instagram image [skip ci]',tree:tree.sha,parents:[]}});
    await request('git/refs',{method:'POST',body:{ref:'refs/heads/instagram-media',sha:commit.sha}});
  }else{
    const existing=await request('contents/'+filename+'?ref=instagram-media',{missing:true});
    if(!existing)await request('contents/'+filename,{method:'PUT',body:{message:'Add reviewed Instagram image [skip ci]',branch:'instagram-media',content:bytes.toString('base64')}});
  }
  return {sha256,imageUrl:'https://raw.githubusercontent.com/todoscomlula/site/instagram-media/'+filename};
}
