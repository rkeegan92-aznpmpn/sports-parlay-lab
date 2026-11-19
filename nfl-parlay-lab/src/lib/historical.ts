import {statOf,supportsStatMarket,scheduledKickoff,playerHistory,type StatGame} from './providers/stats.ts';
import {settlementOutcome} from './settle.ts';
import {ticketGrade,finalized,type LegGrade} from '../server/savedGrades.ts';
export const HISTORICAL_VERSION='walk-forward-benchmark-v1';
export interface HistoricalQuote {playerId:string;gameId:string;market:string;side:'Over'|'Under';line:number;odds:number;capturedAt:number;oddsAt:number;captureId:number}
export interface HistoricalLeg {player:string;playerId:string;pos:string;team:string;opp:string;gameId:string;kickoff:number;market:string;side:'Over'|'Under';line:number;lineSource:'model-benchmark'|'recorded-pregame-quote';odds:number|null;quoteCaptureId:number|null;probability:number;trainingGameIds:string[];latestTrainingAvailableAt:number;sample:number;grade?:LegGrade}
export interface HistoricalTicket {label:'BACKTEST';kind:'best'|'aggr';week:number;capturedAt:number;legs:HistoricalLeg[];status:string;finalized:boolean;decimal:null;ev:null;roi:null;warnings:string[]}
interface Event {id:string;home:string;away:string;kickoff:number;week:number}
const slots:Record<string,number>={QB:1,RB:2,WR:2,TE:1};
const marketFor=(pos:string)=>pos==='QB'?'player_pass_yds':pos==='RB'?'player_rush_yds':'player_reception_yds';
/** Only this feature projection is passed to prediction: no outcomes, target rows, final scores or prices invented. */
export function historicalTraining(games:StatGame[],cutoff:number):StatGame[] {
 return games.filter(g=>g.completed===true&&g.playerId&&g.gameId&&g.kickoffTs&&g.kickoffTs+24*3600_000<cutoff&&g.gameDate&&!g.invalidGameDate)
  .map(g=>({...g,v:{...g.v}}));
}
function choose(pool:HistoricalLeg[],kind:'best'|'aggr',avoid:Set<string>):HistoricalLeg[] {
 const rank=(l:HistoricalLeg)=>kind==='best'?l.probability:1-l.probability;
 const grouped:Record<string,HistoricalLeg[]>={};
 for(const pos of Object.keys(slots))grouped[pos]=pool.filter(l=>l.pos===pos).sort((a,b)=>rank(b)-rank(a)||a.playerId.localeCompare(b.playerId)).slice(0,24);
 let best:HistoricalLeg[]=[];let score=-Infinity;
 // Beam search retains alternate combinations to respect player uniqueness and three-per-game caps.
 let beams:{legs:HistoricalLeg[];score:number}[]=[{legs:[],score:0}];
 for(const pos of ['QB','RB','RB','WR','WR','TE']) {
  const next=[];
  for(const b of beams)for(const leg of grouped[pos]??[]) {
   if(b.legs.some(l=>l.playerId===leg.playerId)||b.legs.filter(l=>l.gameId===leg.gameId).length>=3)continue;
   const value=b.score+rank(leg)-(avoid.has(`${leg.playerId}|${leg.line}`)?.05:0);
   next.push({legs:[...b.legs,leg],score:value});
  }
  beams=next.sort((a,b)=>b.score-a.score).slice(0,80);
 }
 for(const b of beams)if(b.legs.length===6&&b.score>score){best=b.legs;score=b.score;}
 return best;
}
export function simulateHistorical(games:StatGame[],schedule:Record<string,string>[],season:number,quotes:HistoricalQuote[]=[],asOf=Date.now()) {
 const events:Event[]=schedule.filter(r=>Number(r.season)===season&&r.game_type==='REG').flatMap(r=>{const ko=scheduledKickoff(r);return ko?[{id:r.game_id,home:r.home_team,away:r.away_team,kickoff:ko,week:Number(r.week)}]:[];});
 const tickets:HistoricalTicket[]=[];const skipped:{week:number;reason:string}[]=[];
 for(const week of [...new Set(events.map(e=>e.week))].sort((a,b)=>a-b)) {
  const slate=events.filter(e=>e.week===week),cutoff=Math.min(...slate.map(e=>e.kickoff))-3600_000;
  // No future slates: evaluation requires a completed game in the requested historical week.
  if(slate.some(e=>e.kickoff>=asOf))continue;
  if(!games.some(g=>g.completed&&slate.some(e=>e.id===g.gameId)))continue;
  const training=historicalTraining(games,cutoff),byPlayer=new Map<string,StatGame[]>();
  for(const row of training){const a=byPlayer.get(row.playerId!)??[];a.push(row);byPlayer.set(row.playerId!,a);}
  const pool:HistoricalLeg[]=[];
  for(const [id,history]of byPlayer) {
   history.sort((a,b)=>a.kickoffTs!-b.kickoffTs!);const last=history.at(-1)!;
   if(!slots[last.pos])continue;
   const event=slate.find(e=>e.home===last.team||e.away===last.team);if(!event)continue;
   const market=marketFor(last.pos),prior=history.filter(g=>supportsStatMarket(g,market)).slice(-10);if(prior.length<5)continue;
   const values=prior.map(g=>statOf(g,market)).filter(Number.isFinite).sort((a,b)=>a-b);if(values.length<5)continue;
   const recorded=quotes.filter(q=>q.playerId===id&&q.gameId===event.id&&q.market===market&&['Over','Under'].includes(q.side)&&q.line>=0&&q.capturedAt<=cutoff&&q.capturedAt<event.kickoff&&q.oddsAt<=q.capturedAt+5*60000&&q.capturedAt-q.oddsAt<=30*60000&&Number.isFinite(q.line)&&Number.isFinite(q.odds)&&Math.abs(q.odds)>=100).sort((a,b)=>b.capturedAt-a.capturedAt)[0];
   const contracts=recorded?[{line:recorded.line,side:recorded.side,recorded}]:[.25,.6].map(q=>({line:Math.max(.5,Math.floor(values[Math.floor((values.length-1)*q)])+.5),side:'Over' as const,recorded:undefined}));
   for(const contract of contracts) {
    const outcomes=playerHistory(prior,market,contract.side,contract.line).last10;if(!outcomes||outcomes.hits==null||outcomes.hitGames<5)continue;
    const p=(outcomes.hits+2)/(outcomes.hitGames+4);if(p<.3)continue;
    const leg:HistoricalLeg={player:last.name,playerId:id,pos:last.pos,team:last.team,opp:event.home===last.team?event.away:event.home,gameId:event.id,kickoff:event.kickoff,market,side:contract.side,line:contract.line,
     lineSource:contract.recorded?'recorded-pregame-quote':'model-benchmark',odds:contract.recorded?.odds??null,quoteCaptureId:contract.recorded?.captureId??null,probability:p,trainingGameIds:prior.map(g=>g.gameId),latestTrainingAvailableAt:Math.max(...prior.map(g=>g.kickoffTs!+24*3600_000)),sample:prior.length};
    if(!pool.some(l=>l.playerId===id&&l.line===leg.line&&l.side===leg.side))pool.push(leg);
   }
  }
  const best=choose(pool,'best',new Set()),avoid=new Set(best.map(l=>`${l.playerId}|${l.line}`));
  for(const kind of ['best','aggr'] as const) {
   const legs=kind==='best'?best:choose(pool,'aggr',avoid);
   if(legs.length!==6){skipped.push({week,reason:`${kind}: insufficient pregame identities/history or valid multi-game positional combinations`});continue;}
   if(kind==='aggr'&&legs.every(l=>avoid.has(`${l.playerId}|${l.line}`))){skipped.push({week,reason:'No distinct Aggressive combination'});continue;}
   // Prediction is frozen before the evaluator receives target outcomes.
   const frozen=legs.map(l=>({...l,trainingGameIds:[...l.trainingGameIds]}));
   for(const leg of frozen){const outcome=settlementOutcome({player:leg.player,playerId:leg.playerId,team:leg.team,opp:leg.opp,market:leg.market,side:leg.side,line:leg.line,season,requireFinal:true,snapshotTs:cutoff,gameId:leg.gameId},games);const actual=games.filter(g=>g.gameId===leg.gameId&&g.playerId===leg.playerId&&g.team===leg.team&&g.opp===leg.opp);leg.grade={player:leg.player,pos:leg.pos,market:leg.market,side:leg.side,line:leg.line,...outcome,actual:outcome.status!=='pending'&&actual.length===1?statOf(actual[0],leg.market):null,resultSource:outcome.status==='pending'?undefined:'nflverse',resultGameId:leg.gameId};}
   const grades=frozen.map(l=>l.grade!);
   tickets.push({label:'BACKTEST',kind,week,capturedAt:cutoff,legs:frozen,status:ticketGrade(grades),finalized:finalized(grades),decimal:null,ev:null,roi:null,
    warnings:['BACKTEST simulation, never a saved upcoming ticket or a calibration unlock.','Benchmark lines are generated from prior results; they are not historical FanDuel lines. Missing historical prices are null.','Aggressive ranks lower estimated probability; a higher historical payout cannot be asserted without verified combined prices.','Historical injuries/roster availability and publication/revision timestamps are unavailable. Prior stats require a conservative 24-hour post-kickoff availability assumption; not a fully point-in-time archive.']});
  }
 }
 return {version:HISTORICAL_VERSION,label:'BACKTEST',season,tickets,skipped,metrics:historicalMetrics(tickets),oddsDependentMetrics:{ticketROI:null,payout:null,EV:null,reason:'No verified historical combined FanDuel ticket prices. No prices are imputed.'}};
}
export function historicalMetrics(tickets:HistoricalTicket[]) {
 const all=tickets.flatMap(t=>t.legs),unique=[...new Map(all.map(l=>[`${l.playerId}|${l.gameId}|${l.market}|${l.side}|${l.line}`,l])).values()];
 const summary=(rows:HistoricalLeg[])=>{const decisive=rows.filter(l=>l.grade?.status==='settled'&&l.grade.hit!=null),wins=decisive.filter(l=>l.grade!.hit===1).length;return {n:rows.length,decisive:decisive.length,wins,winRate:decisive.length?wins/decisive.length:null,pricedLegs:decisive.filter(l=>l.odds!=null).length,flatStakeLegROI:decisive.some(l=>l.odds!=null)?decisive.filter(l=>l.odds!=null).reduce((s,l)=>s+(l.grade!.hit===1?(l.odds!>0?l.odds!/100:100/-l.odds!):-1),0)/decisive.filter(l=>l.odds!=null).length:null,pushes:rows.filter(l=>l.grade?.status==='push').length,pending:rows.filter(l=>l.grade?.status==='pending').length};};
 const groups=(key:'pos'|'market')=>Object.fromEntries([...new Set(unique.map(l=>l[key]))].map(k=>[k,summary(unique.filter(l=>l[key]===k))]));
 const complete=tickets.filter(t=>t.finalized&&t.status!=='void'),wins=complete.filter(t=>t.status==='win'||t.status==='push-adjusted-win').length;
 return {legs:summary(unique),byPosition:groups('pos'),byMarket:groups('market'),tickets:{n:tickets.length,finalized:complete.length,wins,winRate:complete.length?wins/complete.length:null,pending:tickets.filter(t=>!t.finalized).length},deduplicatedLegs:true};
}
