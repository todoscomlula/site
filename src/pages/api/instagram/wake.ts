import type { APIRoute } from 'astro';
import { constantEqual } from '../../../server/admin/auth.mjs';
import { enqueueInstagram } from '../../../server/instagram/runtime.mjs';
export const prerender=false;
export const GET:APIRoute=async({request})=>{
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<40||!constantEqual(request.headers.get('authorization'),`Bearer ${secret}`))return new Response(null,{status:401});
  try{return Response.json(await enqueueInstagram(),{headers:{'Cache-Control':'private, no-store'}});}
  catch{return Response.json({error:'INSTAGRAM_QUEUE_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
};
