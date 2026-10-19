import { QueueClient } from '@vercel/queue';
import { processInstagramTick,enqueueInstagram } from './runtime.mjs';
import { createInstagramQueueHandler, instagramQueueRetry } from './queue-handler.mjs';

const queue=new QueueClient({region:'iad1'});
export default queue.handleNodeCallback(createInstagramQueueHandler(processInstagramTick,{reschedule:enqueueInstagram,report:status=>console.warn(JSON.stringify({event:'instagram-paused',...status}))}),{retry:instagramQueueRetry});
