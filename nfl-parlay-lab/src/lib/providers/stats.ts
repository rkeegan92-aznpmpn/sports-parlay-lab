import {propDefinition,contractHit,contractPush,PERIOD_QUARTERS} from '../propMarkets.ts';
// Player stats and injuries from nflverse (open data, no key): https://github.com/nflverse/nflverse-data
import { gunzipSync } from 'node:zlib';
import type { HistoryWindow, PlayerHistory } from '../types.ts';
import { baseMarket } from '../model.ts';
export interface StatGame { nonParticipationVerified?: boolean; participationConflict?:boolean; kickoffTs?: number; completed?: boolean; name: string; pos: string; team: string; opp: string; season: number; week: number; gameId: string; playerId?: string; location?: 'home' | 'away'; gameDate?: string; invalidGameDate?: boolean; availableMarkets?: string[]; snapCount?: number; v: Record<string, number> }
export interface FirstQuarterPlayerGame {
  playerId: string;
  gameId: string;
  market: string;
  value: number;
  opportunities: number;
  season: number;
  week: number;
  position: string;
  team: string;
  opponent: string;
}
export interface FirstQuarterTeamGame { gameId: string; team: string; opponent: string; points: number; season: number; week: number }
export interface FirstQuarterGameTotal { gameId: string; points: number; season: number; week: number }
const NUM = ['passing_yards', 'passing_tds', 'completions', 'interceptions', 'attempts', 'carries', 'rushing_yards', 'receptions', 'targets', 'receiving_yards', 'rushing_tds', 'receiving_tds', 'special_teams_tds'];

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let field = '', row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; rows.push(row); row = []; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [h, ...b] = rows;
  return b.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, j) => [k, r[j] ?? ''])));
}
/** Parses selected columns without retaining every play-by-play field and row in memory. */
export function parseCsvColumns(text: string, columns: readonly string[]): Record<string, string>[] {
  const wanted = new Set(columns), output: Record<string, string>[] = [];
  let headers: string[] | undefined, headerFields: string[] = [], row: Record<string, string> = {};
  let field = '', quoted = false, column = 0, fieldCount = 0;
  const finishField = () => {
    if (!headers) headerFields.push(field);
    else if (wanted.has(headers[column])) row[headers[column]] = field;
    field = '';
    column++;
    fieldCount++;
  };
  const finishRow = () => {
    finishField();
    if (!headers) {
      headers = headerFields;
      headerFields = [];
    } else if (fieldCount > 1 && Object.keys(row).length) {
      output.push(row);
    }
    row = {};
    column = 0;
    fieldCount = 0;
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') finishField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else field += character;
  }
  if (field || fieldCount) finishRow();
  return output;
}
export const normName = (n: string) => n.toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
export function toGames(recs: Record<string, string>[]): StatGame[] {
  return recs.filter((r) => !r.season_type || r.season_type === 'REG').map((r) => {
    const canonical = (value: string) => ({ LAR: 'LA', JAC: 'JAX', WSH: 'WAS' } as Record<string, string>)[value] ?? value;
    const team = canonical(r.team || r.recent_team), sides = r.game_id?.split('_').slice(-2).map(canonical);
    const statPresent = (key: string) => Object.hasOwn(r, key) && r[key] !== '' && Number.isFinite(Number(r[key]));
    const availableMarkets = [
      statPresent('passing_yards') && 'player_pass_yds',
      statPresent('passing_yards')&&statPresent('rushing_yards')&&'player_pass_rush_yds',
      statPresent('passing_tds') && 'player_pass_tds',
      statPresent('completions') && 'player_pass_completions',
      statPresent('interceptions') && 'player_pass_interceptions',
      (statPresent('passing_attempts')||statPresent('attempts')) && 'player_pass_attempts',
      statPresent('rushing_tds') && 'player_rush_tds',
      statPresent('receiving_tds') && 'player_receiving_tds',
      statPresent('rushing_yards') && 'player_rush_yds',
      (statPresent('rushing_attempts') || statPresent('carries')) && 'player_rush_attempts',
      statPresent('receiving_yards') && 'player_reception_yds',
      statPresent('receptions') && 'player_receptions',
      statPresent('rushing_tds') && statPresent('receiving_tds') && statPresent('special_teams_tds') && 'player_anytime_td',
    ].filter((market): market is string => typeof market === 'string');
    const rawDate = r.game_date || r.gameday || r.gameDate;
    const invalidGameDate = Boolean(rawDate && !Number.isFinite(Date.parse(rawDate)));
    const gameDate = rawDate && !invalidGameDate ? new Date(rawDate).toISOString() : undefined;
    return {
      name: r.player_display_name || r.player_name, pos: r.position, team, opp: canonical(r.opponent_team),
      season: Number(r.season), week: Number(r.week), gameId: r.game_id || '',
      playerId: r.gsis_id || r.player_id || undefined,
      snapCount: Object.hasOwn(r, 'offense_snaps') && Number.isFinite(Number(r.offense_snaps)) && r.offense_snaps !== ''
        ? Number(r.offense_snaps)
        : undefined,
      gameDate,
      invalidGameDate,
      availableMarkets,
      location: sides?.[1] === team ? 'home' as const : sides?.[0] === team ? 'away' as const : undefined,
      v: Object.fromEntries(NUM.map((k) => {
        const source = k === 'carries' ? r.rushing_attempts ?? r.carries
          : k === 'attempts' ? r.passing_attempts ?? r.attempts : r[k];
        const value = Number(source);
        return [k, Number.isFinite(value) ? value : 0];
      })),
    };
  }).filter((g) => g.name && g.team && Number.isFinite(g.week));
}
/** Aggregates only qtr=1 regular-season play-by-play rows; no weekly/full-game totals are used. */
export function toFirstQuarterStats(records: Record<string, string>[], playerStats: StatGame[] = []) {
  const players = new Map<string, FirstQuarterPlayerGame>();
  const games = new Map<string, { home: string; away: string; homePoints: number; awayPoints: number; season: number; week: number }>();
  const rowsByGame=new Map<string,Record<string,string>[]>();
  for(const row of records)if(row.season_type==='REG'&&Number(row.qtr)===1&&row.game_id){const rows=rowsByGame.get(row.game_id)??[];rows.push(row);rowsByGame.set(row.game_id,rows);}
  const firstQuarterGames = new Set(rowsByGame.keys());
  for (const player of playerStats) {
    if (!player.playerId || !firstQuarterGames.has(player.gameId)) continue;
    const markets = player.pos === 'QB' ? ['player_pass_yds_q1', 'player_rush_yds_q1']
      : player.pos === 'RB' ? ['player_rush_yds_q1', 'player_reception_yds_q1']
        : player.pos === 'WR' || player.pos === 'TE' ? ['player_reception_yds_q1']
          : [];
    const required:Record<string,string>={player_pass_attempts_q1:'pass_attempt',player_pass_completions_q1:'complete_pass',player_pass_interceptions_q1:'interception',player_pass_tds_q1:'pass_touchdown',player_rush_attempts_q1:'rush_attempt',player_rush_tds_q1:'rush_touchdown',player_receptions_q1:'complete_pass',player_receiving_tds_q1:'pass_touchdown'};
    for(const [market,flag] of Object.entries(required)){
     const definition=propDefinition(market.replace(/_q1$/,''));
     const rows=rowsByGame.get(player.gameId)??[];
     const idField=market.startsWith('player_pass_')?'passer_player_id':market.startsWith('player_rush_')?'rusher_player_id':'receiver_player_id';
     if(definition?.positions.includes(player.pos as import('../types.ts').Pos)&&rows.length&&rows.every(r=>(r[flag]==='0'||r[flag]==='1')&&(r[flag]!=='1'||!!r[idField])))markets.push(market);
    }
    const ownRows=rowsByGame.get(player.gameId)??[];
    if(player.pos==='QB'&&ownRows.length&&ownRows.every(r=>(r.complete_pass==='0'||r.complete_pass==='1')&&(r.rush_attempt==='0'||r.rush_attempt==='1')&&(r.complete_pass!=='1'||!!r.passer_player_id)&&(r.rush_attempt!=='1'||!!r.rusher_player_id)&&((r.complete_pass!=='1'&&r.rush_attempt!=='1')||(r.yards_gained!==''&&Number.isFinite(Number(r.yards_gained))))))markets.push('player_pass_rush_yds_q1');
    for (const market of markets) {
      const key = `${player.playerId}|${player.gameId}|${market}`;
      players.set(key, {
        playerId: player.playerId,
        gameId: player.gameId,
        market: market as FirstQuarterPlayerGame['market'],
        value: 0,
        opportunities: 0,
        season: player.season,
        week: player.week,
        position: player.pos,
        team: player.team,
        opponent: player.opp,
      });
    }
  }
  const increment = (playerId: string, gameId: string, market: FirstQuarterPlayerGame['market'], value = 0, opportunity = 0) => {
    if (!playerId || !Number.isFinite(value) || !Number.isFinite(opportunity)) return;
    const key = `${playerId}|${gameId}|${market}`;
    const player = players.get(key);
    if (player) {
      player.value += value;
      player.opportunities += opportunity;
    }
  };
  for (const row of records) {
    if (row.season_type !== 'REG' || Number(row.qtr) !== 1 || !row.game_id) continue;
    const gained = Number(row.yards_gained);
    if (row.pass_attempt === '1') {
      increment(row.passer_player_id, row.game_id, 'player_pass_yds_q1', 0, 1);
      increment(row.receiver_player_id, row.game_id, 'player_reception_yds_q1', 0, 1);
    }
    if (row.complete_pass === '1') {
      increment(row.passer_player_id, row.game_id, 'player_pass_yds_q1', gained);
      increment(row.receiver_player_id, row.game_id, 'player_reception_yds_q1', gained);
    }
    if (row.rush_attempt === '1') {
      increment(row.rusher_player_id, row.game_id, 'player_rush_yds_q1', gained, 1);
    }
    if(row.no_play!=='1'){
     if(row.complete_pass==='1')increment(row.passer_player_id,row.game_id,'player_pass_rush_yds_q1',gained);
     if(row.rush_attempt==='1')increment(row.rusher_player_id,row.game_id,'player_pass_rush_yds_q1',gained);
     if(row.pass_attempt==='1')increment(row.passer_player_id,row.game_id,'player_pass_attempts_q1',1,1);
     if(row.rush_attempt==='1')increment(row.rusher_player_id,row.game_id,'player_rush_attempts_q1',1,1);
     if(row.complete_pass==='1'){increment(row.passer_player_id,row.game_id,'player_pass_completions_q1',1,1);increment(row.receiver_player_id,row.game_id,'player_receptions_q1',1,1);}
     if(row.interception==='1')increment(row.passer_player_id,row.game_id,'player_pass_interceptions_q1',1,1);
     if(row.pass_touchdown==='1'){increment(row.passer_player_id,row.game_id,'player_pass_tds_q1',1,1);increment(row.receiver_player_id,row.game_id,'player_receiving_tds_q1',1,1);}
     if(row.rush_touchdown==='1')increment(row.rusher_player_id,row.game_id,'player_rush_tds_q1',1,1);
    }
    const existing = games.get(row.game_id) ?? {
      home: row.home_team,
      away: row.away_team,
      homePoints: 0,
      awayPoints: 0,
      season: Number(row.season),
      week: Number(row.week),
    };
    const homeScore = Number(row.total_home_score), awayScore = Number(row.total_away_score);
    if (Number.isFinite(homeScore)) existing.homePoints = Math.max(existing.homePoints, homeScore);
    if (Number.isFinite(awayScore)) existing.awayPoints = Math.max(existing.awayPoints, awayScore);
    games.set(row.game_id, existing);
  }
  const playerGames = [...players.values()];
  const teamGames: FirstQuarterTeamGame[] = [];
  const gameTotals: FirstQuarterGameTotal[] = [];
  for (const [gameId, score] of games) {
    if (!score.home || !score.away) continue;
    teamGames.push(
      { gameId, team: score.home, opponent: score.away, points: score.homePoints, season: score.season, week: score.week },
      { gameId, team: score.away, opponent: score.home, points: score.awayPoints, season: score.season, week: score.week },
    );
    gameTotals.push({ gameId, points: score.homePoints + score.awayPoints, season: score.season, week: score.week });
  }
  return { playerGames, teamGames, gameTotals };
}
export function statOf(g: StatGame, market: string): number {
  switch (baseMarket(market)) {
    case 'player_pass_rush_yds': return g.v.passing_yards+g.v.rushing_yards;
    case 'player_pass_yds': return g.v.passing_yards;
    case 'player_pass_tds': return g.v.passing_tds;
    case 'player_rush_yds': return g.v.rushing_yards;
    case 'player_rush_attempts': return g.v.carries;
    case 'player_reception_yds': return g.v.receiving_yards;
    case 'player_receptions': return g.v.receptions;
    case 'player_anytime_td': return g.v.rushing_tds + g.v.receiving_tds + g.v.special_teams_tds;
    default: {const definition=propDefinition(market);if(definition)return g.v[definition.column];throw new Error(`Unsupported market ${market}`);}
  }
}
export function supportsStatMarket(game: StatGame, market: string): boolean {
  return !game.availableMarkets || game.availableMarkets.includes(baseMarket(market));
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const ordered = (games: StatGame[], market?: string) => [...new Map(games
  .filter((g) => !market || supportsStatMarket(g, market))
  .filter((g) => g.gameId)
  .sort((a, b) => (a.gameDate && b.gameDate
    ? Date.parse(a.gameDate) - Date.parse(b.gameDate)
    : a.season - b.season || a.week - b.week))
  .map((g) => [g.gameId, g])).values()];
const median = (a: number[]) => {
  const sorted = [...a].sort((x, y) => x - y), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const marketHit = (value: number, market: string, side: string, line: number | null) =>
  baseMarket(market) === 'player_anytime_td' || side === 'Yes'
    ? value > 0
    : contractHit(value,side,line);

function historyWindow(games: StatGame[], market: string, side: string, line: number | null): HistoryWindow | null {
  if (!games.length) return null;
  const values = games.map((g) => statOf(g, market)), mean = avg(values);
  const sd = Math.sqrt(avg(values.map((x) => (x - mean) ** 2)));
  const decisions = values.filter((v) => baseMarket(market) === 'player_anytime_td' || side === 'Yes' || side==='AtLeast' || v !== line);
  const hits = decisions.filter((v) => marketHit(v, market, side, line)).length;
  return {
    games: values.length,
    average: mean,
    median: median(values),
    consistency: mean === 0 ? null : sd / Math.abs(mean),
    hits: decisions.length ? hits : null,
    hitRate: decisions.length ? hits / decisions.length : null,
    hitGames: decisions.length,
    results: games.map((game, index) => ({
      date: game.gameDate,
      season: game.season,
      week: game.week,
      team: game.team,
      opponent: game.opp,
      value: values[index],
      gameId: game.gameId,
      playerId: game.playerId ?? '',
    })),
  };
}
export function playerHistory(games: StatGame[], market: string, side: string, line: number | null): PlayerHistory {
  const played = ordered(games, market), last5 = played.slice(-5), last10 = played.slice(-10);
  const five = historyWindow(last5, market, side, line), ten = historyWindow(last10, market, side, line);
  const home = last10.filter((g) => g.location === 'home');
  const away = last10.filter((g) => g.location === 'away');
  const recentUsage = last10.map((g) => g.pos === 'QB' ? g.v.attempts + g.v.carries : g.v.targets + g.v.carries);
  const recentFive = played.slice(-5);
  const snapGames = recentFive.filter((game) => Number.isFinite(game.snapCount));
  return {
    last5: five,
    last10: ten,
    trend: five && played.length >= 10 && ten ? five.average - ten.average : null,
    homeAverage: home.length ? avg(home.map((g) => statOf(g, market))) : null,
    awayAverage: away.length ? avg(away.map((g) => statOf(g, market))) : null,
    opportunityAverage: recentUsage.length ? avg(recentUsage.slice(-5)) : null,
    roleGames: recentFive.filter((game) => {
      const opportunities = game.pos === 'QB' ? game.v.attempts + game.v.carries : game.v.targets + game.v.carries;
      return opportunities > 0;
    }).length,
    snapAverage: snapGames.length ? avg(snapGames.map((game) => game.snapCount!)) : null,
    snapCounts: snapGames.length ? snapGames.map((game) => game.snapCount!) : null,
    defense: null,
    playingTime: snapGames.length ? 'nflverse' : 'unavailable',
  };
}

/** Weighted blend of last-3/5/10 means times an opponent factor. Returns null when no games exist. */
export function project(games: StatGame[], market: string, oppFactor = 1) {
  const v = ordered(games, market).map((g) => statOf(g, market)).slice(-10);
  if (!v.length) return null;
  const last = (n: number) => avg(v.slice(-n));
  const mean = (0.3 * last(3) + 0.3 * last(5) + 0.4 * last(10)) * oppFactor;
  const w = v.slice(-10), m = avg(w), sd = Math.sqrt(avg(w.map((x) => (x - m) ** 2)));
  return { mean, sd: Math.max(sd, 0.2 * mean, 0.5), sample: v.length };
}
/** Current-season positional production allowed, ranked only with at least four completed games. */
export function defenseMatchup(all: StatGame[], season: number, opp: string, pos: string, market: string, asOf?: number) {
  const teams = new Map<string, Map<string, number>>();
  for (const g of all.filter((x) =>
    x.season === season && x.pos === pos && supportsStatMarket(x, market) &&
    (asOf == null || Boolean(x.gameDate) && Date.parse(x.gameDate!) < asOf),
  )) {
    if (!g.opp || !g.gameId) continue;
    const byGame = teams.get(g.opp) ?? new Map<string, number>();
    byGame.set(g.gameId, (byGame.get(g.gameId) ?? 0) + statOf(g, market));
    teams.set(g.opp, byGame);
  }
  const qualified = [...teams].flatMap(([team, byGame]) => byGame.size >= 4
    ? [{ team, games: byGame.size, average: avg([...byGame.values()]) }]
    : []);
  const opponent = qualified.find((team) => team.team === opp);
  if (!opponent) return null;
  const ranked = [...qualified].sort((a, b) => a.average - b.average);
  return { rank: ranked.findIndex((team) => team.team === opp) + 1, teams: ranked.length, games: opponent.games, averageAllowed: opponent.average };
}
/** Opponent defense vs position: avg stat allowed relative to league average, shrunk 50% and clamped to 0.85-1.15. */
export function oppFactor(all: StatGame[], opp: string, pos: string, market: string, season?: number, asOf?: number): number {
  const per = new Map<string, number>();
  for (const g of all.filter((x) =>
    x.pos === pos && supportsStatMarket(x, market) && (season == null || x.season === season) &&
    (asOf == null || Boolean(x.gameDate) && Date.parse(x.gameDate!) < asOf),
  )) {
    const k = g.gameId || `${g.season}|${g.week}|${g.opp}`;
    per.set(`${g.opp}|${k}`, (per.get(`${g.opp}|${k}`) ?? 0) + statOf(g, market));
  }
  const byOpp = new Map<string, number[]>();
  for (const [k, v] of per) { const o = k.split('|')[0]; byOpp.set(o, [...(byOpp.get(o) ?? []), v]); }
  const league = avg([...per.values()]), mine = byOpp.get(opp);
  if (!mine || season != null && mine.length < 4 || !league) return 1;
  return Math.min(1.15, Math.max(0.85, 1 + 0.5 * (avg(mine) / league - 1)));
}
export async function fetchText(url: string, f: typeof fetch = fetch, timeoutMs = 20_000): Promise<string> {
  const download = async (target: string, headers?: HeadersInit): Promise<Response> => {
    let lastError: Error = new Error(`Unable to download ${target}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let retryable = true;
      try {
        const response = await Promise.race([
          f(target, { redirect: 'follow', headers, signal: controller.signal }),
          new Promise<Response>((_, reject) => {
            timeout = setTimeout(() => {
              reject(new Error(`Timed out downloading ${target} after ${timeoutMs} milliseconds`));
              controller.abort();
            }, timeoutMs);
          }),
        ]);
        if (response.ok) return response;
        lastError = new Error(`HTTP ${response.status} for ${target}`);
        retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
        if (!retryable) throw lastError;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!retryable || attempt === 2) throw lastError;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
    throw lastError;
  };
  const csvText = async (response: Response) => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes).toString('utf8')
      : new TextDecoder().decode(bytes);
    if (!text.trim() || text.startsWith('<') || !text.split(/\r?\n/, 1)[0].includes(',')) {
      throw new Error('Invalid CSV response from nflverse.');
    }
    return text;
  };

  const release = /^https:\/\/github\.com\/nflverse\/nflverse-data\/releases\/download\/([^/]+)\/([^/]+\.csv)$/.exec(url);
  const failures: string[] = [];
  if (release) {
    const [, tag, filename] = release;
    try {
      const manifestUrl = `https://api.github.com/repos/nflverse/nflverse-data/releases/tags/${tag}`;
      const manifestResponse = await download(manifestUrl, {
        Accept: 'application/vnd.github+json',
        'x-nflverse-cache-name': `manifest:${tag}`,
      });
      const manifest = await manifestResponse.json() as { assets?: { name?: string; url?: string }[] };
      const asset = manifest.assets?.find((item) => item.name === `${filename}.gz` && item.url);
      if (asset?.url) {
        const response = await download(asset.url, {
          Accept: 'application/octet-stream',
          'x-nflverse-cache-name': `asset:${filename}.gz`,
        });
        return csvText(response);
      }
      failures.push(`No compressed ${filename} release asset`);
    } catch (error) {
      failures.push(`GitHub release asset API: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const fallbacks = [url.replace(/\.csv$/, '.csv.gz'), url];
  for (const fallback of fallbacks) {
    try { return await csvText(await download(fallback)); }
    catch (error) { failures.push(`${fallback}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(`Unable to download nflverse CSV. ${failures.join('; ')}`);
}
export const statsUrl = (season: number) => (process.env.NFL_STATS_URL ?? 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv').replace('{season}', String(season));
export const injuriesUrl = (season: number) => (process.env.NFL_INJURIES_URL ?? 'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv').replace('{season}', String(season));
export const playByPlayUrl = (season: number) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;
const FIRST_QUARTER_COLUMNS = [
  'season', 'week', 'season_type', 'qtr', 'game_id', 'yards_gained', 'interception','pass_touchdown','rush_touchdown','no_play','complete_pass', 'pass_attempt',
  'passer_player_id', 'receiver_player_id', 'rush_attempt', 'rusher_player_id',
  'home_team', 'away_team', 'total_home_score', 'total_away_score',
];
export function attachSchedule(games: StatGame[], schedule: Record<string, string>[]): StatGame[] {
  const team = (value: string) => ({ LAR: 'LA', JAC: 'JAX', WSH: 'WAS' } as Record<string, string>)[value] ?? value;
  const key = (season: number, week: number, a: string, b: string) => `${season}|${week}|${[team(a), team(b)].sort().join('|')}`;
  const index = new Map<string, Record<string, string>[]>();
  for (const row of schedule) {
    if (row.game_type !== 'REG' || !row.game_id || !row.gameday || !Number.isFinite(Date.parse(row.gameday))) continue;
    const id = key(Number(row.season), Number(row.week), row.home_team, row.away_team);
    index.set(id, [...(index.get(id) ?? []), row]);
  }
  return games.map((game) => {
    if (game.invalidGameDate || (game.gameId && game.gameDate)) return game;
    const matches = index.get(key(game.season, game.week, game.team, game.opp)) ?? [];
    if (matches.length !== 1) return game;
    const match = matches[0];
    if (game.gameId && game.gameId !== match.game_id) return game;
    if (game.gameDate && game.gameDate.slice(0, 10) !== match.gameday) return game;
    return { ...game, gameId: match.game_id, gameDate: new Date(match.gameday).toISOString(),
      location: team(game.team) === team(match.home_team) ? 'home' as const : 'away' as const };
  });
}
export async function loadStats(season: number, f: typeof fetch = fetch) {
  const games = toGames(parseCsv(await fetchText(statsUrl(season), f)));
  if (!games.some((game) => !game.gameId || !game.gameDate)) return games;
  return attachSchedule(games, await loadSchedule(f));
}
export async function loadSchedule(f: typeof fetch = fetch) {
  const url = process.env.NFL_SCHEDULE_URL ?? 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
  const scheduleFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('x-provider-cache-name', 'nflverse:game-schedule');
    return f(input, { ...init, headers });
  };
  return parseCsv(await fetchText(url, scheduleFetch));
}
interface ScheduleSelection { season: number; team?: string; opp: string; kickoffTs: number; resultGameId?: string; espnEventId?: string }
export function resolveScheduledGame(schedule: Record<string,string>[], s: ScheduleSelection): { match?: Record<string,string>; reason: string } {
  const canonical = (team: string) => ({ LAR:'LA',JAC:'JAX',WSH:'WAS' } as Record<string,string>)[team] ?? team;
  const rows = schedule.filter((row)=>row.game_type==='REG' && Number(row.season)===s.season && row.game_id &&
    [canonical(row.home_team),canonical(row.away_team)].includes(canonical(s.team ?? '')) &&
    [canonical(row.home_team),canonical(row.away_team)].includes(canonical(s.opp)) && canonical(s.team ?? '')!==canonical(s.opp));
  // Normalize a misplaced identifier only when an authoritative unique row proves its namespace.
  const result = s.resultGameId?.trim() ?? '', espn = s.espnEventId?.trim() ?? '';
  const resultRows = result ? rows.filter((row)=>row.game_id===result || /^\d+$/.test(result) && row.espn===result) : [];
  const espnRows = espn ? rows.filter((row)=>row.espn===espn || /^\d{4}_\d{1,2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(espn) && row.game_id===espn) : [];
  if (resultRows.length>1 || espnRows.length>1) return {reason:'ambiguous-game-identity'};
  if (resultRows.length===1 && espnRows.length===1 && resultRows[0].game_id!==espnRows[0].game_id) return {reason:'conflicting-event-identities'};
  if (espnRows.length===1) {
    // A stable ESPN ID may follow a postponed game's changed NFL ID, but cannot overwrite another existing game's ID.
    if (result && !resultRows.length && schedule.some((row)=>row.game_id===result || row.espn===result)) return {reason:'conflicting-event-identities'};
    return {match:espnRows[0],reason:result && result!==espnRows[0].game_id || espn && espn!==espnRows[0].espn ? 'verified-event-id-repair' : 'verified-stable-espn-event'};
  }
  if (resultRows.length===1) {
    if (espn && resultRows[0].espn && resultRows[0].espn!==espn) return {reason:'conflicting-event-identities'};
    return {match:resultRows[0],reason:result!==resultRows[0].game_id ? 'verified-event-id-repair' : 'verified-nfl-event'};
  }
  if (result || espn) return {reason:'stored-event-not-found'}; // Never replace a known ID with a different game based only on dates.
  const byDate=rows.filter((row)=>Number.isFinite(Date.parse(row.gameday)) && Math.abs(Date.parse(row.gameday)-s.kickoffTs)<=36*3600_000);
  return byDate.length===1 ? {match:byDate[0],reason:'verified-legacy-date-match'} : {reason:byDate.length ? 'ambiguous-game-identity' : 'missing-game-identity'};
}
export function matchScheduledGame(schedule: Record<string,string>[], s: ScheduleSelection) { return resolveScheduledGame(schedule,s).match; }
/** nflverse gametime is Eastern local time. Verify the conversion and reject DST ambiguities. */
export function scheduledKickoff(row: Record<string,string>): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.gameday??'') || !/^\d{2}:\d{2}(?::\d{2})?$/.test(row.gametime??'')) return undefined;
  const nominal=Date.parse(`${row.gameday}T${row.gametime.length===5?row.gametime+':00':row.gametime}Z`);
  if (!Number.isFinite(nominal)) return undefined;
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const local=(time:number)=>Object.fromEntries(formatter.formatToParts(time).filter((part)=>part.type!=='literal').map((part)=>[part.type,part.value]));
  const parts=local(nominal), offset=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))-nominal;
  const actual=nominal-offset;
  const expected=`${row.gameday} ${row.gametime.slice(0,5)}`;
  const text=(time:number)=>{const p=local(time);return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;};
  if(text(actual)!==expected || text(actual-3600_000)===expected || text(actual+3600_000)===expected)return undefined;
  return actual;
}
export async function loadFinalStats(season: number, schedule: Record<string, string>[], f: typeof fetch = fetch) {
  const games = await loadStats(season, f);
  const index = new Map<string, Record<string,string> | null>();
  for (const row of schedule) if (row.game_type === 'REG' && Number(row.season) === season && row.game_id) index.set(row.game_id, index.has(row.game_id) ? null : row);
  const kickoffs = new Map([...index].map(([id,row])=>[id,row ? scheduledKickoff(row) : undefined]));
  return games.map((game) => {
    const row = index.get(game.gameId);
    const completed = Boolean(row && row.home_score !== undefined && row.away_score !== undefined &&
      row.home_score.trim() !== '' && row.away_score.trim() !== '' && Number.isFinite(Number(row.home_score)) && Number.isFinite(Number(row.away_score)));
    return { ...game, completed, kickoffTs: kickoffs.get(game.gameId), gameDate: row?.gameday && Number.isFinite(Date.parse(row.gameday)) ? new Date(row.gameday).toISOString() : game.gameDate };
  });
}

export async function loadStatsHistory(season: number, f: typeof fetch = fetch) {
  const games: StatGame[] = [], unavailable: { season: number; error: string }[] = [];
  for (let year = season; year >= season - 1; year--) {
    try { games.push(...await loadStats(year, f)); }
    catch (error) { unavailable.push({ season: year, error: error instanceof Error ? error.message : 'Unknown provider error' }); }
  }
  return { games, unavailable };
}
export async function loadFirstQuarterHistory(season: number, f: typeof fetch = fetch, playerStats: StatGame[] = [],period='q1') {
  const playerGames: FirstQuarterPlayerGame[] = [], teamGames: FirstQuarterTeamGame[] = [], gameTotals: FirstQuarterGameTotal[] = [];
  const unavailable: { season: number; error: string }[] = [];
  for (let year = season; year >= season - 1; year--) {
    try {
      const quarter = toFirstQuarterStats(
        parseCsvColumns(await fetchText(playByPlayUrl(year), f), FIRST_QUARTER_COLUMNS).filter(r=>(PERIOD_QUARTERS[period]??[]).includes(Number(r.qtr))).map(r=>({...r,qtr:'1'})),
        playerStats.filter((game) => game.season === year),
      );
      playerGames.push(...quarter.playerGames.map(g=>({...g,market:g.market.replace(/_q1$/,'_'+period)})));
      // Only Q1 cumulative scoreboard values are valid period totals. Never reuse them for another period.
      if(period==='q1'){teamGames.push(...quarter.teamGames);gameTotals.push(...quarter.gameTotals);}
    } catch (error) {
      unavailable.push({ season: year, error: error instanceof Error ? error.message : 'Unknown provider error' });
    }
  }
  return { playerGames, teamGames, gameTotals, unavailable };
}
/** Only the latest available reporting week for each team; absence is unknown, never proof of health. */
export async function loadInjuryReport(season: number, f: typeof fetch = fetch) {
  const out = new Map<string, { w: number; s: string }>();
  const reports = parseCsv(await fetchText(injuriesUrl(season), f));
  const canonical = (team: string) => ({ LAR: 'LA', JAC: 'JAX', WSH: 'WAS' } as Record<string, string>)[team.toUpperCase()] ?? team.toUpperCase();
  const latestWeek = new Map<string, number>();
  for (const report of reports) {
    const team = canonical(report.team || report.team_abbr || ''), week = Number(report.week);
    if (team && Number.isInteger(week) && week >= 1 && week <= 18) latestWeek.set(team, Math.max(latestWeek.get(team) ?? 0, week));
  }
  for (const r of reports) {
    const n = normName(r.full_name || '');
    const rawTeam = (r.team || r.team_abbr || '').toUpperCase();
    const team = ({ LAR: 'LA', JAC: 'JAX', WSH: 'WAS' } as Record<string, string>)[rawTeam] ?? rawTeam;
    const w = Number(r.week), s = r.report_status;
    if (!n || !team || w !== latestWeek.get(team)) continue;
    const key = `${team.toUpperCase()}|${n}`;
    const cur = out.get(key); if (!cur || w >= cur.w) out.set(key, { w, s: s || '' });
  }
  const dates=reports.map(r=>r.report_date || r.date_modified || r.date || '').filter(d=>d && Number.isFinite(Date.parse(d))).sort((a,b)=>Date.parse(b)-Date.parse(a));
  return {statuses:new Map([...out].map(([k,v])=>[k,v.s])),latestWeekByTeam:Object.fromEntries(latestWeek),latestReportDate:dates[0]??null};
}
export async function loadInjuries(season:number,f:typeof fetch=fetch):Promise<Map<string,string>> {
  return (await loadInjuryReport(season,f)).statuses;
}

/** Current, dated ESPN injury listing supplements historical reports; absence never clears a designation. */
export async function loadCurrentInjuries(season:number,f:typeof fetch=fetch,now=Date.now()) {
  let legacy:Awaited<ReturnType<typeof loadInjuryReport>>|undefined;
  try {legacy=await loadInjuryReport(season,f);} catch { /* The independent free feed may still be available. */ }
  const statuses=new Map(legacy?.statuses??[]);
  let snapshotAt:string|null=null,teams=0,espnEntries=0;
  let coveredTeams:string[]=[];
  try {
    const response=await f('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',{signal:AbortSignal.timeout(15000),headers:{'x-provider-cache-name':`espn:injuries:${season}`}});
    if(!response.ok)throw new Error('Injury source unavailable');
    const data=await response.json(),snapshot=Date.parse(data.timestamp);
    if(Number(data.season?.year)!==season||Number(data.season?.type)!==2||!Array.isArray(data.injuries)||!(now-snapshot>=-5*60000&&now-snapshot<=24*3600_000))throw new Error('Unverified injury snapshot');
    const known=new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
    const reports=new Map<string,{date:number;status:string}>();
    const covered=new Set<string>();
    for(const group of data.injuries) {
      if(!Array.isArray(group.injuries))continue;
      for(const record of group.injuries) {
        const athlete=record.athlete,raw=String(athlete?.team?.abbreviation??'').toUpperCase();
        const team=({LAR:'LA',WSH:'WAS',JAC:'JAX'} as Record<string,string>)[raw]??raw;
        const date=Date.parse(record.date),name=athlete?.displayName??athlete?.fullName,status=record.status;
        if(!known.has(team)||String(group.id)!==String(athlete?.team?.id)||typeof name!=='string'||!name.trim()||typeof status!=='string'||!status.trim()||status.length>80||!Number.isFinite(date)||date>now+5*60000)continue;
        covered.add(team);const key=`${team}|${normName(name)}`,old=reports.get(key);
        if(!old||date>old.date)reports.set(key,{date,status});
        else if(date===old.date&&old.status!==status)reports.set(key,{date,status:'Out — conflicting injury reports; availability unverified'});
      }
    }
    if(!reports.size)throw new Error('No matched injury reports');
    for(const [key,value]of reports) {
      // Never erase a known exclusion using an equivocal or healthy-like status.
      if(/out|doubtful|questionable|injured reserve|suspend/i.test(value.status)||!statuses.has(key))statuses.set(key,value.status);
    }
    snapshotAt=new Date(snapshot).toISOString();teams=covered.size;coveredTeams=[...covered];espnEntries=reports.size;
  }catch { /* Stale/unmatched/failed snapshots never replace verified historical designations. */ }
  if(!legacy&&!snapshotAt)throw new Error('Both free injury sources are unavailable. Availability remains unknown.');
  return {statuses,latestWeekByTeam:legacy?.latestWeekByTeam??{},latestReportDate:legacy?.latestReportDate??null,
    currentSnapshotAt:snapshotAt,freshSnapshot:Boolean(snapshotAt),currentTeams:teams,currentEntries:espnEntries,coveredTeams,
    note:'Dated current ESPN listings supplement nflverse history. Missing entries are unknown; final inactive status and participation are not guaranteed. Prior exclusions are not cleared by absence.'};
}
