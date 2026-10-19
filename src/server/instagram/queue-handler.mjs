import { AdminError } from '../admin/auth.mjs';
import { storageRetrySeconds } from '../admin/blob.mjs';

// Preserve delivery on infrastructure failures. Meta's processing polls are
// scheduled separately by the publisher, and do not use this retry path.
export function instagramQueueRetry(error,metadata={}){
  const seconds=storageRetrySeconds(error?.code);
  if(seconds)return {afterSeconds:seconds};
  return {afterSeconds:Math.min(3600,300*2**Math.min(4,Math.max(0,(metadata.deliveryCount||1)-1)))};
}
export function createInstagramQueueHandler(processTick,{reschedule,report=()=>{},now=Date.now}={}){
  return async(message,metadata)=>{
    if(!message||Object.keys(message).join(',')!=='version'||message.version!==1)throw new Error('INVALID_INSTAGRAM_QUEUE_MESSAGE');
    try{await processTick({messageId:metadata.messageId});}
    catch(error){
      if(error instanceof AdminError&&storageRetrySeconds(error.code)){
        if(!reschedule)throw error;
        const delaySeconds=storageRetrySeconds(error.code);
        // Acknowledge only after a replacement delivery is durable. Concurrent
        // blocked deliveries share a retry key instead of multiplying forever.
        await reschedule({delaySeconds,idempotencyKey:`instagram-storage-wait-${Math.floor((now()+delaySeconds*1000)/(delaySeconds*1000))}`});
        const status={mode:'paused',code:error.code,nextAttemptAt:new Date(now()+delaySeconds*1000).toISOString()};
        report(status);return status;
      }
      throw new Error('INSTAGRAM_QUEUE_RETRY');
    }
  };
}
