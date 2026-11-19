import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {readBoard,assertBoardUsable,providerAccessStatus} from '@/server/fanduelRest.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {freeSchedule} from '@/server/freeResearch.ts';
import {analyzeDiscovery,type ManualDiscovered} from '@/server/marketDiscovery.ts';
import {providerTimestamp} from '@/server/providerTimestamp.ts';
import {TEAM_ABBR} from '@/lib/service.ts';
import {validPrice,statToken} from '@/lib/propMarkets.ts';
export const dynamic='force-dynamic';const headers={'Cache-Control':'no-store'};
export async function POST(request:Request){
 try{
  const text=await request.text();if(text.length>5000)return NextResponse.json({error:'Request too large.'},{status:413,headers});
  const body=JSON.parse(text),db=getDb(),f=cachedProviderFetch(db),now=Date.now();
  if(body.action==='manual'){
   const q=body.quote,at=providerTimestamp(q?.observedAt),games=await freeSchedule(f,now),g=games.find(g=>g.id===q?.eventId);
   if(!q||!g||!['player','team','period','stat'].every(k=>typeof q[k]==='string'&&q[k].trim()&&q[k].length<120)||![TEAM_ABBR[g.home_team],TEAM_ABBR[g.away_team]].includes(q.team)||!['game','q1','q2','q3','q4','h1','h2'].includes(q.period)||!['Over','Under','AtLeast'].includes(q.side)||typeof q.line!=='number'||!Number.isFinite(q.line)||q.line<0||q.line>2000||!validPrice(q.odds)||!at||Date.parse(at)>now||now-Date.parse(at)>1800000||q.confirmed!==true)return NextResponse.json({error:'Choose a verified game, actual athlete/team/period/stat/side/line/price and an observation within 30 minutes; explicitly confirm it was observed in FanDuel.'},{status:400,headers});
   const quote={player:q.player.trim(),team:q.team.trim(),period:q.period,stat:statToken(q.stat),reportedStat:q.stat.trim(),eventId:g.id,side:q.side,line:q.line,odds:q.odds,observedAt:at,confirmed:true};
   const row=db.prepare('INSERT INTO discovered_manual_props(input_json,created_at) VALUES(?,?)').run(JSON.stringify(quote),now);return NextResponse.json({id:Number(row.lastInsertRowid),provenance:'MANUALLY OBSERVED BY USER — NOT API VERIFIED'},{headers});
  }
  if(body.action!=='analyze')return NextResponse.json({error:'Choose analyze or manual.'},{status:400,headers});
  const key=process.env.FANDUEL_API_KEY?.trim()??'',board=key?readBoard(db,key):null;let blocked=false;
  if(board){try{assertBoardUsable(db,key,board);}catch{blocked=true;}}
  const manual=(db.prepare('SELECT id,input_json FROM discovered_manual_props ORDER BY id DESC LIMIT 200').all() as {id:number;input_json:string}[]).map(r=>({...JSON.parse(r.input_json),id:'manual:'+r.id})) as ManualDiscovered[];
  return NextResponse.json({...await analyzeDiscovery(board,manual,f,now,blocked),providerAccess:providerAccessStatus(db,key,now)},{headers});
 }catch{return NextResponse.json({error:'Market discovery or free player data unavailable. Existing cache, tickets and forecasts were preserved; no paid retry or substitute data was used.'},{status:503,headers});}
}
