import { credentialFingerprint, liveCacheKey } from './credentials.ts';
import { getDb } from './db.ts';
import { Buffer } from 'node:buffer';
import { demoResult, loadLive, currentSeason, refreshCandidateHistory, selectSchedule, TEAM_ABBR, type LoadResult } from '../lib/service.ts';
import { fetchEvents, OddsApiError, type ApiEvent } from '../lib/providers/oddsApi.ts';
import { MODEL_VERSION, scoreAll } from '../lib/model.ts';
import { captureForecasts } from './tracking.ts';
import { loadCurrentInjuries, loadStatsHistory } from '../lib/providers/stats.ts';

import { MAX_ODDS_AGE_MIN } from '../lib/optimizer.ts';

export function canReuseLiveCache(data: Pick<LoadResult, 'games' | 'candidates' | 'pipelineRejections'>, events: ApiEvent[], now: number): boolean {
  if (!Array.isArray(data.pipelineRejections) || data.pipelineRejections.some((rejection) =>
    typeof rejection.player !== 'string' || typeof rejection.market !== 'string' ||
    !['Over', 'Under', 'Yes','AtLeast'].includes(rejection.side) ||
    !(rejection.line === null || typeof rejection.line === 'number' && Number.isFinite(rejection.line)) ||
    typeof rejection.gameId !== 'string' || typeof rejection.eventLabel !== 'string' ||
    typeof rejection.kickoff !== 'string' || typeof rejection.reason !== 'string' ||
    !Number.isInteger(rejection.count) || rejection.count < 1,
  )) return false;
  if (data.games.some(g=>g.status==='error')) return false;
  if (data.games.length !== events.length) return false;
  if (events.some(event => {
    const old = data.games.find(g => g.id === event.id);
    const label = `${TEAM_ABBR[event.away_team] ?? event.away_team} @ ${TEAM_ABBR[event.home_team] ?? event.home_team}`;
    return !old || old.kickoff !== event.commence_time || old.label !== label;
  })) return false;
  return data.candidates.every(candidate => {
    const age = now - Date.parse(candidate.oddsAt);
    return age >= -5 * 60000 && age <= MAX_ODDS_AGE_MIN * 60000;
  });
}

const HISTORY_CACHE_TTL = Number(process.env.NFL_STATS_CACHE_HOURS ?? 24) * 60 * 60 * 1000;
const INJURY_CACHE_TTL = Number(process.env.NFL_INJURIES_CACHE_MIN ?? 60) * 60 * 1000;
const RESULTS_CACHE_TTL = Number(process.env.NFL_RESULTS_CACHE_MIN ?? 15) * 60 * 1000;
const ROSTER_CACHE_TTL = Number(process.env.NFL_ROSTER_CACHE_MIN ?? 60) * 60 * 1000;
export const cachedProviderFetch = (db: ReturnType<typeof getDb>, f: typeof fetch = fetch): typeof fetch => async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const cacheName = headers.get('x-provider-cache-name') ?? headers.get('x-nflverse-cache-name');
  headers.delete('x-provider-cache-name');
  headers.delete('x-nflverse-cache-name');
  const isProviderCsv = /stats_player_week_\d+\.csv(?:\.gz)?|injuries_\d+\.csv(?:\.gz)?|play_by_play_\d+\.csv(?:\.gz)?/.test(url);
  const isRoster = /site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/teams\/[^/]+\/roster$/.test(url);
  const isReleaseManifest = /api\.github\.com\/repos\/nflverse\/nflverse-data\/releases\/tags\/(stats_player|injuries)$/.test(url);
  const isReleaseAsset = /api\.github\.com\/repos\/nflverse\/nflverse-data\/releases\/assets\/\d+$/.test(url);
  if (!isProviderCsv && !isReleaseManifest && !isReleaseAsset && !cacheName) return f(input, init);
  const isInjury = /espn:injuries:|injuries_\d+\.csv|asset:injuries_|manifest:injuries/.test(`${url} ${cacheName ?? ''}`);
  const recentResults = `${url} ${cacheName ?? ''}`.includes(`stats_player_week_${currentSeason()}`) || url.includes(`play_by_play_${currentSeason()}`) ||
    (/espn:(?:gamelog|summary|final-summary):/.test(cacheName ?? '') || cacheName === 'nflverse:game-schedule') ||
    (isReleaseManifest && url.endsWith('/stats_player'));
  const cacheTtl = isRoster ? ROSTER_CACHE_TTL : isInjury ? Math.min(INJURY_CACHE_TTL, RESULTS_CACHE_TTL)
    : recentResults ? Math.min(HISTORY_CACHE_TTL, RESULTS_CACHE_TTL) : HISTORY_CACHE_TTL;
  const binary = isReleaseAsset || /\.gz(?:$|\?)/.test(url);
  const cacheKey = `provider:${binary ? 'binary-v2:' : ''}${cacheName ?? url}`;
  const cached = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(cacheKey) as { value: string; fetched_at: number } | undefined;
  if (cached && Date.now() - cached.fetched_at < cacheTtl) {
    if (cached.value.startsWith('base64:')) return new Response(Buffer.from(cached.value.slice(7), 'base64'));
    return new Response(cached.value.startsWith('text:') ? cached.value.slice(5) : cached.value);
  }
  const response = await f(input, { ...init, headers });
  if (response.ok) {
    const body = binary
      ? `base64:${Buffer.from(await response.clone().arrayBuffer()).toString('base64')}`
      : `text:${await response.clone().text()}`;
    db.prepare('INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?, ?, ?)').run(cacheKey, body, Date.now());
  }
  return response;
};

const inFlight=new Map<string,Promise<LoadResult>>();
export async function getData(force=false):Promise<LoadResult> {
  const identity=credentialFingerprint(process.env.ODDS_API_KEY)??'missing';
  const pending=inFlight.get(identity);if(pending)return pending;
  const work=loadData(force);inFlight.set(identity,work);
  try {return await work;} finally {if(inFlight.get(identity)===work)inFlight.delete(identity);}
}
async function loadData(force = false): Promise<LoadResult> {
  const now = Date.now(), key = process.env.ODDS_API_KEY?.trim();
  if (!key) {
    if (process.env.DEMO_MODE === '1') return demoResult(now, 'Explicit DEMO_MODE is enabled; no live odds are configured.');
    throw new OddsApiError('ODDS_API_KEY is missing. Configure the existing private key in the app environment and restart the app. No live data or substitute picks were generated.', 401);
  }
  const db=getDb(), cooldownKey=`odds:cooldown:${credentialFingerprint(key)}`;
  const cooldown=db.prepare('SELECT value FROM cache WHERE key=?').get(cooldownKey) as {value:string}|undefined;
  if(cooldown) {
    const saved=JSON.parse(cooldown.value) as {until:number;status:number;code?:string};
    if(saved.until>now) {
      const error=new OddsApiError(`Odds API requests paused until ${new Date(saved.until).toISOString()} after HTTP ${saved.status}${saved.code ? ` (${saved.code})` : ''}. Check provider credentials/credits before retrying.`,saved.status);
      error.code=saved.code;error.retryAfterMs=saved.until-now;throw error;
    }
  }
  const remember=(error:OddsApiError)=> {
    if([401,403,429].includes(error.status)) db.prepare('INSERT OR REPLACE INTO cache (key,value,fetched_at) VALUES (?,?,?)').run(cooldownKey,JSON.stringify({until:now+(error.retryAfterMs??60_000),status:error.status,code:error.code}),now);
  };
  let schedule;
  try {schedule=await fetchEvents(key);} catch(error) {if(error instanceof OddsApiError) remember(error);throw error;}
  const selected = selectSchedule(schedule.events, undefined, now);
  const ttl = Number(process.env.ODDS_CACHE_MIN ?? 30) * 60000, cacheKey = `${liveCacheKey(key)}:${MODEL_VERSION}`;
  if (!force) {
    const row = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(cacheKey) as { value: string; fetched_at: number } | undefined;
    if (row && now - row.fetched_at < ttl && canReuseLiveCache(JSON.parse(row.value) as LoadResult, selected.events, now)) {
      const r = JSON.parse(row.value) as LoadResult, cachedGames = new Map(r.games.map((game) => [game.id, game]));
      r.games = selected.events.map((event) => {
        const cached = cachedGames.get(event.id);
        return cached
          ? {
            ...cached,
            label: `${TEAM_ABBR[event.away_team] ?? event.away_team} @ ${TEAM_ABBR[event.home_team] ?? event.home_team}`,
            kickoff: event.commence_time,
            returnedMarketKeys: cached.returnedMarketKeys ?? cached.markets,
            unsupportedMarketKeys: cached.unsupportedMarketKeys ?? [],
          }
          : { id: event.id, label: `${TEAM_ABBR[event.away_team] ?? event.away_team} @ ${TEAM_ABBR[event.home_team] ?? event.home_team}`, kickoff: event.commence_time, status: 'not-scanned', markets: [], returnedMarketKeys: [], unsupportedMarketKeys: [], props: 0 };
      });
      r.availableDates = selected.availableDates;
      r.selectedDate = selected.selectedDate;
      r.diagnostics.oddsApiCreditsRemaining = schedule.remaining ?? r.diagnostics.oddsApiCreditsRemaining ?? 'unknown';
      const eventIds = new Set(selected.events.map((event) => event.id));
      r.candidates = r.candidates.filter((candidate) => eventIds.has(candidate.gameId));
      const needsHistoryRefresh = r.notes.some((note) =>
        /Historical player statistics unavailable|No real historical player statistics|Injury data unavailable/.test(note),
      );
      if (needsHistoryRefresh) {
        const providerFetch = cachedProviderFetch(db);
        const season = currentSeason(new Date(now));
        const stats = await loadStatsHistory(season, providerFetch);
        let injuries: Map<string, string> | null = null;
        let injuryError: string | undefined;
        try {
          injuries = (await loadCurrentInjuries(season, providerFetch)).statuses;
        } catch (error) {
          injuryError = error instanceof Error ? error.message : String(error);
        }
        if (stats.games.length) r.candidates = refreshCandidateHistory(r.candidates, stats.games, injuries, season, now);
        r.notes = r.notes.filter((note) =>
          !/Historical player statistics unavailable|No real historical player statistics|Injury data unavailable/.test(note),
        );
        if (stats.unavailable.length) {
          r.notes.push(`Historical player statistics unavailable for season${stats.unavailable.length === 1 ? '' : 's'} ${stats.unavailable.map((item) => `${item.season} (${item.error})`).join('; ')}.`);
        }
        if (!stats.games.length) r.notes.push('No real historical player statistics were available; no player projections or tickets will be fabricated.');
        if (injuryError) r.notes.push(`Injury data unavailable (${injuryError}). Injury status is unknown, not "healthy".`);
        r.diagnostics.historyGames = stats.games.length;
        r.diagnostics.historySeasons = [...new Set(stats.games.map((game) => game.season))].sort().join(', ') || 'none';
        r.candidates = scoreAll(r.candidates, now);
        db.prepare('UPDATE cache SET value = ? WHERE key = ?').run(JSON.stringify(r), cacheKey);
      }
      r.candidates = scoreAll(r.candidates, now);
      await captureForecasts(db, r.candidates, cachedProviderFetch(db));
      return r;
    }
  }
  const r = await loadLive({ key, date: 'ALL' }, now, cachedProviderFetch(db), schedule);
  const failure=r.games.find(g=>g.status==='error' && g.providerHttpStatus && [401,403,429].includes(g.providerHttpStatus));
  if(failure) {const error=new OddsApiError('Event player-prop request failed',failure.providerHttpStatus!);error.code=failure.providerErrorCode;error.retryAfterMs=failure.providerRetryAfterMs;remember(error);}
  if(!r.games.some(g=>g.status==='error'))db.prepare('DELETE FROM cache WHERE key=?').run(cooldownKey);
  if(!r.games.some(g=>g.status==='error')) db.prepare('INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify(r), now);
  await captureForecasts(db, r.candidates, cachedProviderFetch(db));
  return r;
}
