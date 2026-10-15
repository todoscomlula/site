import { build } from 'esbuild';
import { mkdir,writeFile } from 'node:fs/promises';
const directory='.vercel/output/functions/instagram-queue.func';
await mkdir(directory,{recursive:true});
await build({entryPoints:['src/server/instagram/consumer.mjs'],outfile:directory+'/index.mjs',bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},logLevel:'silent'});
await writeFile(directory+'/.vc-config.json',JSON.stringify({runtime:'nodejs24.x',handler:'index.mjs',launcherType:'Nodejs',maxDuration:180,experimentalTriggers:[{type:'queue/v2beta',topic:'instagram-publishing',retryAfterSeconds:60}]}));
console.log('Consumidor privado do Instagram preparado para Vercel Queues.');
