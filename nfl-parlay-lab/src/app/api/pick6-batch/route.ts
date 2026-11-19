import {getDb} from '@/server/db.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {paperKeys,PaperError} from '@/server/paper.ts';
import {PropLineError} from '@/server/propline.ts';
import {pick6Batch,Pick6BatchError} from '@/server/pick6Batch.ts';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};let body;
 try{const text=await request.text();if(text.length>250)return Response.json({error:'Request too large.'},{status:413,headers});body=JSON.parse(text);}catch{return Response.json({error:'Invalid batch action.'},{status:400,headers});}
 if(!body||typeof body!=='object'||Array.isArray(body)||!['live','paper'].includes(body.target)||Object.keys(body).some(k=>!['target','testMode'].includes(k))||body.testMode!==undefined&&typeof body.testMode!=='boolean'||body.target==='paper'&&body.testMode)return Response.json({error:'Choose live or paper; paper tickets cannot use TEST MODE. No client-supplied selections, odds or stakes accepted.'},{status:400,headers});
 const encoder=new TextEncoder();
 const stream=new ReadableStream({async start(controller){
  let connected=true;const send=(value:unknown)=>{if(connected)try{controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));}catch{connected=false;}};
  try{const db=getDb();const result=await pick6Batch(db,paperKeys(),body.target,body.testMode===true,cachedProviderFetch(db),fetch,Date.now(),progress=>send({type:'progress',...progress}));send({type:'result',result});}
  catch(e){const message=e instanceof Pick6BatchError||e instanceof PaperError||e instanceof PropLineError?e.message:'One-touch generation failed: verified data or storage unavailable. Check history before retrying; no substitute picks or real wagers were created.';send({type:'error',message});}
  finally{if(connected)try{controller.close();}catch{/* Disconnected clients can inspect durable history. */}}
 }});
 return new Response(stream,{headers:{...headers,'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'}});
}
