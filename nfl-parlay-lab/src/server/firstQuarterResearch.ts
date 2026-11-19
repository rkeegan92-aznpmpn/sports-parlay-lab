import {quarterMarketKey} from '../lib/propMarkets.ts';
import {quarterPreviews} from '../lib/researchPreview.ts';
import {previewQuoteAllowed,previewLeg} from './previewQuotes.ts';
import {groupQuarterRejections} from '../lib/quarterRejections.ts';
import {inspectQuarterBoard} from './quarterDiagnostics.ts';
import {FanDuelRestError,type Board} from './fanduelRest.ts';
import {freeSchedule} from './freeResearch.ts';
import {currentSeason,TEAM_ABBR} from '../lib/service.ts';
import {loadFirstQuarterHistory,loadStatsHistory,loadCurrentInjuries,type StatGame} from '../lib/providers/stats.ts';
import {makeFirstQuarterCandidates,generateFirstQuarter,firstQuarterRejectionReasons,type FirstQuarterHistory} from '../lib/firstQuarter.ts';
import {verifyQuarterAvailability} from '../lib/providers/espn.ts';
import type {FirstQuarterCandidate} from '../lib/types.ts';

/** PBP splits need a dated player-game anchor; full-game values never stand in for Q1 splits. */
export function pregameQuarterHistory(history:FirstQuarterHistory,stats:StatGame[],now:number):FirstQuarterHistory {
 const verified=stats.filter(g=>g.gameDate&&!g.invalidGameDate&&Number.isFinite(Date.parse(g.gameDate))&&Date.parse(g.gameDate)<now);
 const games=new Set(verified.map(g=>g.gameId));
 const players=new Set(verified.filter(g=>g.playerId).map(g=>`${g.playerId}|${g.gameId}`));
 return {playerGames:history.playerGames.filter(g=>games.has(g.gameId)&&players.has(`${g.playerId}|${g.gameId}`)&&Number.isFinite(g.value)&&Number.isFinite(g.opportunities)),
 teamGames:history.teamGames.filter(g=>games.has(g.gameId)&&Number.isFinite(g.points)),gameTotals:history.gameTotals.filter(g=>games.has(g.gameId)&&Number.isFinite(g.points))};
}
export async function fanduelQuarterResearch(board:Board,f:typeof fetch=fetch,now=Date.now(),date='ALL',game='ALL',stalePreview=false,providerBlocked=false) {
 const started=Date.now();
 if(!board.complete)throw new FanDuelRestError('Incomplete FanDuel board cannot verify first-quarter markets.',409);
 let games:Awaited<ReturnType<typeof freeSchedule>>=[],scheduleFailed=false;
 try{games=await freeSchedule(f,now);}catch(e){if(!stalePreview)throw e;scheduleFailed=true;}
 const {selected,matched,quotes,active:timestampActive,diagnostics}=inspectQuarterBoard(board,games,now,date,game);
 const freshActive=providerBlocked?[]:timestampActive;
 diagnostics.providerVerificationBlocked=providerBlocked;if(providerBlocked){diagnostics.priceAvailability='provider-verification-failed';diagnostics.freshSidePrices=0;diagnostics.rejections.push({stage:'provider-verification',reason:'Latest provider failure invalidates actionable cached prices. Timestamp checks do not re-verify provider access; cached preview remains non-actionable.'});}
 const active=stalePreview?quotes.filter(q=>previewQuoteAllowed(q,now)):freshActive;
 const missing:string[]=[];let candidates:FirstQuarterCandidate[]=[];
 const dataAvailability={schedule:scheduleFailed?'unavailable':'verified',scheduleGames:games.length,selectedGames:selected.length,historicalRows:null as number|null,q1HistoryRows:null as number|null};
 if(scheduleFailed){const reason='Verified free NFL schedule retrieval failed. Cached Q1 rows remain visible, but game matching and preview selection are blocked; no kickoff or game was inferred.';missing.push(reason);diagnostics.rejections.push({stage:'schedule-provider',reason});}
 else if(!selected.length)missing.push(`No verified upcoming games match date ${date} and game ${game}. Other dates/weeks were not substituted.`);
 if(diagnostics.coverage==='period-field-missing')missing.push('Cached provider schema is missing period fields; Q1 coverage cannot be verified. No period or odds were inferred.');
 else if(!diagnostics.rawQ1Rows)missing.push('Provider unsupported/unavailable: no raw Q1 rows in this /props snapshot. This is snapshot coverage evidence, not proof the provider never offers Q1. Full-game odds are never substituted.');
 else if(!diagnostics.supportedQ1Rows)missing.push('Raw Q1 rows exist, but their stat identifiers are unsupported by this Q1 model. No full-game or unrelated market mapping was guessed.');
 else if(selected.length&&!diagnostics.selectedQ1Rows)missing.push('No provider Q1 rows match the selected verified upcoming games in this snapshot. Cached previous-week games cannot supply new prices. Provider coverage for these games remains unavailable; full-game markets are not substituted.');
 else if(!active.length)missing.push('Q1 rows exist but no prices passed event/date/game, schema and freshness checks. See Q1 diagnostics for the exact rejection stage.');
 let dataStage='historical player statistics';
 if(active.length){try{
  const season=currentSeason(new Date(now)),stats=await loadStatsHistory(season,f);
  dataAvailability.historicalRows=stats.games.length;
  dataStage='first-quarter history';
  const rawHistory=await loadFirstQuarterHistory(season,f,stats.games),history=pregameQuarterHistory(rawHistory,stats.games,now);
  dataAvailability.q1HistoryRows=history.playerGames.length;
  for(const event of selected){
   const rows=active.filter(q=>q.eventId===event.id).map(q=>({participant:q.player,market:q.market,side:q.side,line:q.line,odds:q.odds,updatedAt:q.observedAt}));
   candidates.push(...makeFirstQuarterCandidates(rows,event,stats.games.filter(g=>g.gameDate&&!g.invalidGameDate&&Date.parse(g.gameDate)<now),history,TEAM_ABBR,now,season,stalePreview));
  }
  diagnostics.projectedSideProps=candidates.length;
  for(const q of active)if(!candidates.some(c=>c.gameId===q.eventId&&c.player===q.player&&c.side===q.side&&c.line===q.line))diagnostics.rejections.push({stage:'identity-history',reason:'Captured Q1 quote has no unambiguous supported player identity/history projection.',player:q.player,gameId:q.eventId,propId:q.id});
  let report:Awaited<ReturnType<typeof loadCurrentInjuries>>|null=null;
  try{report=await loadCurrentInjuries(season,f,now);}catch{missing.push('Verified current injury coverage is unavailable; automatic Q1 player selections remain blocked.');}
  dataStage='roster and injury verification';
  const availability=await verifyQuarterAvailability(candidates,new Map(selected.map(e=>[e.id,[TEAM_ABBR[e.home_team],TEAM_ABBR[e.away_team]]])),report?.statuses??null,f,
   {currentSnapshotAt:report?.currentSnapshotAt??null,coveredTeams:report?.coveredTeams??[],now});
  diagnostics.availabilityEligibleSideProps=availability.candidates.length;
  for(const r of availability.rejections)diagnostics.rejections.push({stage:'availability',reason:r.reason,player:r.player,gameId:r.gameId});
  candidates=availability.candidates.flatMap(c=>{
   const q=active.find(q=>q.eventId===c.gameId&&q.player===c.player&&q.side===c.side&&q.line===c.line&&q.odds===c.odds&&q.observedAt===c.oddsAt&&q.market===quarterMarketKey(c.market));
   if(!q||(q.team&&q.team!==c.team)){diagnostics.rejections.push({stage:'quote-roster-match',reason:'Verified roster team/contract does not match this exact Q1 quote.',player:c.player,gameId:c.gameId});return [];}
   return [{...c,provider:'fanduelapi' as const,providerAsOf:q.meta.asOf!,providerDelaySeconds:q.meta.delaySeconds!}];
  });
  if(availability.excluded)missing.push(`${availability.excluded} Q1 lines excluded by verified active roster, team, position or injury coverage checks.`);
  if(availability.errors.length)missing.push('Some roster providers failed; unmatched Q1 players remain excluded.');
  if(rawHistory.unavailable.length)missing.push('Some verified Q1 play-by-play history is unavailable. No full-game statistics were substituted for Q1 splits.');
  if(!history.playerGames.length)missing.push('No dated verified Q1 player history is available. Best 1Q may use quarter-price-implied estimates only; Aggressive 1Q requires historical support.');
 }catch(e){
  if(!stalePreview)throw e;
  candidates=[];
  const reason=`Free ${dataStage} retrieval failed. Cached quote counts are preserved, but player eligibility could not be established; no picks were added.`;
  missing.push(reason);diagnostics.rejections.push({stage:'player-data-provider',reason});
 }}
 const finalNow=now+(Date.now()-started),generated=generateFirstQuarter(stalePreview?[]:candidates,finalNow);
 diagnostics.checkedAt=new Date(finalNow).toISOString();diagnostics.eligibilityEvaluated=true;
 const apiCandidates=candidates.filter(c=>freshActive.some(q=>q.eventId===c.gameId&&q.player===c.player&&q.side===c.side&&q.line===c.line&&q.observedAt===c.oddsAt));
 diagnostics.eligibleSideProps=apiCandidates.filter(c=>!firstQuarterRejectionReasons(c,false,finalNow).length).length;
 diagnostics.eligiblePlayers=new Set(apiCandidates.filter(c=>!firstQuarterRejectionReasons(c,false,finalNow).length).map(c=>c.espnPlayerId??c.player)).size;
 diagnostics.aggressiveEligibleSideProps=apiCandidates.filter(c=>!firstQuarterRejectionReasons(c,true,finalNow).length).length;
 diagnostics.bestOptions=generated.best.options.length;diagnostics.aggressiveOptions=generated.aggressive.options.length;
 for(const c of candidates)for(const reason of firstQuarterRejectionReasons(c,true,finalNow))diagnostics.rejections.push({stage:'ticket-eligibility',reason,player:c.player,gameId:c.gameId,side:c.side});
 if(active.length&&!diagnostics.projectedSideProps)diagnostics.rejections.push({stage:'identity-history',reason:'Mapped Q1 quotes could not obtain unambiguous historical identity/position or usable price analysis.'});

 const preview=stalePreview?quarterPreviews(candidates,c=>previewLeg(active.find(q=>q.eventId===c.gameId&&q.player===c.player&&q.side===c.side&&q.line===c.line&&q.observedAt===c.oddsAt&&q.market===quarterMarketKey(c.market))!,c.team,c.opponent,c.probability,c.sample,finalNow),finalNow):null;
 const previewDiagnostics=stalePreview?{
  mode:'cached-preview',requestedDate:date,requestedGame:game,cachedAt:new Date(board.fetchedAt).toISOString(),rawQ1Rows:diagnostics.rawQ1Rows,
  selectedGames:selected.length,selectedSidePrices:quotes.length,previewInputSidePrices:active.length,projectedSideProps:diagnostics.projectedSideProps,
  availabilityEligibleSideProps:diagnostics.availabilityEligibleSideProps,
  bestEligiblePlayers:new Set(candidates.filter(c=>!firstQuarterRejectionReasons(c,false,finalNow).some(r=>r!=='Q1 odds are stale or future-dated.')).map(c=>c.espnPlayerId??c.player)).size,
  aggressiveEligiblePlayers:new Set(candidates.filter(c=>!firstQuarterRejectionReasons(c,true,finalNow).some(r=>r!=='Q1 odds are stale or future-dated.')).map(c=>c.espnPlayerId??c.player)).size,
  options:preview?.options.length??0,dataAvailability,
 }:null;
 const rejectionGroups=groupQuarterRejections(diagnostics.rejections);
 return {preview,previewDiagnostics,rejectionGroups,comparisonTargets:active.map(q=>previewLeg(q,q.team??'',q.opponent??'',null,0,finalNow)),provider:'fanduelapi' as const,status:stalePreview?'research-preview':['no-q1-rows-in-snapshot','q1-stats-not-supported'].includes(diagnostics.coverage)?'unsupported':diagnostics.eligibleSideProps?'available':'unavailable',mode:'research',candidates,...generated,missing,
  diagnostics,quotes,issues:matched.issues,playerPropsAvailable:quotes.length>0,totals:[],games:games.map(e=>({id:e.id,label:`${TEAM_ABBR[e.away_team]} @ ${TEAM_ABBR[e.home_team]}`,kickoff:e.commence_time})),
  fetchedAt:board.fetchedAt,generatedAt:finalNow,provenance:'Q1 RESEARCH ONLY — independent fanduelapi.com snapshot. Free tier may be delayed five minutes. Only period=q1 prices; no full-game substitution, validated recommendations or wagers.'};
}
