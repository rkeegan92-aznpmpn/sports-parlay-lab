import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {freeSchedule,freePlayers,manualResearch,parseManualQuote,ManualInputError} from '@/server/freeResearch.ts';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function entries() {return getDb().prepare('SELECT id,input_json,captured_at FROM manual_quotes WHERE retired_at IS NULL ORDER BY id').all() as {id:number;input_json:string;captured_at:number}[];}
export async function GET(req:Request) {
  try {
    const db=getDb(),f=cachedProviderFetch(db),games=await freeSchedule(f);
    const eventId=new URL(req.url).searchParams.get('event');
    const event=games.find(g=>g.id===eventId);
    const people=event?await freePlayers(event,f):null;
    return NextResponse.json({games,people,quotes:entries().map(r=>({id:r.id,...JSON.parse(r.input_json)})),
      source:'Free nflverse schedules/statistics + ESPN roster verification. Manual quote prices are not live API-verified. Injury report freshness and final inactive status require separate checks.'},{headers});
  }catch{return NextResponse.json({error:'Free provider data is unavailable. Existing quotes and saved tickets are preserved. Retry later; no substitute data was generated.'},{status:503,headers});}
}
export async function POST(req:Request) {
  try {
    if(Number(req.headers.get('content-length')??0)>100000)return NextResponse.json({error:'Request too large.'},{status:413,headers});
    const text=await req.text();
    if(text.length>100000)throw new ManualInputError('Request too large.');
    let body;try{body=JSON.parse(text);}catch{throw new ManualInputError('Send a valid JSON request.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ManualInputError('Send a research action object.');
    const db=getDb(),f=cachedProviderFetch(db);
    if(body.action==='retire') {
      if(!Number.isSafeInteger(body.id)||body.id<1)throw new ManualInputError('Choose an existing quote.');
      db.prepare('UPDATE manual_quotes SET retired_at=? WHERE id=? AND retired_at IS NULL').run(Date.now(),body.id);
      return NextResponse.json({message:'Quote removed from the active pool; historical record retained.'},{headers});
    }
    if(body.action==='add') {
      const q=parseManualQuote(body.quote,await freeSchedule(f));
      const checked=await manualResearch([q],f);
      if(!checked.candidates.length)throw new ManualInputError(checked.pipelineRejections.map(r=>r.reason).join(' ')||'This player/market could not be matched to verified history and current roster. No quote was saved.');
      const old=entries().filter(r=>{const x=JSON.parse(r.input_json);return x.eventId===q.eventId&&x.player===q.player&&x.market===q.market&&x.side===q.side&&x.line===q.line;});
      if(entries().length-old.length>=60)throw new ManualInputError('Retire an active quote before adding more than 60.');
      const result=db.transaction(()=>{
        for(const row of old)db.prepare('UPDATE manual_quotes SET retired_at=? WHERE id=?').run(Date.now(),row.id);
        return db.prepare('INSERT INTO manual_quotes(input_json,captured_at) VALUES(?,?)').run(JSON.stringify(q),Date.now());
      })();
      return NextResponse.json({id:Number(result.lastInsertRowid),message:'Manual quote saved — user-entered, not verified live odds.'},{status:201,headers});
    }
    if(body.action!=='generate')throw new ManualInputError('Unknown research action.');
    const games=await freeSchedule(f),now=Date.now(),excluded:{id:number;reason:string}[]=[],active:unknown[]=[];
    for(const row of entries())try{active.push(parseManualQuote(JSON.parse(row.input_json),games,now));}catch(e){excluded.push({id:row.id,reason:e instanceof Error?e.message:'Invalid entry'});}
    return NextResponse.json({...await manualResearch(active,f,now,body.testMode===true),excluded},{headers});
  }catch(error){return NextResponse.json({error:error instanceof ManualInputError?error.message:'Research data retrieval failed. Records were preserved; no substitute picks were added.'},{status:error instanceof ManualInputError?400:503,headers});}
}
