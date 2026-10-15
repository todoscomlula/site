import { QueueClient } from '@vercel/queue';
import { processInstagramTick } from './runtime.mjs';

const queue=new QueueClient({region:'iad1'});
export default queue.handleNodeCallback(async(message,metadata)=>{
  if(!message||Object.keys(message).join(',')!=='version'||message.version!==1)throw new Error('INVALID_INSTAGRAM_QUEUE_MESSAGE');
  try{await processInstagramTick({messageId:metadata.messageId});}
  catch{throw new Error('INSTAGRAM_QUEUE_RETRY');}
},{retry:()=>({afterSeconds:60})});
