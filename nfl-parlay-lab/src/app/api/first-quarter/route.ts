import {quarterGameCatalog} from '@/server/quarterGameCatalog.ts';
import {nflTeam} from '@/server/nflEventMatching.ts';
import {freeSchedule} from '@/server/freeResearch.ts';
import {quarterDate} from '@/server/quarterDiagnostics.ts';
import {readBoard,refreshBoard,assertBoardUsable,cachedResearchBoard,providerAccessStatus,FanDuelRestError} from '@/server/fanduelRest.ts';
import {fanduelQuarterResearch,pregameQuarterHistory} from '@/server/firstQuarterResearch.ts';
import { NextResponse } from 'next/server';
import { fetchEvents, fetchFirstQuarterMarkets, type FirstQuarterMarkets, OddsApiError, type ApiEvent } from '@/lib/providers/oddsApi.ts';
import { currentSeason, TEAM_ABBR } from '@/lib/service.ts';
import { loadFirstQuarterHistory, loadStatsHistory, loadCurrentInjuries } from '@/lib/providers/stats.ts';
import { generateFirstQuarter, makeFirstQuarterCandidates,firstQuarterRejectionReasons } from '@/lib/firstQuarter.ts';
import type { FirstQuarterCandidate } from '@/lib/types.ts';
import { cachedProviderFetch } from '@/server/load.ts';
import { getDb } from '@/server/db.ts';
import { verifyQuarterAvailability } from '@/lib/providers/espn.ts';

export const dynamic = 'force-dynamic';
const ttl = Number(process.env.ODDS_CACHE_MIN ?? 30) * 60_000;

interface CachedEventMarkets extends FirstQuarterMarkets { error?: string; notice?: string }
const errorMessage = (error: unknown, key: string) => (error instanceof Error ? error.message : 'Unknown live data error')
  .replace(/apiKey=[^&\s]*/gi, 'apiKey=[redacted]')
  .replace(key, '[redacted]');

export async function GET(request: Request) {
  const url = new URL(request.url);
  const headers={'Cache-Control':'no-store'};
  const fdKey=process.env.FANDUEL_API_KEY?.trim()??'',oddsKey=process.env.ODDS_API_KEY?.trim()??'';
  if(url.searchParams.get('status')==='1'){try{return NextResponse.json({fanduelConfigured:!!fdKey,oddsApiConfigured:!!oddsKey,fetchedAt:fdKey?readBoard(getDb(),fdKey)?.fetchedAt??null:null,access:providerAccessStatus(getDb(),fdKey),collectionMode:'explicit-refresh-only'},{headers});}catch{return NextResponse.json({error:'Q1 provider status unavailable. Check persistent database access.'},{status:503,headers});}}
  if(url.searchParams.get('catalog')==='1'){
   try{const db=getDb(),board=fdKey?readBoard(db,fdKey):null;return NextResponse.json(await quarterGameCatalog(board,cachedProviderFetch(db)),{headers});}
   catch{return NextResponse.json({games:[],error:'Verified free NFL schedule unavailable. Game choices cannot be inferred from stale provider events. No odds-provider request was made.'},{status:503,headers});}
  }
  const provider=url.searchParams.get('provider')??(fdKey?'fanduel':'odds-api');
  if(!['fanduel','odds-api'].includes(provider))return NextResponse.json({error:'Unknown Q1 provider.'},{status:400,headers});
  if(provider==='fanduel'){
   try{
    if(!fdKey)throw new FanDuelRestError('Independent FanDuel API is not configured. Manual/full-game data is never used as Q1 odds.',409);
    const date=url.searchParams.get('date')??'ALL';if(date!=='ALL'&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Date must use YYYY-MM-DD format.'},{status:400,headers});
    const preview=url.searchParams.get('preview')==='1';
    const db=getDb(),{board,providerWarning}=cachedResearchBoard(db,fdKey,preview);
    return NextResponse.json({...await fanduelQuarterResearch(board,cachedProviderFetch(db),Date.now(),date,url.searchParams.get('game')??'ALL',preview,!!providerWarning),providerWarning,providerAccess:providerAccessStatus(db,fdKey)},{headers});
   }catch(e){return NextResponse.json({error:e instanceof FanDuelRestError?e.message:'Verified first-quarter analysis is unavailable; no substitute odds or picks were added.'},{status:e instanceof FanDuelRestError?e.status:503,headers});}
  }
  const date = url.searchParams.get('date') ?? 'ALL';
  const game = url.searchParams.get('game') ?? 'ALL';
  const force = url.searchParams.get('refresh') === '1';
  const key = process.env.ODDS_API_KEY?.trim();
  if (date !== 'ALL' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Date must use YYYY-MM-DD format.' }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({
      mode: 'unavailable',
      provider:'odds-api',
      candidates: [],
      playerPropsAvailable: false,
      totals: [],
      best: { options: [], missing: ['ODDS_API_KEY is not set; live FanDuel first-quarter markets are unavailable.'] },
      aggressive: { options: [], missing: ['ODDS_API_KEY is not set; live FanDuel first-quarter markets are unavailable.'] },
      missing: [],
    });
  }
  try {
    const schedule = await fetchEvents(key);
    const upcoming=schedule.events.filter(event=>Date.parse(event.commence_time)>Date.now());
    let events=upcoming.filter(event=>(game!=='ALL'||date==='ALL'||quarterDate(event.commence_time)===date)&&(game==='ALL'||game===event.id));
    if(game!=='ALL'&&!events.length){
      const verified=await freeSchedule(cachedProviderFetch(getDb())),target=verified.filter(g=>g.id===game||g.espnEventId===game);
      if(target.length===1)events=upcoming.filter(e=>nflTeam(e.home_team)===nflTeam(target[0].home_team)&&nflTeam(e.away_team)===nflTeam(target[0].away_team)&&Math.abs(Date.parse(e.commence_time)-Date.parse(target[0].commence_time))<=60000);
      if(events.length!==1)events=[];
    }
    const db = getDb();
    const eventRows = new Map<string, CachedEventMarkets>();
    const fetchTimes:number[]=[];
    let remaining: string | null = schedule.remaining;
    for (const event of events) {
      const cacheKey = `first-quarter-v4:${event.id}`;
      const cached = force ? undefined : db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(cacheKey) as { value: string; fetched_at: number } | undefined;
      if (cached && Date.now() - cached.fetched_at < ttl) {
        fetchTimes.push(cached.fetched_at);
        const value = JSON.parse(cached.value) as CachedEventMarkets;
        eventRows.set(event.id, value);
        remaining = value.remaining ?? remaining;
        continue;
      }
      try {
        const result = await fetchFirstQuarterMarkets(key, event.id);
        fetchTimes.push(Date.now());
        console.info('[first-quarter-market-diagnostics]', {
          eventId: event.id,
          requestedMarketKeys: result.requestedMarketKeys,
          availableMarketKeys: result.availableMarketKeys,
          unmappedPlayerMarketKeys: result.unmappedPlayerMarketKeys,
          playerStatus: result.playerStatus,
          totalStatus: result.totalStatus,
        });
        const label = `${event.away_team} @ ${event.home_team}`;
        const notice = result.playerRows.length
          ? undefined
          : `No FanDuel first-quarter player props are available for ${label} (${result.playerStatus === 'unsupported' ? 'player markets are unsupported by the data plan' : result.unmappedPlayerMarketKeys.length ? `unmapped quarter-player market keys were returned: ${result.unmappedPlayerMarketKeys.join(', ')}` : 'the player-market request succeeded but returned no player lines'}); full-game markets were not substituted.${result.totalRows.length ? ' Showing first-quarter totals separately.' : result.totalStatus === 'unsupported' ? ' First-quarter totals are also unsupported.' : ''}`;
        const value: CachedEventMarkets = { ...result, notice };
        eventRows.set(event.id, value);
        remaining = result.remaining ?? remaining;
        db.prepare('INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify(value), Date.now());
      } catch (error) {
        const message = errorMessage(error, key);
        eventRows.set(event.id, {
          playerRows: [], totalRows: [], requestedMarketKeys: [], availableMarketKeys: [],
          unmappedPlayerMarketKeys: [], playerStatus: 'none', totalStatus: 'none', remaining: null, error: message,
        });
        if (!(error instanceof OddsApiError && error.status === 429)) {
          db.prepare('INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify({
            playerRows: [], totalRows: [], requestedMarketKeys: [], availableMarketKeys: [],
            unmappedPlayerMarketKeys: [], playerStatus: 'none', totalStatus: 'none', remaining: null, error: message,
          }), Date.now());
        }
        if (error instanceof OddsApiError && error.status === 429) break;
      }
    }

    const rows = [...eventRows.values()].flatMap((value) => value.playerRows);
    const totals = events.flatMap((event) => (eventRows.get(event.id)?.totalRows ?? []).map((row) => ({
      game: `${event.away_team} @ ${event.home_team}`,
      ...row,
    })));
    const notes = [...new Set([...eventRows.values()].flatMap((value) => [value.error, value.notice].filter((message): message is string => Boolean(message))))];
    if (!events.length) notes.push(`No upcoming NFL games are scheduled for ${date}.`);
    if (events.length && !rows.length && !notes.length) notes.push('No FanDuel first-quarter player props were returned; no full-game markets were substituted.');

    let candidates: FirstQuarterCandidate[] = [];
    const availabilityRejections:{player:string;gameId:string;market:string;reason:string}[]=[];
    let projected=0;
    if (rows.length) {
      const providerFetch = cachedProviderFetch(db);
      const season = currentSeason();
      const stats = await loadStatsHistory(season, providerFetch);
      const rawQuarter = await loadFirstQuarterHistory(season, providerFetch, stats.games);
      const quarterHistory={...rawQuarter,...pregameQuarterHistory(rawQuarter,stats.games,Date.now())};
      for (const event of events) {
        const eventMarkets = eventRows.get(event.id)?.playerRows ?? [];
        if (!eventMarkets.length) continue;
        candidates.push(...makeFirstQuarterCandidates(eventMarkets, event, stats.games.filter(g=>g.gameDate&&!g.invalidGameDate&&Date.parse(g.gameDate)<Date.now()), quarterHistory, TEAM_ABBR, Date.now(), season));
      }
      let injuryReport:Awaited<ReturnType<typeof loadCurrentInjuries>>|null=null;
      let injuries: Map<string, string> | null = null;
      try { injuryReport=await loadCurrentInjuries(season,providerFetch);injuries=injuryReport.statuses; }
      catch { notes.push('Current first-quarter injury coverage unavailable; automatic Q1 player selections remain blocked.'); }
      const availability = await verifyQuarterAvailability(candidates,
        new Map(events.map((event) => [event.id, [TEAM_ABBR[event.home_team] ?? event.home_team, TEAM_ABBR[event.away_team] ?? event.away_team]])),
        injuries, providerFetch,{currentSnapshotAt:injuryReport?.currentSnapshotAt??null,coveredTeams:injuryReport?.coveredTeams??[],now:Date.now()});
      projected=candidates.length;availabilityRejections.push(...availability.rejections);
      candidates = availability.candidates;
      if (availability.excluded) notes.push(`${availability.excluded} Q1 props excluded by current roster/team/position or injury checks.`);
      if (availability.errors.length) notes.push('Some ESPN roster checks failed; unverified Q1 players were excluded.');
      if (!quarterHistory.playerGames.length && !quarterHistory.teamGames.length && !quarterHistory.gameTotals.length) {
        const failures = quarterHistory.unavailable.length
          ? quarterHistory.unavailable.map((item) => `${item.season}: ${item.error}`).join('; ')
          : 'nflverse first-quarter play-by-play returned no usable rows';
        notes.push(`Verified first-quarter historical splits unavailable (${failures}). Best 1Q probabilities use FanDuel prices only; Aggressive 1Q requires historical support.`);
      } else if (quarterHistory.unavailable.length) {
        notes.push(`Some first-quarter history seasons were unavailable: ${quarterHistory.unavailable.map((item) => `${item.season} (${item.error})`).join('; ')}.`);
      }
      if (!stats.games.length) notes.push('Player IDs from historical nflverse stats are unavailable, so player-market first-quarter splits cannot be matched.');
      if (stats.unavailable.length) notes.push(`Player ID history unavailable for ${stats.unavailable.map((item) => item.season).join(', ')}.`);
    }
    const generated = generateFirstQuarter(candidates);
    if (generated.best.options.length === 0 && rows.length) notes.push('Fewer than three valid first-quarter selections are available; no placeholder picks were added.');
    if (rows.length && !candidates.length) notes.push('FanDuel returned Q1 player markets, but no fresh supported QB passing, RB rushing, or WR/TE receiving lines could be analyzed.');

    const checked=Date.now();
    const diagnostics={endpoint:'The Odds API v4 event odds',checkedAt:new Date(checked).toISOString(),fetchedAt:fetchTimes.length?new Date(Math.min(...fetchTimes)).toISOString():null,dateTimeZone:'America/New_York',requestedDate:date,requestedGame:game,
      eligibilityEvaluated:true,cachedFields:['verified Q1 market keys and parsed side outcomes; raw unparsed counts unavailable'],missingPeriodRows:0,rawRows:rows.length,periodCounts:{'verified Q1 side outcomes':rows.length},rawQ1Rows:rows.length,supportedQ1Rows:rows.length,q1StatCounts:Object.fromEntries([...new Set(rows.map(r=>r.market))].map(m=>[m,rows.filter(r=>r.market===m).length])),normalizedRows:0,
      matchedGames:events.filter(e=>eventRows.get(e.id)?.playerRows.length).length,matchedSidePrices:rows.length,selectedMatchedGames:events.filter(e=>eventRows.get(e.id)?.playerRows.length).length,selectedSidePrices:rows.length,freshSidePrices:candidates.length,projectedSideProps:projected,availabilityEligibleSideProps:candidates.length,
      eligibleSideProps:candidates.filter(c=>!firstQuarterRejectionReasons(c,false,checked).length).length,eligiblePlayers:new Set(candidates.map(c=>c.espnPlayerId??c.player)).size,aggressiveEligibleSideProps:candidates.filter(c=>!firstQuarterRejectionReasons(c,true,checked).length).length,bestOptions:generated.best.options.length,aggressiveOptions:generated.aggressive.options.length,
      coverage:rows.length?'q1-player-prices-returned':'no-verified-q1-player-prices',events:events.map(e=>({providerEventId:e.id,label:`${e.away_team} @ ${e.home_team}`,kickoffUtc:e.commence_time,verifiedKickoffUtc:e.commence_time,nflDate:quarterDate(e.commence_time),pregame:Date.parse(e.commence_time)>checked,matchedGameId:e.id})),
      rejections:[...availabilityRejections.map(r=>({stage:'availability',reason:r.reason,player:r.player,gameId:r.gameId})),...candidates.flatMap(c=>firstQuarterRejectionReasons(c,true,checked).map(reason=>({stage:'ticket-eligibility',reason,player:c.player,gameId:c.gameId}))),...notes.map(reason=>({stage:'provider-or-history',reason}))]};
    return NextResponse.json({
      mode: 'live',provider:'odds-api',diagnostics,
      games: events.map((event: ApiEvent) => ({
        id: event.id,
        label: `${TEAM_ABBR[event.away_team] ?? event.away_team} @ ${TEAM_ABBR[event.home_team] ?? event.home_team}`,
        status: eventRows.get(event.id)?.error ? 'error' : eventRows.get(event.id)?.playerRows.length ? 'available' : 'none',
        playerStatus: eventRows.get(event.id)?.playerStatus ?? 'none',
        totalStatus: eventRows.get(event.id)?.totalStatus ?? 'none',
        requestedMarketKeys: eventRows.get(event.id)?.requestedMarketKeys ?? [],
        availableMarketKeys: eventRows.get(event.id)?.availableMarketKeys ?? [],
        unmappedPlayerMarketKeys: eventRows.get(event.id)?.unmappedPlayerMarketKeys ?? [],
        markets: [...new Set([
          ...(eventRows.get(event.id)?.playerRows ?? []),
          ...(eventRows.get(event.id)?.totalRows ?? []),
        ].map((row) => row.market))],
      })),
      candidates,
      playerPropsAvailable: rows.length > 0,
      totals,
      ...generated,
      missing: notes,
      oddsApiCreditsRemaining: remaining ?? 'unknown',
      selectedDate: date,
      generatedAt: Date.now(),
    });
  } catch (error) {
    const message = errorMessage(error, key);
    const status = error instanceof OddsApiError && error.status === 429 ? 429 : 502;
    return NextResponse.json({ mode: 'live', error: `Live first-quarter data unavailable: ${message}` }, { status });
  }
}

// Explicit opt-in only. Reuse the same provider board, TTL and cooldown as six-pick research.
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 try{
  const text=await request.text();if(text.length>1000)return NextResponse.json({error:'Request too large.'},{status:413,headers});
  let body;try{body=JSON.parse(text);}catch{return NextResponse.json({error:'Send a valid Q1 refresh action.'},{status:400,headers});}
  if(!['refresh-fanduel','preview-fanduel'].includes(body?.action))return NextResponse.json({error:'Unknown Q1 action.'},{status:400,headers});
  const key=process.env.FANDUEL_API_KEY?.trim()??'',db=getDb();
  if(!key)throw new FanDuelRestError('Independent FanDuel API is not configured; no cached snapshot identity can be established.',409);
  const preview=body.action==='preview-fanduel',date=typeof body.date==='string'?body.date:'ALL';
  if(date!=='ALL'&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new FanDuelRestError('Date must use YYYY-MM-DD format.',400);
  const {board,providerWarning}=preview?cachedResearchBoard(db,key,true):{board:await refreshBoard(db,key),providerWarning:null};
  if(!preview)assertBoardUsable(db,key,board);
  return NextResponse.json({...await fanduelQuarterResearch(board,cachedProviderFetch(db),Date.now(),date,typeof body.game==='string'?body.game:'ALL',preview,!!providerWarning),providerWarning,providerAccess:providerAccessStatus(db,key),requestMode:preview?'cached-preview':'provider-refresh'},{headers});
 }catch(e){return NextResponse.json({error:e instanceof FanDuelRestError?e.message:'Q1 provider data is unavailable. Existing tickets and forecasts were preserved.',retryAt:e instanceof FanDuelRestError?e.retryAt:null,failureKind:e instanceof FanDuelRestError?e.kind:null},{status:e instanceof FanDuelRestError?e.status:503,headers});}
}
