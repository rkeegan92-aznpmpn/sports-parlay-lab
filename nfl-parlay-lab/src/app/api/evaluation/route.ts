import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {savedGrades} from '@/server/savedGrades.ts';
export const dynamic='force-dynamic';
export async function GET(){try{
 const db=getDb(),grades=savedGrades(db),rows=db.prepare('SELECT id,kind,created_at,purpose,source,legs_json,(SELECT strategy FROM pick6_batch_archives b WHERE b.ticket_id=saved_tickets.id LIMIT 1) strategy FROM saved_tickets ORDER BY id DESC LIMIT 200').all() as {id:number;strategy:string|null;kind:string;created_at:number;purpose:string;source:string;legs_json:string}[];
 const forward=rows.filter(r=>['live','manual','mixed'].includes(r.source)&&!/backtest|simulat|demo/i.test(r.purpose));
 const tickets=forward.map(r=>{let legs=[];try{const parsed=JSON.parse(r.legs_json);if(Array.isArray(parsed)&&parsed.every(l=>l&&['name','pos','market','side','kickoff'].every(k=>typeof l[k]==='string')))legs=parsed;}catch{}return {...r,detailsUnavailable:legs.length!==6,legs_json:undefined,legs,grade:grades[r.id]??{status:'pending',finalized:false,legs:[]}};});
 const unique=new Map<string,{pos:string;market:string;hit:number}>();
 for(const t of tickets)for(let i=0;i<t.grade.legs.length;i++){const g=t.grade.legs[i],leg=t.legs[i];if(g.status==='settled'&&g.hit!=null&&typeof g.actual==='number'&&Number.isFinite(g.actual)&&['nflverse','espn'].includes(g.resultSource??'')&&leg&&typeof (leg.historyPlayerId??g.resolvedPlayerId)==='string'&&g.resultGameId)unique.set(`${leg.historyPlayerId??g.resolvedPlayerId}|${g.resultGameId}|${leg.market.replace(/_alternate$/,'')}|${leg.side}|${leg.line}`,{pos:leg.pos,market:leg.market.replace(/_alternate$/,''),hit:g.hit});}
 const data=[...unique.values()],summarize=(rows:typeof data)=>({n:rows.length,wins:rows.filter(r=>r.hit===1).length,winRate:rows.length?rows.filter(r=>r.hit===1).length/rows.length:null});
 return NextResponse.json({tickets,excludedNonForwardArchives:rows.length-forward.length,accuracy:{...summarize(data),byPosition:Object.fromEntries([...new Set(data.map(r=>r.pos))].map(p=>[p,summarize(data.filter(r=>r.pos===p))])),byMarket:Object.fromEntries([...new Set(data.map(r=>r.market))].map(p=>[p,summarize(data.filter(r=>r.market===p))]))},scope:'Latest 200 saved tickets; deduplicated decisive legs with verified actual statistics. Historical simulations are excluded.'},{headers:{'Cache-Control':'no-store'}});
}catch{return NextResponse.json({error:'Ticket evaluation unavailable; saved records were preserved.'},{status:503});}}
