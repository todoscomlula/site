import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {main as publish,directCarouselHash} from './instagram-direct.mjs';
import {PublishingError} from './instagram-publishing/core.mjs';
import {uploadDirectImage} from './instagram-media-upload.mjs';
async function main(){
  const args=process.argv.slice(2),options={images:[]};let send=false;
  for(let i=0;i<args.length;i++){if(args[i]==='--publish'){send=true;continue;}if(!['--image','--caption-file','--id'].includes(args[i])||!args[i+1])throw new PublishingError('USE_IMAGE_CAPTION_FILE_ID');const key=args[i].slice(2),value=args[++i];if(key==='image')options.images.push(value);else options[key]=value;}
  if(options.images.length<1||options.images.length>10||!options['caption-file']||!/^[a-zA-Z0-9_-]{1,120}$/.test(options.id||''))throw new PublishingError('USE_IMAGE_CAPTION_FILE_ID');
  const caption=(await readFile(options['caption-file'],'utf8')).trim();if(caption.length<15||Array.from(caption).length>2200)throw new PublishingError('INVALID_DIRECT_CAPTION');
  const directory='.cache/instagram-direct/prepare-'+options.id;await mkdir(directory,{recursive:true,mode:0o700});
  const {default:sharp}=await import('sharp');const prepared=[];
  for(const path of options.images){const bytes=await sharp(path).rotate().resize(1080,1350,{fit:'contain',background:'#F4CE47'}).flatten({background:'#F4CE47'}).jpeg({quality:94,mozjpeg:true}).toBuffer();const sha256=createHash('sha256').update(bytes).digest('hex');await writeFile(directory+'/'+sha256.slice(0,12)+'.jpg',bytes,{mode:0o600});prepared.push({bytes,sha256});}
  await writeFile(directory+'/caption.txt',caption,{mode:0o600});
  execFileSync('.git/tools/gitleaks',['dir',directory,'--redact','--no-banner','--no-color'],{stdio:['ignore','pipe','pipe']});
  const images=[];for(const image of prepared)images.push(await uploadDirectImage({bytes:image.bytes,id:options.id,scanDirectory:directory}));
  const post={id:options.id,title:caption.split('\n')[0].slice(0,1000),caption,...(images.length===1?{imageUrl:images[0].imageUrl,sha256:images[0].sha256}:{kind:'CAROUSEL',images,sha256:directCarouselHash(images)}),reviewApprovedAt:new Date().toISOString()};
  const file=directory+'/post.json';await writeFile(file,JSON.stringify(post,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({mode:'direct-prepared',postFile:file,runtime:'local',websiteChanged:false}));if(send)await publish(['--publish',file]);
}
main().catch(error=>{console.error(JSON.stringify({error:error instanceof PublishingError?error.code:'DIRECT_PREPARATION_FAILED'}));process.exitCode=1;});
