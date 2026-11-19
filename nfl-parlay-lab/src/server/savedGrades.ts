import type Database from 'better-sqlite3';
import type {Candidate} from '../lib/types.ts';
import {SUPPORTED_MARKETS} from '../lib/providers/oddsApi.ts';
import {settlementOutcome} from '../lib/settle.ts';
import {loadSchedule,loadFinalStats,resolveScheduledGame,statOf,normName,supportsStatMarket,type StatGame} from '../lib/providers/stats.ts';
import {loadEspnSettlementStats} from '../lib/providers/espn.ts';
import {currentSeason} from '../lib/service.ts';
export interface LegGrade {rulesVersion?:string;resolvedPlayerId?:string;identityMethod?:string;player:string;pos?:string;market?:string;side?:string;line?:number|null;status:'settled'|'push'|'void'|'pending';hit:0|1|null;reason?:string;actual?:number|null;resultSource?:string;resultGameId?:string;resultDate?:string}
export const finalized=(legs:LegGrade[])=>legs.length===6&&legs.every(l=>l&&['settled','push','void'].includes(l.status)&&(l.status!=='settled'||l.hit===0||l.hit===1));
export function ticketGrade(legs:LegGrade[]):string {
 if(legs.length!==6)return 'pending';
 if(legs.some(l=>l.status==='settled'&&l.hit===0))return 'loss';
 if(!finalized(legs))return 'pending';
 if(legs.every(l=>l.status==='push'||l.status==='void'))return 'void';
 return legs.some(l=>l.status==='push'||l.status==='void')?'push-adjusted-win':'win';
}
export function gradeArchiveLeg(leg:Candidate,capturedAt:number,gameId:string,games:StatGame[],source:string):LegGrade {
 const base={rulesVersion:'research-fullgame-v1',player:leg.name,pos:leg.pos,market:leg.market,side:leg.side,line:leg.line};
 const playerId=source==='espn'?leg.espnPlayerId??leg.historyPlayerId:leg.historyPlayerId;
 if(!Number.isFinite(capturedAt)||!playerId||!SUPPORTED_MARKETS.includes(leg.market))return {...base,status:'pending',hit:null,actual:null,reason:'invalid-capture-identity-or-market'};
 if(leg.market.replace('_alternate','')==='player_anytime_td' ? leg.side!=='Yes'||leg.line!==null : !['Over','Under','AtLeast'].includes(leg.side)||!Number.isFinite(leg.line))return {...base,status:'pending',hit:null,actual:null,reason:'invalid-saved-contract'};
 const matches=games.filter(g=>g.season===currentSeason(new Date(leg.kickoff))&&g.gameId===gameId&&g.playerId===playerId&&g.team===leg.team&&g.opp===leg.opp);
 const game=matches.length===1?matches[0]:undefined;
 if(game&&(normName(game.name)!==normName(leg.name)||game.pos&&game.pos!==leg.pos))return {...base,status:'pending',hit:null,actual:null,reason:'player-identity-mismatch'};
 if(game?.participationConflict)return {...base,status:'pending',hit:null,actual:null,reason:'conflicting-participation-data'};
 if(game?.completed&&game.nonParticipationVerified&&game.kickoffTs&&capturedAt<game.kickoffTs)return {...base,status:'void',hit:null,actual:null,reason:'explicit-final-boxscore-did-not-play',resultSource:source,resultGameId:gameId,resultDate:game.gameDate};
 const outcome=settlementOutcome({player:leg.name,playerId,team:leg.team,opp:leg.opp,market:leg.market,side:leg.side,line:leg.line,season:currentSeason(new Date(leg.kickoff)),requireFinal:true,snapshotTs:capturedAt,gameId},games);
 return {...base,...outcome,actual:outcome.status!=='pending'&&game&&supportsStatMarket(game,leg.market)?statOf(game,leg.market):null,
  ...(outcome.status!=='pending'?{resultSource:source,resultGameId:gameId,resultDate:game?.gameDate}: {})};
}
/** Recheck partial tickets even after an early loss; never update their saved selections. */
export async function gradeSavedTickets(db:Database.Database,f:typeof fetch=fetch,now=Date.now(),options:{store?:'paper';recheckFinalized?:boolean}={}) {
 const tickets=options.store==='paper'?'paper_wagers':'saved_tickets',gradesTable=options.store==='paper'?'paper_ticket_grades':'saved_ticket_grades',eventsTable=options.store==='paper'?'paper_grade_events':'saved_grade_events';
 const rows=db.prepare(`SELECT s.id,s.created_at,s.legs_json,g.legs_json AS previous_grades FROM ${tickets} s LEFT JOIN ${gradesTable} g ON g.ticket_id=s.id ${options.recheckFinalized?'':'WHERE g.ticket_id IS NULL OR g.finalized=0'}`).all() as {id:number;created_at:number;legs_json:string;previous_grades:string|null}[];
 const pending=rows.flatMap(row=>{
  try{const legs=JSON.parse(row.legs_json) as Candidate[];if(!Array.isArray(legs)||legs.length!==6||legs.some(l=>!l||typeof l.name!=='string'))return [];
   let previous:LegGrade[]=[];try{const p=JSON.parse(row.previous_grades??'null');if(Array.isArray(p))previous=p;}catch{}
   return [{...row,legs,previous}];
  }catch{return [];}
 });
 const providerErrors:string[]=[];
 let schedule:Record<string,string>[]=[];
 if(pending.some(t=>t.legs.some(l=>Date.parse(l.kickoff)<now)))try{schedule=await loadSchedule(f);}catch{providerErrors.push('Saved-ticket schedule provider unavailable; unresolved legs stay Pending and verified prior results are retained.');}
 const stats=new Map<number,StatGame[]>();
 const update=db.prepare(`INSERT INTO ${gradesTable}(ticket_id,status,legs_json,checked_at,finalized) VALUES(?,?,?,?,?) ON CONFLICT(ticket_id) DO UPDATE SET status=excluded.status,legs_json=excluded.legs_json,checked_at=excluded.checked_at,finalized=excluded.finalized`);
 for(const ticket of pending) {
  const grades:LegGrade[]=[];
  const append=(outcome:LegGrade)=>{
    const previous=ticket.previous[grades.length],leg=ticket.legs[grades.length];
    const proven=previous?.rulesVersion==='research-fullgame-v1'&&previous.player===leg.name&&previous.market===leg.market&&previous.side===leg.side&&previous.line===leg.line&&['nflverse','espn'].includes(previous.resultSource??'')&&previous.resultGameId&&previous.resultDate&&(previous.status==='void'||typeof previous.actual==='number'&&Number.isFinite(previous.actual))&&previous.status!=='pending';
    grades.push(outcome.status==='pending'&&proven&&['schedule-unavailable','missing-player-result','missing-stat-market','awaiting-nfl-final-check-window'].includes(outcome.reason??'')?previous:outcome);
  };
  for(const leg of ticket.legs) {
   const base:LegGrade={player:leg.name,pos:leg.pos,market:leg.market,side:leg.side,line:leg.line,status:'pending',hit:null,actual:null};
   if(!(Date.parse(leg.kickoff)<now)){append({...base,reason:'awaiting-kickoff'});continue;}
   const season=currentSeason(new Date(leg.kickoff));
   const resolution=resolveScheduledGame(schedule,{season,team:leg.team,opp:leg.opp,kickoffTs:Date.parse(leg.kickoff),resultGameId:leg.resultGameId,espnEventId:leg.espnEventId});
   // An unavailable schedule must not block a previously stored exact ESPN event/player bridge.
   // No names, dates or IDs are guessed, and mismatched authoritative schedule identities never fall back.
   const directEventId=leg.espnEventId||resolution.match?.espn;
   if((!schedule.length||resolution.match&&!leg.historyPlayerId) && /^\d+$/.test(directEventId??'') && /^espn:\d+$/.test(leg.espnPlayerId??'')) {
    const fallback=await loadEspnSettlementStats([{playerId:leg.espnPlayerId!,eventId:directEventId!,season,kickoffTs:Date.parse(leg.kickoff)}],f);
    providerErrors.push(...fallback.errors);
    let outcome=gradeArchiveLeg(leg,ticket.created_at,directEventId!,fallback.games,'espn');
    if(['game-not-final','postponed-or-cancelled','unsupported-season-type'].includes(fallback.eventStates.get(directEventId!)??''))outcome={...base,reason:fallback.eventStates.get(directEventId!)};
    if(!schedule.length&&outcome.status!=='pending'){const result=fallback.games.find(g=>g.gameId===directEventId&&g.playerId===leg.espnPlayerId);const week=/^\d{4}_(\d{1,2})_/.exec(leg.resultGameId??'');if(!result?.kickoffTs||Math.abs(result.kickoffTs-Date.parse(leg.kickoff))>36*3600_000||week&&Number(week[1])!==result.week)outcome={...base,reason:'event-time-or-week-unverified-without-schedule'};}
    if(!leg.historyPlayerId&&outcome.status!=='pending')outcome={...outcome,resolvedPlayerId:leg.espnPlayerId,identityMethod:leg.espnEventId?'stored-exact-espn-bridge':'stored-player-and-authoritative-schedule-event'};
    if(outcome.status!=='pending'||!schedule.length||['game-not-final','postponed-or-cancelled','unsupported-season-type'].includes(outcome.reason??'')){append(outcome);continue;}
   }
   if(!resolution.match){append({...base,reason:!schedule.length?'schedule-unavailable':resolution.match?'missing-player-identity':resolution.reason});continue;}
   if(!stats.has(season)){try{stats.set(season,await loadFinalStats(season,schedule,f));}catch{stats.set(season,[]);providerErrors.push(`Saved-ticket final statistics unavailable for ${season}.`);}}
   const match=resolution.match;
   let gradingLeg=leg;
   if(!leg.historyPlayerId){
    const candidates=(stats.get(season)??[]).filter(g=>g.completed&&g.gameId===match.game_id&&g.season===season&&g.team===leg.team&&g.opp===leg.opp&&g.pos===leg.pos&&g.playerId&&normName(g.name)===normName(leg.name));
    if(candidates.length!==1){append({...base,reason:'missing-or-ambiguous-final-player-identity'});continue;}
    gradingLeg={...leg,historyPlayerId:candidates[0].playerId};
   }
   const espnId=/^\d+$/.test(match.espn??'')?match.espn:undefined;
   const espn=await loadEspnSettlementStats(/^espn:\d+$/.test(leg.espnPlayerId??'')&&espnId?[{playerId:leg.espnPlayerId!,eventId:espnId,season,kickoffTs:Date.parse(leg.kickoff)}]:[],f);
   providerErrors.push(...espn.errors);
   let outcome:LegGrade=now<Date.parse(leg.kickoff)+6*3600_000?{...base,reason:'awaiting-nfl-final-check-window'}:gradeArchiveLeg(gradingLeg,ticket.created_at,match.game_id,stats.get(season)??[],'nflverse');
   if(outcome.status==='pending'&&leg.espnPlayerId&&espnId)outcome=gradeArchiveLeg(leg,ticket.created_at,espnId,espn.games,'espn');
   if(espnId&&['game-not-final','postponed-or-cancelled','unsupported-season-type'].includes(espn.eventStates.get(espnId)??''))outcome={...base,reason:'conflicting-final-status'};
   if(!leg.historyPlayerId&&outcome.status!=='pending')outcome={...outcome,resolvedPlayerId:gradingLeg.historyPlayerId,identityMethod:'unique-final-game-name-position-team-opponent'};
   append(outcome);
  }
  db.transaction(()=>{
    const previous=db.prepare(`SELECT status,legs_json,finalized,checked_at FROM ${gradesTable} WHERE ticket_id=?`).get(ticket.id) as {status:string;legs_json:string;finalized:number;checked_at:number}|undefined;
    if(options.store==='paper'&&previous&&previous.checked_at>now)return; // A slower older check cannot undo newer verified evidence.
    const state={status:ticketGrade(grades),legs_json:JSON.stringify(grades),finalized:Number(finalized(grades))};
    if(!previous||previous.status!==state.status||previous.legs_json!==state.legs_json||previous.finalized!==state.finalized)db.prepare(`INSERT INTO ${eventsTable}(ticket_id,checked_at,previous_json,result_json) VALUES(?,?,?,?)`).run(ticket.id,now,previous?JSON.stringify(previous):null,JSON.stringify(state));
    update.run(ticket.id,state.status,state.legs_json,now,state.finalized);
  })();
 }
 return {checked:pending.length,providerErrors:[...new Set(providerErrors)]};
}
export function savedGrades(db:Database.Database,options:{store?:'paper'}={}) {
 const tickets=options.store==='paper'?'paper_wagers':'saved_tickets',gradesTable=options.store==='paper'?'paper_ticket_grades':'saved_ticket_grades';
 const rows=db.prepare(`SELECT g.ticket_id,g.status,g.legs_json,g.checked_at,g.finalized,s.legs_json AS selections_json FROM ${gradesTable} g LEFT JOIN ${tickets} s ON s.id=g.ticket_id`).all() as {ticket_id:number;status:string;legs_json:string;checked_at:number;finalized:number;selections_json:string|null}[];
 return Object.fromEntries(rows.map(r=>{
  let legs:LegGrade[]=[],selections:Candidate[]=[];
  try{const parsed=JSON.parse(r.legs_json);if(Array.isArray(parsed))legs=parsed.filter(l=>l&&typeof l.player==='string'&&['settled','push','void','pending'].includes(l.status));}catch{}
  try{const parsed=JSON.parse(r.selections_json??'null');if(Array.isArray(parsed))selections=parsed;}catch{}
  const done=Boolean(r.finalized)&&finalized(legs),neutral=legs.filter(l=>l.status==='push'||l.status==='void').length;
  const priced=done&&selections.length===6&&selections.every(l=>Number.isFinite(l.odds)&&Math.abs(l.odds)>=100);
  const adjustedDecimal=priced?selections.reduce((product,l,i)=>product*((legs[i]?.status==='push'||legs[i]?.status==='void')?1:l.odds>0?1+l.odds/100:1+100/-l.odds),1):null;
  const verifiedEarlyLoss=legs.some(l=>l.rulesVersion==='research-fullgame-v1'&&l.status==='settled'&&l.hit===0&&typeof l.actual==='number'&&Number.isFinite(l.actual)&&['nflverse','espn'].includes(l.resultSource??''));
  return [r.ticket_id,{status:done||verifiedEarlyLoss?r.status:'pending',legs,checkedAt:r.checked_at,finalized:done,neutralLegs:neutral,adjustedDecimal,adjustmentVerified:false,adjustmentBasis:'theoretical-product-excluding-push-void; FanDuel repricing unavailable'}];
 }));
}
