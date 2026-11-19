import type {pick6Batch,BatchTarget,BatchProgress} from '../server/pick6Batch.ts';
export async function runPick6Batch(target:BatchTarget,testMode:boolean,onProgress:(p:BatchProgress)=>void):Promise<Awaited<ReturnType<typeof pick6Batch>>>{
 const response=await fetch('/api/pick6-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,testMode})});
 if(!response.ok)throw new Error((await response.json()).error??'One-touch action unavailable.');
 if(!response.body)throw new Error('Progress connection unavailable. Check ticket history before retrying.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result:Awaited<ReturnType<typeof pick6Batch>>|undefined;
 const line=(text:string)=>{if(!text.trim())return;const event=JSON.parse(text);if(event.type==='error')throw new Error(event.message);if(event.type==='progress')onProgress(event);if(event.type==='result')result=event.result;};
 try{while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let n;while((n=buffer.indexOf('\n'))>=0){line(buffer.slice(0,n));buffer=buffer.slice(n+1);}if(done){line(buffer);break;}}}finally{reader.releaseLock();}
 if(!result)throw new Error('Generation connection ended before confirmation. Check history before retrying; automatic retry is disabled.');return result;
}
