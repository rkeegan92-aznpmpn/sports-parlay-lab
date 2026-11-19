import { loadStatsHistory, loadCurrentInjuries, loadSchedule } from '../lib/providers/stats.ts';
import { verifyCurrentRoster } from '../lib/providers/espn.ts';
import { currentSeason, loadLive } from '../lib/service.ts';
import { OddsApiError, fetchEvents, fetchFirstQuarterMarkets } from '../lib/providers/oddsApi.ts';
import { generate, eligibilityWarnings, MAX_ODDS_AGE_MIN } from '../lib/optimizer.ts';

/** Real network checks only. No database writes, fallback data, or settlement. May consume odds credits when a key exists. */
export async function diagnoseLive(options: {key?:string; now?:number; fetcher?:typeof fetch;firstQuarter?:boolean}) {
  const now=options.now ?? Date.now(), f=options.fetcher ?? fetch, season=currentSeason(new Date(now));
  const blockers:string[]=[];
  const [stats,injuries,schedule,roster] = await Promise.allSettled([
    loadStatsHistory(season,f), loadCurrentInjuries(season,f,now), loadSchedule(f),
    verifyCurrentRoster([{key:'probe',name:'Josh Allen',team:'BUF',position:'QB'}],f),
  ]);
  const sources={
    statistics: stats.status==='fulfilled' ? {status:stats.value.games.length?'available':'missing', rows:stats.value.games.length,
      identifiedDatedRows:stats.value.games.filter(g=>g.playerId&&g.gameId&&g.gameDate&&!g.invalidGameDate).length,
      unavailableSeasons:stats.value.unavailable.map(s=>s.season)} : {status:'unavailable'},
    injuries:injuries.status==='fulfilled' ? {status:injuries.value.freshSnapshot?'current-dated-listing':injuries.value.statuses.size?'retrieved-freshness-unverified':'empty-coverage-unknown',entries:injuries.value.statuses.size,latestWeekByTeam:injuries.value.latestWeekByTeam,latestReportDate:injuries.value.latestReportDate,currentSnapshotAt:injuries.value.currentSnapshotAt,currentEntries:injuries.value.currentEntries,
      note:'Retrieval alone does not verify current-week report freshness or final inactive status. Missing designations do not mean healthy.'} : {status:'unavailable'},
    nflSchedule:schedule.status==='fulfilled'?{status:schedule.value.length?'available':'empty',rows:schedule.value.length}:{status:'unavailable'},
    espnRoster:roster.status==='fulfilled'?{status:roster.value.players.size?'available':'unmatched',probeMatches:roster.value.players.size,errors:roster.value.errors.length}:{status:'unavailable'},
  };
  if(stats.status!=='fulfilled'||!stats.value.games.length) blockers.push('NFL player statistics unavailable. Restore access to nflverse release data or verified ESPN player history.');
  if(injuries.status!=='fulfilled') blockers.push('NFL injury feed unavailable. Supply an accessible current-season NFL_INJURIES_URL CSV with the existing nflverse report schema; current availability cannot be certified.');
  if(schedule.status!=='fulfilled'||!schedule.value.length) blockers.push('Authoritative NFL schedule unavailable. Restore access to nflverse games.csv before asserting result-event mapping.');
  if(roster.status!=='fulfilled'||!roster.value.players.size) blockers.push('ESPN current roster probe failed. Restore site.api.espn.com access; actual ticket players still require individual roster checks.');
  if (injuries.status==='fulfilled') {
    const date=new Date(now).toISOString().slice(0,10), until=new Date(now+14*864e5).toISOString().slice(0,10);
    const upcoming=schedule.status==='fulfilled'?schedule.value.filter(g=>Number(g.season)===season && g.game_type==='REG' && g.gameday>=date && g.gameday<=until):[];
    const gaps=upcoming.flatMap(g=>[g.home_team,g.away_team].filter(team=>(injuries.value.latestWeekByTeam[team]??0)<Number(g.week)).map(team=>({team,event:g.game_id,expectedWeek:Number(g.week),reportWeek:injuries.value.latestWeekByTeam[team]??null})));
    if(gaps.length && !injuries.value.freshSnapshot) {
      Object.assign(sources.injuries,{status:'behind-upcoming-game-week',upcomingCoverageGaps:gaps});
      blockers.push('Injury reports lag upcoming scheduled game weeks. Obtain current-week reports/final inactive information before treating availability as verified; old designations remain conservative exclusions.');
    } else if(!injuries.value.latestReportDate && !injuries.value.freshSnapshot) {
      blockers.push('Injury report publication date is absent. Current availability/freshness cannot be certified from retrieval success alone.');
    }
  }
  let live:unknown={status:'blocked-missing-key',tickets:{best:null,aggressive:null}};
  if (!options.key?.trim()) blockers.push('ODDS_API_KEY missing in the effective app environment. Configure the existing private The Odds API key and restart the app; no paid odds requests or substitute tickets were made.');
  else try {
    const events=await fetchEvents(options.key,f);
    const data=await loadLive({key:options.key,date:'ALL'},now,f,events);
    const result=generate(data.candidates,now,{pregameResearch:true});
    const summarize=(ticket:typeof result.best.options[number]|undefined)=>ticket?{
      purpose:ticket.purpose,validatedRecommendation:false,theoreticalDecimal:ticket.decimal,estimatedJointProbability:ticket.jointP,
      estimatedEV:ticket.ev,combinedSportsbookQuoteVerified:false,
      legs:ticket.legs.map(c=>({player:c.name,pos:c.pos,team:c.team,opponent:c.opp,eventId:c.gameId,kickoff:c.kickoff,
        market:c.market,side:c.side,line:c.line,odds:c.odds,oddsAt:c.oddsAt,estimatedProbability:c.scored?.p,estimatedEV:c.scored?.ev,
        historySource:c.historySource,historyPlayerId:c.historyPlayerId,historySample:c.sample,rosterVerified:c.rosterVerified,
        injury:c.injury??'unknown/not reported; not a healthy designation'})),warnings:ticket.warnings,
    }:null;
    live={status:result.best.options.length&&result.aggr.options.length?'research-tickets-available':'incomplete',
      creditsRemaining:data.diagnostics.oddsApiCreditsRemaining??'unknown',
      games:data.games.map(g=>({id:g.id,kickoff:g.kickoff,status:g.status,providerHttpStatus:g.providerHttpStatus,providerErrorCode:g.providerErrorCode,markets:g.markets,props:g.props})),
      quotes:{matched:data.candidates.length,staleOrInvalid:data.candidates.filter(c=>c.scored?.stale).length,maxAgeMinutes:MAX_ODDS_AGE_MIN},
      tickets:{best:summarize(result.best.options[0]),aggressive:summarize(result.aggr.options[0])},
      missing:{best:result.best.missing,aggressive:result.aggr.missing},
      exclusions:data.candidates.map(c=>({player:c.name,market:c.market,reasons:eligibilityWarnings('best',c,now)})).filter(c=>c.reasons.length).slice(0,30)};
    if(options.firstQuarter) {
      const event=events.events.find(e=>Date.parse(e.commence_time)>now);
      let firstQuarter:unknown={status:'no-upcoming-event'};
      if(event) try {
        const q=await fetchFirstQuarterMarkets(options.key,event.id,f);
        firstQuarter={eventId:event.id,playerStatus:q.playerStatus,totalStatus:q.totalStatus,playerLines:q.playerRows.length,totalLines:q.totalRows.length};
      } catch {firstQuarter={status:'provider-access-unavailable'};blockers.push('Optional first-quarter provider check failed; access or available markets require verification.');}
      Object.assign(live as object,{firstQuarter});
    }
    const failedStatuses=new Set(data.games.filter(g=>g.status==='error').map(g=>g.providerHttpStatus));
    if(data.games.some(g=>g.providerErrorCode==='OUT_OF_USAGE_CREDITS')) blockers.push('Provider reports OUT_OF_USAGE_CREDITS: the subscription quota is exhausted; this does not prove the key is invalid.');
    if(failedStatuses.has(401) && !data.games.some(g=>g.providerErrorCode==='OUT_OF_USAGE_CREDITS')) blockers.push('FanDuel event player-prop requests rejected authentication (401), even though the events list was accessible. Verify provider credentials.');
    if(failedStatuses.has(403)||failedStatuses.has(422)) blockers.push('FanDuel event player-prop access was denied or the requested markets were unavailable (403/422). Verify NFL player-prop entitlement on the existing plan.');
    if(failedStatuses.has(429)) blockers.push('FanDuel event player-prop requests exhausted the request quota/rate limit (429). Restore provider credits or wait for recovery.');
    if(!result.best.options.length||!result.aggr.options.length) blockers.push('Live data cannot currently form both supported tickets. Review missing positions, event availability, player history, roster, fresh quotes and EV; no placeholder selections were added.');
  } catch(error) {
    const status=error instanceof OddsApiError?error.status:0;
    live={status:'provider-failure',httpStatus:status,providerErrorCode:error instanceof OddsApiError?error.code:undefined,creditsRemaining:error instanceof OddsApiError?error.remaining:undefined,tickets:{best:null,aggressive:null}};
    blockers.push(error instanceof OddsApiError && error.code==='OUT_OF_USAGE_CREDITS'?'The Odds API reports OUT_OF_USAGE_CREDITS; restore subscription credits. This does not establish an invalid key.':status===401?'The Odds API rejected authentication. Verify the existing key in the provider account, then restart the app.'
      :status===403||status===422?'The Odds API denied provider/market access. Confirm NFL US FanDuel event player-prop access on this subscription.'
      :status===429?'The Odds API quota/rate limit was reached. Restore request credits or wait for rate-limit recovery.'
      :'Live provider request failed. Check network/provider availability; no simulated fallback was used.');
  }
  return {checkedAtUTC:new Date(now).toISOString(),season,sources,live,blockers,
    note:'No database mutation, settlement or saved-ticket changes. All displayed tickets are unvalidated research; provider presence is not a calibration claim.'};
}
