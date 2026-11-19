import {checkExplorerRow,explorerSummary,type PropChecks} from '../lib/explorerEligibility.ts';
import {resolveRosterIdentities,type RosterIdentity} from '../lib/providers/espn.ts';
import {normName} from '../lib/providers/stats.ts';
import {inSundayWindow} from '../lib/sundayWindow.ts';
import {availabilityWarnings} from '../lib/availability.ts';
import {PROP_STATS,propDefinition,statToken,propSides,quarterMarketKey,PERIOD_QUARTERS,periodMarketName} from '../lib/propMarkets.ts';
import {matchBoardEvents,fanduelResearch} from './fanduelResearch.ts';
import {fanduelQuarterResearch,pregameQuarterHistory} from './firstQuarterResearch.ts';
import {freeSchedule,manualResearch} from './freeResearch.ts';
import {quoteFreshness,type Board} from './fanduelRest.ts';
import {currentSeason,TEAM_ABBR} from '../lib/service.ts';
import {generate,eligibilityWarnings} from '../lib/optimizer.ts';
import {makeFirstQuarterCandidates,generateFirstQuarter} from '../lib/firstQuarter.ts';
import {loadStatsHistory,loadFirstQuarterHistory,loadCurrentInjuries} from '../lib/providers/stats.ts';
import {verifyQuarterAvailability} from '../lib/providers/espn.ts';
import {providerTimestamp} from './providerTimestamp.ts';
import type {Candidate,FirstQuarterCandidate} from '../lib/types.ts';
export type PropAudit={reportedPlayer:string;reportedTeam:string|null;reportedPosition:string|null;reportedKickoff:string|null;reportedStat:string;reportedPeriod:string;reportedLine:string|number|null;normalizedName:string;eventMatched:boolean;propKickoffMatched:boolean;marketOpen:boolean;conflicting:boolean};
export type DiscoveredProp={roster?:RosterIdentity;validation?:ReturnType<typeof checkExplorerRow>;audit:PropAudit;id:string;providerId:string;providerPlayerId:string|null;player:string;team:string|null;opponent:string|null;position:string|null;gameId:string;providerEventId:string;kickoff:string|null;period:string;stat:string;category:string;market:string|null;line:number|null;side:string;odds:number|null;source:'independent-api'|'manual';observedAt:string|null;asOf:string|null;freshness:string;fresh:boolean;expiresAt:string|null;analysis:Candidate|FirstQuarterCandidate|null;limitations:string[]};
export type ManualDiscovered={id:string;player:string;team:string;eventId:string;period:string;stat:string;reportedStat?:string;side:'Over'|'Under'|'AtLeast';line:number;odds:number;observedAt:string;confirmed:true};
/** Inventory all player rows, even unknown stat/period, missing price or unmatched identity. */
export function discoverProps(board:Board,games:Awaited<ReturnType<typeof freeSchedule>>,now:number):DiscoveredProp[]{
 const {events}=matchBoardEvents(board,games),rows:DiscoveredProp[]=[];
 for(const {record:r,meta} of board.props){
  if(typeof r.player!=='string'||!r.player.trim()||String(r.league).toLowerCase()!=='nfl')continue;
  const stat=statToken(r.stat),definition=PROP_STATS[stat],period=statToken(r.period)||'unknown',event=events.get(String(r.event_id)),fresh=quoteFreshness(meta,r.observed_at,now);
  const parsedSides=propSides(r),sides=parsedSides.length?parsedSides:[{side:'unavailable',line:NaN,odds:null}];
  for(const s of sides){
   const limitations:string[]=[];
   if(!definition)limitations.push(`Unmapped provider stat ${stat||'(missing)'}: no history or probability inferred.`);
   if(!['game','q1'].includes(period))limitations.push(`Period ${period}: not eligible for full-game/Q1 tickets; period-specific history is required and full-game values never substituted.`);
   if(!event)limitations.push('Unmatched verified schedule event/teams/kickoff.');
   if(r.market_status!=='open')limitations.push('Provider market is not open.');
   if(s.odds===null)limitations.push('No valid American price for this side.');
   if(!Number.isFinite(s.line))limitations.push('Line/threshold schema unavailable; no value guessed.');
   if(!fresh.eligible)limitations.push(...fresh.checks.filter(c=>!c.passed).map(c=>`${c.field}: ${c.reason}`));
   rows.push({audit:{reportedPlayer:r.player,reportedTeam:typeof r.team==='string'?r.team:null,reportedPosition:typeof r.position==='string'?r.position:null,reportedKickoff:typeof r.starts_at==='string'?r.starts_at:null,reportedStat:String(r.stat??''),reportedPeriod:String(r.period??''),reportedLine:typeof r.line==='string'||typeof r.line==='number'?r.line:null,normalizedName:normName(r.player),eventMatched:!!event,propKickoffMatched:!!event&&Math.abs(Date.parse(providerTimestamp(r.starts_at)??'')-Date.parse(event.commence_time))<=60000,marketOpen:r.market_status==='open',conflicting:false},id:`${r.id}:${s.side}`,providerId:String(r.id??''),providerPlayerId:typeof r.player_id==='string'?r.player_id:null,player:r.player,team:typeof r.team==='string'?r.team:null,opponent:null,position:null,gameId:event?.id??'',providerEventId:String(r.event_id??''),kickoff:event?.commence_time??providerTimestamp(r.starts_at),period,stat,category:definition?.category??'unmapped',market:definition?definition.market+(period!=='game'?'_'+period:'')+(period==='game'&&(s.side==='AtLeast'||String(r.stat).trim().toLowerCase().endsWith('_alternate'))?'_alternate':''):null,line:Number.isFinite(s.line)?s.line:null,side:s.side,odds:s.odds,source:'independent-api',observedAt:providerTimestamp(r.observed_at),asOf:meta.asOf,freshness:fresh.label,fresh:fresh.eligible,expiresAt:fresh.eligible&&fresh.ageSeconds!==null?new Date(now+(1800-fresh.ageSeconds)*1000).toISOString():null,analysis:null,limitations});
  }
 }
 // Conflicting duplicate IDs cannot silently overwrite or qualify. Keep all alternatives visible.
 const groups=new Map<string,Set<string>>();for(const row of rows){const set=groups.get(row.id)??new Set();set.add(JSON.stringify([row.player,row.gameId,row.market,row.period,row.line,row.side,row.odds]));groups.set(row.id,set);}
 return rows.map(r=>groups.get(r.id)!.size>1?{...r,audit:{...r.audit,conflicting:true},fresh:false,limitations:[...r.limitations,'Conflicting duplicate provider quote ID; excluded from selection.']}:r);
}
export async function analyzeDiscovery(board:Board|null,manual:ManualDiscovered[],f:typeof fetch,now:number,providerBlocked=false){
 const started=Date.now();
 const notes:string[]=[];let games:Awaited<ReturnType<typeof freeSchedule>>=[];
 try{games=await freeSchedule(f,now);}catch{notes.push('Free NFL schedule unavailable. Cached inventory is retained, but no verified game or automatic ticket can be inferred.');}
 const rows=board?discoverProps(board,games,now):[];
 const pipelineReasons:{player:string;gameId:string;market:string;side:string;line:number|null;reason:string}[]=[];
 let providerPool:Candidate[]=[],quarterPool:FirstQuarterCandidate[]=[];
 let fullPreview=null,quarterPreview=null;
 if(board&&games.length){
  const full=await fanduelResearch(board,f,now,false,true),q1=await fanduelQuarterResearch(board,f,now,'ALL','ALL',true);
  providerPool=full.analysisCandidates;quarterPool=q1.candidates;fullPreview=full.preview;quarterPreview=q1.preview;notes.push(...full.notes,...q1.missing);pipelineReasons.push(...full.pipelineRejections);
  for(const row of rows){
   const candidate=row.period==='game'?providerPool.find(c=>c.providerPropId===row.id):row.period==='q1'?quarterPool.find(c=>c.player===row.player&&c.gameId===row.gameId&&c.side===row.side&&c.line===row.line&&c.odds===row.odds&&quarterMarketKey(c.market)===row.market):undefined;
   if(candidate){row.analysis=candidate;row.team=candidate.team;row.opponent='opp' in candidate?candidate.opp:candidate.opponent;row.position='name' in candidate?candidate.pos:candidate.position??null;if('name'in candidate){row.limitations.push(...availabilityWarnings(candidate,now));const best=eligibilityWarnings('best',candidate,now),aggressive=eligibilityWarnings('aggr',candidate,now);if(best.length&&aggressive.length)row.limitations.push(...new Set([...best,...aggressive]));}}
   else row.limitations.push('No eligible, unambiguous roster/injury/history analysis for this exact contract.');
  }
 }
 const manualFull=manual.filter(m=>m.period==='game'&&PROP_STATS[m.stat]&&games.some(g=>g.id===m.eventId)&&now-Date.parse(m.observedAt)>=0&&now-Date.parse(m.observedAt)<=1800000);
 if(manual.some(m=>m.period==='game')&&manualFull.length<manual.filter(m=>m.period==='game').length)notes.push('Stale, invalid or unmatched manual quotes were excluded individually; current manual observations remain analyzable.');
 let manualPool:Candidate[]=[];
 if(manualFull.length){try{const result=await manualResearch(manualFull.map(m=>({eventId:m.eventId,player:m.player,market:PROP_STATS[m.stat].market+(m.side==='AtLeast'?'_alternate':''),side:m.side,line:m.line,odds:m.odds,observedAt:m.observedAt,confirmed:true})),f,now);manualPool=result.candidates.filter(c=>manualFull.some(m=>m.eventId===c.gameId&&m.player===c.name&&m.team===c.team&&m.side===c.side&&m.line===c.line&&m.odds===c.odds&&m.observedAt===c.oddsAt&&PROP_STATS[m.stat].market+(m.side==='AtLeast'?'_alternate':'')===c.market));}catch{notes.push('Some manual full-game quotes are stale/unmatched; no provider prices substituted.');}}
 let manualQuarter:FirstQuarterCandidate[]=[];
 if(games.length&&manual.some(m=>m.period==='q1')){
  const season=currentSeason(new Date(now)),stats=await loadStatsHistory(season,f),raw=await loadFirstQuarterHistory(season,f,stats.games),history=pregameQuarterHistory(raw,stats.games,now);
  for(const game of games)manualQuarter.push(...makeFirstQuarterCandidates(manual.filter(m=>m.period==='q1'&&m.eventId===game.id&&PROP_STATS[m.stat]).map(m=>({participant:m.player,market:PROP_STATS[m.stat].market+'_q1',side:m.side,line:m.line,odds:m.odds,updatedAt:m.observedAt})),game,stats.games.filter(g=>g.gameDate&&Date.parse(g.gameDate)<now),history,TEAM_ABBR,now,season));
  let report:Awaited<ReturnType<typeof loadCurrentInjuries>>|null=null;try{report=await loadCurrentInjuries(season,f,now);}catch{notes.push('Manual Q1 injury coverage unavailable; automatic selections remain blocked.');}
  const verified=await verifyQuarterAvailability(manualQuarter,new Map(games.map(g=>[g.id,[TEAM_ABBR[g.home_team],TEAM_ABBR[g.away_team]]])),report?.statuses??null,f,{currentSnapshotAt:report?.currentSnapshotAt??null,coveredTeams:report?.coveredTeams??[],now});manualQuarter=verified.candidates.filter(c=>manual.some(m=>m.period==='q1'&&m.eventId===c.gameId&&m.player===c.player&&m.team===c.team&&m.side===c.side&&m.line===c.line&&m.odds===c.odds)).map(c=>({...c,provider:'manual' as const}));
 }
 for(const m of manual){
  const g=games.find(g=>g.id===m.eventId),market=PROP_STATS[m.stat]?.market+(m.period!=='game'?'_'+m.period:m.side==='AtLeast'?'_alternate':''),a=m.period==='game'?manualPool.find(c=>c.name===m.player&&c.gameId===m.eventId&&c.side===m.side&&c.line===m.line&&c.odds===m.odds&&c.oddsAt===m.observedAt&&c.market===market):manualQuarter.find(c=>c.player===m.player&&c.gameId===m.eventId&&c.side===m.side&&c.line===m.line&&c.odds===m.odds&&c.oddsAt===m.observedAt&&quarterMarketKey(c.market)===market);
  const age=now-Date.parse(m.observedAt),fresh=age>=0&&age<=1800000;
  rows.push({audit:{reportedPlayer:m.player,reportedTeam:m.team,reportedPosition:null,reportedKickoff:g?.commence_time??null,reportedStat:m.reportedStat??m.stat,reportedPeriod:m.period,reportedLine:m.line,normalizedName:normName(m.player),eventMatched:!!g,propKickoffMatched:!!g,marketOpen:true,conflicting:false},id:m.id,providerId:m.id,providerPlayerId:null,player:m.player,team:m.team,opponent:a?('opp'in a?a.opp:a.opponent):null,position:a?('name'in a?a.pos:a.position??null):null,gameId:m.eventId,providerEventId:'',kickoff:g?.commence_time??null,period:m.period,stat:m.stat,category:PROP_STATS[m.stat]?.category??'unmapped',market:PROP_STATS[m.stat]?market:null,line:m.line,side:m.side,odds:m.odds,source:'manual',observedAt:m.observedAt,asOf:null,freshness:fresh?'MANUALLY OBSERVED BY USER — NOT API VERIFIED':'STALE MANUAL OBSERVATION',fresh,expiresAt:new Date(Date.parse(m.observedAt)+1800000).toISOString(),analysis:a??null,limitations:['User-entered sportsbook observation; availability and combined acceptance not independently verified.',...(!a?['Period-specific roster/history/availability analysis unavailable.']:[])]});
 }
 // Other periods are analyzed against their own PBP splits, never fed into Q1 or full-game tickets.
 const otherPeriods=[...new Set(rows.map(r=>r.period).filter(p=>p!=='q1'&&PERIOD_QUARTERS[p]))];
 if(games.length&&otherPeriods.length){
  const season=currentSeason(new Date(now)),stats=await loadStatsHistory(season,f);
  let report:Awaited<ReturnType<typeof loadCurrentInjuries>>|null=null;try{report=await loadCurrentInjuries(season,f,now);}catch{notes.push('Current injury report unavailable for period analysis.');}
  for(const period of otherPeriods){
   const raw=await loadFirstQuarterHistory(season,f,stats.games,period),history=pregameQuarterHistory(raw,stats.games,now);
   let pool:FirstQuarterCandidate[]=[];
   for(const game of games){const inputs=rows.filter(r=>r.period===period&&r.gameId===game.id&&r.market&&r.odds!==null&&r.line!==null&&r.observedAt&&['Over','Under','AtLeast'].includes(r.side)).map(r=>({participant:r.player,market:r.market!,side:r.side as 'Over'|'Under'|'AtLeast',line:r.line!,odds:r.odds!,updatedAt:r.observedAt!}));pool.push(...makeFirstQuarterCandidates(inputs,game,stats.games.filter(g=>g.gameDate&&Date.parse(g.gameDate)<now),history,TEAM_ABBR,now,season,true,period));}
   const availability=await verifyQuarterAvailability(pool,new Map(games.map(g=>[g.id,[TEAM_ABBR[g.home_team],TEAM_ABBR[g.away_team]]])),report?.statuses??null,f,{currentSnapshotAt:report?.currentSnapshotAt??null,coveredTeams:report?.coveredTeams??[],now});
   for(const row of rows.filter(r=>r.period===period)){
    const a=availability.candidates.find(c=>c.player===row.player&&c.gameId===row.gameId&&c.market===periodMarketName(row.market??'')&&c.side===row.side&&c.line===row.line&&c.odds===row.odds&&c.oddsAt===row.observedAt&&c.sample>=4);
    if(a&&(!row.team||row.team===a.team)){row.analysis=a;row.position=a.position??null;row.team=a.team;row.opponent=a.opponent;row.limitations=row.limitations.filter(s=>!s.includes('No eligible'));row.limitations.push('Period-specific player PBP analysis; period team totals/opponent scoring context unavailable. Not a Q1 or full-game selection.');}
    else row.limitations.push('At least four verified period-specific games and current active roster/injury coverage were not established.');
   }
  }
 }
 // Display identity is resolved independently of odds age, statistical coverage and market support.
 const requests=[...new Map(rows.map(r=>{const g=games.find(g=>g.id===r.gameId);const key=JSON.stringify([r.gameId,normName(r.player)]);return [key,{key,name:r.player,teams:g?[TEAM_ABBR[g.home_team],TEAM_ABBR[g.away_team]]:[]}];})).values()];
 const identities=await resolveRosterIdentities(requests,f,now);
 let injuryReport:Awaited<ReturnType<typeof loadCurrentInjuries>>|null=null;try{if(requests.length)injuryReport=await loadCurrentInjuries(currentSeason(new Date(now)),f,now);}catch{notes.push('Current injury provider unavailable; identity verification does not establish health or ticket eligibility.');}
 const evaluationNow=now+Date.now()-started;
 for(const row of rows){
  row.roster=identities.get(JSON.stringify([row.gameId,normName(row.player)]));
  row.team=row.roster?.verified?row.roster.team:null;row.position=row.roster?.verified?row.roster.position:null;
  const g=games.find(g=>g.id===row.gameId);row.opponent=g&&row.team?[TEAM_ABBR[g.home_team],TEAM_ABBR[g.away_team]].find(t=>t!==row.team)??null:null;
  const reasons=pipelineReasons.filter(r=>normName(r.player)===normName(row.player)&&r.gameId===row.gameId&&r.market===row.market&&r.side===row.side&&r.line===row.line).map(r=>r.reason);
  row.validation=checkExplorerRow(row,row.roster,injuryReport,evaluationNow,providerBlocked,reasons);
 }
 const summary=explorerSummary(rows,providerBlocked);
 const validProvider=providerPool.filter(c=>rows.some(r=>r.source==='independent-api'&&r.id===c.providerPropId&&r.validation&&(r.validation.eligibility.best.length===0||r.validation.eligibility.aggr.length===0)));
 const validManual=manualPool.filter(c=>rows.some(r=>r.source==='manual'&&r.gameId===c.gameId&&r.player===c.name&&r.market===c.market&&r.side===c.side&&r.line===c.line&&r.odds===c.odds&&r.validation&&(r.validation.eligibility.best.length===0||r.validation.eligibility.aggr.length===0)));
 const full=generate([...validProvider,...validManual].filter(c=>inSundayWindow(c.kickoff,evaluationNow)),evaluationNow,{pregameResearch:true});
 const validQ=quarterPool.filter(c=>rows.some(r=>r.source==='independent-api'&&r.player===c.player&&r.gameId===c.gameId&&r.market===quarterMarketKey(c.market)&&r.side===c.side&&r.line===c.line&&r.odds===c.odds&&r.validation?.quarter&&(r.validation.quarter.best.length===0||r.validation.quarter.aggressive.length===0)));
 const validManualQuarter=manualQuarter.filter(c=>rows.some(r=>r.source==='manual'&&r.player===c.player&&r.gameId===c.gameId&&r.market===quarterMarketKey(c.market)&&r.side===c.side&&r.line===c.line&&r.odds===c.odds&&r.validation?.quarter&&(r.validation.quarter.best.length===0||r.validation.quarter.aggressive.length===0)));
 const quarter=generateFirstQuarter([...validQ,...validManualQuarter].filter(c=>inSundayWindow(c.kickoff,evaluationNow)),evaluationNow);
 return {rows,summary,full,quarter,fullPreview,quarterPreview,games,notes,providerBlocked,coverage:'PARTIAL — independent provider snapshot, not the complete FanDuel sportsbook. Unknown/missing markets are not proof of sportsbook unavailability. No extra market endpoint or paid fallback was called.',observedStats:[...new Set(rows.map(r=>r.stat))],unobservedStats:Object.keys(PROP_STATS).filter(s=>!rows.some(r=>r.stat===s)),checkedAt:new Date(evaluationNow).toISOString()};
}
