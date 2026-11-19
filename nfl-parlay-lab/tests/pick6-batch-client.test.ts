import test from 'node:test';
import assert from 'node:assert/strict';
import {runPick6Batch} from '../src/lib/pick6BatchClient.ts';
test('streamed progress survives arbitrary chunks and preserves final confirmation',async()=>{
 const old=globalThis.fetch,events:string[]=[],encoder=new TextEncoder();try{
  const bytes=encoder.encode(JSON.stringify({type:'progress',stage:'cache',message:'Checking…'})+'\n'+JSON.stringify({type:'result',result:{created:4,summary:'saved'}})+'\n');
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));c.close();}}));
  const result=await runPick6Batch('live',false,p=>events.push(p.message));assert.deepEqual(events,['Checking…']);assert.equal(result.created,4);assert.equal(result.summary,'saved');
 }finally{globalThis.fetch=old;}
});
test('streamed and HTTP failures surface without auto-retrying or reporting success',async()=>{
 const old=globalThis.fetch;let requests=0;try{
  globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({type:'error',message:'PropLine paused'})+'\n');};await assert.rejects(runPick6Batch('paper',false,()=>{}),/PropLine paused/);assert.equal(requests,1);
  globalThis.fetch=async()=>{requests++;return Response.json({error:'Invalid batch action'},{status:400});};await assert.rejects(runPick6Batch('live',false,()=>{}),/Invalid batch action/);assert.equal(requests,2);
 }finally{globalThis.fetch=old;}
});
test('interrupted progress without final confirmation requires history inspection instead of retry',async()=>{
 const old=globalThis.fetch;let requests=0;try{globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({type:'progress',stage:'save',message:'Saving'})+'\n');};await assert.rejects(runPick6Batch('live',false,()=>{}),/Check history before retrying/);assert.equal(requests,1);}finally{globalThis.fetch=old;}
});
