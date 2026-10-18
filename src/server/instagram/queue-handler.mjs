import { AdminError } from '../admin/auth.mjs';
import { storageRetrySeconds } from '../admin/blob.mjs';

// Preserve delivery on infrastructure failures. Meta's processing polls are
// scheduled separately by the publisher, and do not use this retry path.
export function instagramQueueRetry(error,metadata={}){
  const seconds=storageRetrySeconds(error?.code);
  if(seconds)return {afterSeconds:seconds};
  return {afterSeconds:Math.min(3600,300*2**Math.min(4,Math.max(0,(metadata.deliveryCount||1)-1)))};
}
export function createInstagramQueueHandler(processTick){
  return async(message,metadata)=>{
    if(!message||Object.keys(message).join(',')!=='version'||message.version!==1)throw new Error('INVALID_INSTAGRAM_QUEUE_MESSAGE');
    try{await processTick({messageId:metadata.messageId});}
    catch(error){
      if(error instanceof AdminError&&storageRetrySeconds(error.code))throw error;
      throw new Error('INSTAGRAM_QUEUE_RETRY');
    }
  };
}
