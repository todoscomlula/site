import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {main as publish} from './instagram-direct.mjs';
import {PublishingError} from './instagram-publishing/core.mjs';
async function main(){
  const args=process.argv.slice(2),options={};let send=false;
  for(let i=0;i<args.length;i++){if(args[i]==='--publish'){send=true;continue;}if(!['--image','--caption-file','--id'].includes(args[i])||!args[i+1])throw new PublishingError('USE_IMAGE_CAPTION_FILE_ID');options[args[i].slice(2)]=args[++i];}
  if(!options.image||!options['caption-file']||!/^[a-zA-Z0-9_-]{1,120}$/.test(options.id||''))throw new PublishingError('USE_IMAGE_CAPTION_FILE_ID');
  const caption=(await readFile(options['caption-file'],'utf8')).trim();if(caption.length<15||Array.from(caption).length>2200)throw new PublishingError('INVALID_DIRECT_CAPTION');
  const directory='.cache/instagram-direct/prepare-'+options.id;await mkdir(directory,{recursive:true,mode:0o700});
  const {default:sharp}=await import('sharp');const bytes=await sharp(options.image).rotate().resize(1080,1350,{fit:'contain',background:'#F4CE47'}).flatten({background:'#F4CE47'}).jpeg({quality:94,mozjpeg:true}).toBuffer();
  const sha256=createHash('sha256').update(bytes).digest('hex');const name=sha256.slice(0,12)+'.jpg';const path=directory+'/'+name;await writeFile(path,bytes,{mode:0o600});await writeFile(directory+'/caption.txt',caption,{mode:0o600});
  execFileSync('.git/tools/gitleaks',['dir',directory,'--redact','--no-banner','--no-color'],{stdio:['ignore','pipe','pipe']});
  const tag='instagram-direct-'+options.id;const gh=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
  let release;try{release=JSON.parse(gh(['release','view',tag,'--repo','todoscomlula/site','--json','assets']));}catch{}
  if(!release)gh(['release','create',tag,path,'--repo','todoscomlula/site','--title','Instagram: '+options.id,'--notes','Imagem para publicação direta no Instagram; sem atualização do site.']);
  else if(!release.assets.some(asset=>asset.name===name))gh(['release','upload',tag,path,'--repo','todoscomlula/site']);
  const post={id:options.id,title:caption.split('\n')[0].slice(0,1000),caption,imageUrl:'https://github.com/todoscomlula/site/releases/download/'+tag+'/'+name,sha256,reviewApprovedAt:new Date().toISOString()};
  const file=directory+'/post.json';await writeFile(file,JSON.stringify(post,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({mode:'direct-prepared',postFile:file,runtime:'local',websiteChanged:false}));if(send)await publish(['--publish',file]);
}
main().catch(error=>{console.error(JSON.stringify({error:error instanceof PublishingError?error.code:'DIRECT_PREPARATION_FAILED'}));process.exitCode=1;});
