import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const layouts=['timeline-dark','comparison-light','editorial-red'];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function wrap(text,limit){const result=[];let line='';for(const word of text.split(/\s+/)){if(line&&line.length+word.length+1>limit){result.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)result.push(line);return result;}
const text=(lines,x,y,size,color,weight=400,gap=1.22)=>lines.map((line,i)=>`<text x="${x}" y="${y+i*size*gap}" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(line)}</text>`).join('');
export function renderDebateSvg(input,layout='timeline-dark'){
  if(!layouts.includes(layout)||typeof input.headline!=='string'||input.headline.length>100||typeof input.source!=='string'||input.source.length>80||!Array.isArray(input.items)||input.items.length!==2||input.items.some(item=>typeof item.label!=='string'||item.label.length>35||typeof item.text!=='string'||item.text.length>150))throw new Error('INVALID_DEBATE_CARD');
  const dark=layout==='timeline-dark',red=layout==='editorial-red';const bg=dark?'#0B202A':red?'#B81936':'#F7F4EE';const ink=dark||red?'#F7F4EE':'#132B31';const accent=dark?'#C9F27D':red?'#F4CE47':'#087A63';
  let body=`<rect width="1080" height="1350" fill="${bg}"/>`;
  if(red)body+='<path d="M1030 0H1080V1350H900Z" fill="#F4CE47"/>';
  body+=text(['TODOS COM LULA'],72,94,24,ink,700)+text([input.kicker||'DEBATE · EM TEMPO REAL'],72,181,26,accent,700);
  const headline=wrap(input.headline,19);if(headline.length>4)throw new Error('HEADLINE_TOO_LONG');
  body+=text(headline,70,294,78,ink,800,1.08);
  if(dark){body+='<path d="M100 615V1015" stroke="#5D7480" stroke-width="3"/>';
    for(const[item,i]of input.items.map((item,i)=>[item,i])){const y=646+i*245;body+=`<circle cx="100" cy="${y-10}" r="12" fill="${accent}"/>`+text([item.label],145,y,29,accent,700)+text(wrap(item.text,31),145,y+66,38,ink,500,1.3);}
  }else if(!red){
    body+='<path d="M72 545H1008" stroke="#132B31" stroke-width="3"/>';
    input.items.forEach((item,i)=>{const y=632+i*234;body+=text([item.label],72,y,30,accent,800)+text(wrap(item.text,35),72,y+64,39,ink,500,1.28);if(i===0)body+='<path d="M72 795H1008" stroke="#B5C6BF" stroke-width="2"/>';});
  }else{
    input.items.forEach((item,i)=>{const y=638+i*236;body+=text([item.label],72,y,31,accent,800)+text(wrap(item.text,32),72,y+66,39,ink,500,1.25);});
  }
  body+=`<path d="M72 1120H1008" stroke="${ink}" stroke-width="1" opacity=".35"/>`;
  body+=text(['Fonte: '+input.source],72,1170,24,ink,600)+text(['#fakenewsdebatetemporeal'],72,1232,27,accent,700)+text(['@BORAAALULA2026 · INICIATIVA INDEPENDENTE'],72,1295,18,ink,500);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><g font-family="Arial,sans-serif">${body}</g></svg>`;
}
async function main(){const[inputPath,outputPath,requested='auto']=process.argv.slice(2);if(!inputPath||!outputPath)throw new Error('USE_INPUT_OUTPUT_LAYOUT');const input=JSON.parse(await readFile(inputPath,'utf8'));const stateFile='.cache/debate-live/layout-state.json';let state={next:0};try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch{}const layout=requested==='auto'?layouts[state.next%layouts.length]:requested;const svg=renderDebateSvg(input,layout);const{default:sharp}=await import('sharp');await mkdir(dirname(outputPath),{recursive:true});await sharp(Buffer.from(svg)).jpeg({quality:94,mozjpeg:true}).toFile(outputPath);await writeFile(outputPath.replace(/\.[^.]+$/,'.svg'),svg);await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile,JSON.stringify({next:(layouts.indexOf(layout)+1)%layouts.length,last:layout})+'\n',{mode:0o600});console.log(JSON.stringify({card:outputPath,layout}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Não foi possível renderizar o card.');process.exitCode=1;});
