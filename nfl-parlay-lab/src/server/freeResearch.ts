import {loadSchedule,scheduledKickoff,loadStatsHistory,normName} from '../lib/providers/stats.ts';
import {verifyCurrentRoster} from '../lib/providers/espn.ts';
import {TEAM_ABBR,currentSeason,loadLive} from '../lib/service.ts';
import {SUPPORTED_MARKETS,type ApiEvent} from '../lib/providers/oddsApi.ts';
import {eligibilityWarnings,generate} from '../lib/optimizer.ts';
import {groupCandidateRejections} from '../lib/rejections.ts';
import type {Candidate,Side} from '../lib/types.ts';
export interface ManualQuote {eventId:string;player:string;market:string;side:Side;line:number|null;odds:number;observedAt:string;confirmed:true}
export class ManualInputError extends Error {}
const canonical=(team:string)=>({LAR:'LA',WSH:'WAS',JAC:'JAX'}[team]??team);
const names=Object.fromEntries(Object.entries(TEAM_ABBR).map(([name,team])=>[canonical(team),name]));
export async function freeSchedule(f:typeof fetch=fetch,now=Date.now()) {
  const rows=await loadSchedule(f);
  return rows.flatMap(row=>{
    const kickoff=scheduledKickoff(row);
    if(row.home_score?.trim() && row.away_score?.trim())return []; // A populated result cannot support a new pregame contract.
    if(row.game_type!=='REG'||!kickoff||kickoff<=now||kickoff>now+21*864e5||!names[row.home_team]||!names[row.away_team]||!row.game_id)return [];
    return [{id:row.game_id,commence_time:new Date(kickoff).toISOString(),home_team:names[row.home_team],away_team:names[row.away_team],label:`${row.away_team} @ ${row.home_team}`,week:Number(row.week),espnEventId:/^\d+$/.test(row.espn??'')?row.espn:undefined}];
  }).sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time));
}
export async function freePlayers(event:ApiEvent,f:typeof fetch=fetch,now=Date.now()) {
  const stats=await loadStatsHistory(currentSeason(new Date(now)),f);
  const teams=[canonical(TEAM_ABBR[event.home_team]),canonical(TEAM_ABBR[event.away_team])];
  const choices=new Map<string,{key:string;name:string;position:string;team:string}>();
  for(const g of stats.games) if(['QB','RB','WR','TE'].includes(g.pos)&&g.playerId&&g.gameDate&&Date.parse(g.gameDate)<now) {
    for(const team of teams) {const key=`${team}|${g.pos}|${normName(g.name)}`;choices.set(key,{key,name:g.name,position:g.pos,team});}
  }
  const verified=await verifyCurrentRoster([...choices.values()],f);
  return {players:[...verified.players.values()].map(p=>({name:p.name,team:canonical(p.team),pos:p.position,status:p.status??'unknown'})).filter(p=>!/(inactive|injured reserve|suspend|practice.squad)/i.test(p.status)),
    statisticsRows:stats.games.length,unavailableSeasons:stats.unavailable.map(x=>x.season),rosterErrors:verified.errors.length};
}
export function parseManualQuote(input:unknown,events:ApiEvent[],now=Date.now()):ManualQuote {
  if(!input||typeof input!=='object')throw new ManualInputError('Enter an observed FanDuel quote.');
  const q=input as ManualQuote;
  if(!events.some(e=>e.id===q.eventId&&Date.parse(e.commence_time)>now))throw new ManualInputError('Choose a verified upcoming game with an exact kickoff.');
  if(typeof q.player!=='string'||!q.player.trim()||q.player.length>100||!SUPPORTED_MARKETS.includes(q.market)||!['Over','Under','Yes','AtLeast'].includes(q.side))throw new ManualInputError('Choose a real player and supported market/side.');
  if(q.market==='player_anytime_td'?q.side!=='Yes'||q.line!==null:q.side==='Yes'||typeof q.line!=='number'||!Number.isFinite(q.line)||q.line<0||q.line>2000)throw new ManualInputError('Market side and line are invalid. Anytime TD requires Yes with no line.');
  if(!Number.isInteger(q.odds)||Math.abs(q.odds)<100||Math.abs(q.odds)>100000)throw new ManualInputError('Enter valid American odds, for example -110 or +150.');
  const age=now-Date.parse(q.observedAt);
  if(!(age>=-5*60000&&age<=30*60000))throw new ManualInputError('Observation time is missing, stale, or future-dated. Use the actual time you saw the quote; never backdate.');
  if(q.confirmed!==true)throw new ManualInputError('Confirm this exact line and price were observed in FanDuel.');
  return {eventId:q.eventId,player:q.player.trim(),market:q.market,side:q.side,line:q.line,odds:q.odds,observedAt:q.observedAt,confirmed:true};
}
export async function manualResearch(inputs:unknown[],f:typeof fetch=fetch,now=Date.now(),testMode=false) {
  if(inputs.length>60)throw new ManualInputError('At most 60 active quotes per research scan.');
  const events=await freeSchedule(f,now), quotes=inputs.map(i=>parseManualQuote(i,events,now));
  const selected=events.filter(e=>quotes.some(q=>q.eventId===e.id));
  // Reuse the existing verified statistics/roster pipeline. This adapter supplies only explicit user entries,
  // never calls the paid service, and immediately assigns manual provenance before generation/storage.
  const adapter:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname!=='api.the-odds-api.com')return f(input,init);
    const id=url.pathname.split('/').at(-2);
    return Response.json({bookmakers:[{key:'fanduel',markets:quotes.filter(q=>q.eventId===id).map(q=>({key:q.market,last_update:q.observedAt,outcomes:[{name:q.side,description:q.player,point:q.line??undefined,price:q.odds}]}))}]});
  };
  const data=await loadLive({key:'manual-adapter-no-provider-credential',date:'ALL'},now,adapter,{events:selected,remaining:null});
  const candidates:Candidate[]=data.candidates.map(c=>({...c,source:'manual',quoteVerified:false,manualQuoteConfirmed:true,
    resultGameId:c.gameId,espnEventId:events.find(e=>e.id===c.gameId)?.espnEventId}));
  const rejected=groupCandidateRejections(candidates.flatMap(candidate=>{
    const reasons=[...new Set([...eligibilityWarnings('best',candidate,now).map(reason=>`Best Six: ${reason}`),
      ...eligibilityWarnings('aggr',candidate,now).map(reason=>`Aggressive Six: ${reason}`)])];
    return reasons.length?[{candidate,reasons}]:[];
  }));
  return {candidates,notes:data.notes,pipelineRejections:data.pipelineRejections??[],rejected,...generate(candidates,now,{pregameResearch:true,testMode}),
    provenance:'MANUAL — user-entered FanDuel quotes, not independently verified live',validationGatePassed:false};
}
