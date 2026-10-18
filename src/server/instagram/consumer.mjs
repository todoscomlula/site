import { QueueClient } from '@vercel/queue';
import { processInstagramTick } from './runtime.mjs';
import { createInstagramQueueHandler, instagramQueueRetry } from './queue-handler.mjs';

const queue=new QueueClient({region:'iad1'});
export default queue.handleNodeCallback(createInstagramQueueHandler(processInstagramTick),{retry:instagramQueueRetry});
