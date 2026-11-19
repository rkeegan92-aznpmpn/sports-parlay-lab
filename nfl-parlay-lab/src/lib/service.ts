import {propDefinition} from './propMarkets.ts';
import {UNAVAILABLE_STATUS,activeRoster} from './availability.ts';
import type { Candidate, Pos } from './types.ts';
import type { PipelineRejection } from './types.ts';
import { groupPipelineRejections } from './rejections.ts';
import { scoreAll } from './model.ts';
import { fetchEventProps, fetchEvents, DEFAULT_MARKETS, SUPPORTED_MARKETS, OddsApiError, type ApiEvent, type EventSchedule, type PropRow } from './providers/oddsApi.ts';
import { loadEspnFallbackStats, verifyCurrentRoster, type EspnPlayerLookup } from './providers/espn.ts';
import { defenseMatchup, loadCurrentInjuries, loadStatsHistory, normName, oppFactor, playerHistory, project, supportsStatMarket, type StatGame } from './providers/stats.ts';

export type MarketAvailability = 'available' | 'none' | 'unsupported' | 'error' | 'not-scanned';
export interface GameCoverage {
  providerHttpStatus?: number;
  providerErrorCode?: string;
  providerRetryAfterMs?: number;
  id: string;
  label: string;
  kickoff: string;
  status: MarketAvailability;
  markets: string[];
  returnedMarketKeys: string[];
  unsupportedMarketKeys: string[];
  props: number;
}
export interface LoadResult {
  mode: 'live' | 'demo';
  notes: string[];
  candidates: Candidate[];
  games: GameCoverage[];
  availableDates: string[];
  selectedDate: string;
  diagnostics: Record<string, number | string>;
  pipelineRejections?: ReturnType<typeof groupPipelineRejections>;
}
export function refreshCandidateHistory(
  candidates: Candidate[],
  stats: StatGame[],
  injuries: Map<string, string> | null,
  season: number,
  now = Date.now(),
): Candidate[] {
  return candidates.map((candidate) => {
    if (candidate.historySource === 'espn') return candidate;
    const playerGames = stats.filter((game) =>
      game.playerId === candidate.historyPlayerId && game.pos === candidate.pos &&
      NFL_TEAMS.has(game.team) && NFL_TEAMS.has(game.opp) && game.team !== game.opp &&
      game.gameId && gameIdMatchesTeams(game) &&
      Number.isInteger(game.season) && game.season >= season - 1 && game.season <= season &&
      Number.isInteger(game.week) && game.week >= 1 && game.week <= 18 &&
      !game.invalidGameDate &&
      game.gameDate && Date.parse(game.gameDate) < now &&
      supportsStatMarket(game, candidate.market),
    );
    if (!playerGames?.length) return candidate;
    const latest = [...playerGames].sort((a, b) => a.season - b.season || a.week - b.week).at(-1);
    if (!latest || (canonicalNflTeam(latest.team) !== canonicalNflTeam(candidate.team) && !candidate.rosterVerified)) return candidate;
    const projection = project(playerGames, candidate.market, oppFactor(stats, candidate.opp, candidate.pos, candidate.market, season, now));
    if (!projection) return candidate;
    const history = playerHistory(playerGames, candidate.market, candidate.side, candidate.line);
    history.defense = defenseMatchup(stats, season, candidate.opp, candidate.pos, candidate.market, now);
    const injury = injuries?.get(`${canonicalNflTeam(candidate.team)}|${normName(candidate.name)}`);
    return {
      ...candidate,
      sample: projection.sample,
      mean: projection.mean,
      sd: projection.sd,
      history,
      roleGames: history.roleGames,
      roleSupported: history.roleGames >= 3,
      injury: injuries
        ? injury && /out|doubtful|questionable|probable|injured reserve|suspend/i.test(injury) ? injury : undefined
        : candidate.injury,
      historyVerified: Boolean(history.last10?.results.length),
      verification: candidate.verification ? { ...candidate.verification, history: {
        source: 'nflverse', playerId: candidate.historyPlayerId!, market: candidate.market,
        line: candidate.line, gameIds: history.last10?.results.map((result) => result.gameId) ?? [],
      } } : undefined,
      scored: undefined,
    };
  });
}
export const TEAM_ABBR: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LA', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};
const NFL_TEAMS = new Set([...Object.values(TEAM_ABBR), 'LAR', 'JAC', 'WSH']);
const NFL_TEAM_ALIASES: Record<string, string> = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS' };
const canonicalNflTeam = (team: string) => NFL_TEAM_ALIASES[team] ?? team;
export const currentSeason = (d = new Date()) => (d.getUTCMonth() <= 1 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());
const POS_OK: Record<string, Pos[]> = { player_pass_yds: ['QB'], player_pass_tds: ['QB'], player_rush_yds: ['RB', 'QB'], player_rush_attempts: ['RB'], player_reception_yds: ['WR', 'TE', 'RB'], player_receptions: ['WR', 'TE', 'RB'], player_anytime_td: ['QB', 'RB', 'WR', 'TE'] };
const SLOT_POS = new Set(['QB', 'RB', 'WR', 'TE']);

interface UnmatchedProp { row: PropRow; event: ApiEvent; teams: string[]; lookupKey: string }
const historyLookupKey = (name: string, positions: Pos[], teams: string[]) =>
  `${normName(name)}|${[...positions].sort().join(',')}|${[...teams].sort().join(',')}`;

function matchingNflverseHistory(
  stats: StatGame[],
  name: string,
  positions: Pos[],
  teams: string[],
  market: string,
  now: number,
  allowFormerTeam = false,
): StatGame[] | undefined {
  const allowedTeams = new Set(teams.map(canonicalNflTeam));
  const activeSeason = currentSeason(new Date(now));
  const matches = stats.filter((game) =>
    normName(game.name) === normName(name) &&
    game.playerId &&
    positions.includes(game.pos as Pos) &&
    NFL_TEAMS.has(game.team) &&
    NFL_TEAMS.has(game.opp) &&
    game.team !== game.opp &&
    game.gameId &&
    gameIdMatchesTeams(game) &&
    Number.isInteger(game.season) &&
    game.season >= activeSeason - 1 &&
    game.season <= activeSeason &&
    Number.isInteger(game.week) &&
    game.week >= 1 && game.week <= 18 &&
    !game.invalidGameDate &&
    Boolean(game.gameDate) && Date.parse(game.gameDate!) < now &&
    supportsStatMarket(game, market),
  );
  const playerIds = new Set(matches.map((game) => game.playerId));
  if (playerIds.size !== 1) return undefined;
  const playerId = [...playerIds][0];
  const history = matches.filter((game) => game.playerId === playerId);
  const latest = [...history].sort((a, b) => a.season - b.season || a.week - b.week).at(-1);
  return latest && (allowFormerTeam || allowedTeams.has(canonicalNflTeam(latest.team))) ? history : undefined;
}

function gameIdMatchesTeams(game: StatGame): boolean {
  const match = /^(\d{4})_(\d{1,2})_([A-Z]{2,3})_([A-Z]{2,3})$/.exec(game.gameId);
  if (!match || Number(match[1]) !== game.season || Number(match[2]) !== game.week) return false;
  const teams = new Set([canonicalNflTeam(match[3]), canonicalNflTeam(match[4])]);
  return teams.size === 2 && teams.has(canonicalNflTeam(game.team)) && teams.has(canonicalNflTeam(game.opp));
}

function noVigMarketProbability(row: PropRow, rows: PropRow[]): number | undefined {
  if (['Yes','AtLeast'].includes(row.side) || row.line == null) return undefined;
  const oppositeSide = row.side === 'Over' ? 'Under' : 'Over';
  const opposite = rows.filter((other) =>
    normName(other.player) === normName(row.player) &&
    other.market === row.market &&
    other.line === row.line &&
    other.side === oppositeSide &&
    other.updatedAt === row.updatedAt,
  );
  if (opposite.length !== 1) return undefined;
  const over = row.side === 'Over' ? row : opposite[0];
  const under = row.side === 'Under' ? row : opposite[0];
  const overP = 1 / (over.odds > 0 ? 1 + over.odds / 100 : 1 + 100 / Math.abs(over.odds));
  const underP = 1 / (under.odds > 0 ? 1 + under.odds / 100 : 1 + 100 / Math.abs(under.odds));
  const total = overP + underP;
  return Number.isFinite(total) && total > 0
    ? (row.side === 'Over' ? overP : underP) / total
    : undefined;
}

function buildLiveCandidate(
  row: PropRow,
  event: ApiEvent,
  playerGames: StatGame[],
  stats: StatGame[],
  season: number,
  asOf: number,
  injuries: Map<string, string>,
  historySource: NonNullable<Candidate['historySource']>,
  teamOverride?: string,
  marketP?: number,
): Candidate | null {
  const kickoffTs = Date.parse(event.commence_time);
  if (!event.id || !Number.isFinite(kickoffTs) || kickoffTs <= asOf ||
      !SUPPORTED_MARKETS.includes(row.market) || !Number.isFinite(row.odds) ||
      Math.abs(row.odds) < 100 || !Number.isFinite(Date.parse(row.updatedAt)) ||
      row.side === 'Yes' && row.market !== 'player_anytime_td' ||
      row.side !== 'Yes' && (!Number.isFinite(row.line) || row.line == null)) return null;
  const orderedGames = [...playerGames].sort((a, b) => a.season - b.season || a.week - b.week);
  const last = orderedGames.at(-1);
  if (!last || !SLOT_POS.has(last.pos)) return null;
  const playerIds = new Set(orderedGames.map((game) => game.playerId).filter(Boolean));
  if (!last.playerId || playerIds.size !== 1 || normName(last.name) !== normName(row.player) ||
      orderedGames.some((game) =>
    game.playerId !== last.playerId || normName(game.name) !== normName(row.player) ||
    game.pos !== last.pos || !game.gameId || !game.team || !game.opp || game.team === game.opp ||
    !game.gameDate || !Number.isFinite(Date.parse(game.gameDate)) || Date.parse(game.gameDate) >= asOf,
  )) return null;
  const home = TEAM_ABBR[event.home_team], away = TEAM_ABBR[event.away_team];
  const team = canonicalNflTeam(teamOverride ?? last.team);
  if (!home || !away || ![home, away].includes(team)) return null;
  const positions = propDefinition(row.market)?.positions ?? POS_OK[row.market.replace('_alternate', '')] ?? [];
  if (!positions.includes(last.pos as Pos)) return null;
  const opponent = team === home ? away : home;
  const supportedGames = playerGames.filter((game) => supportsStatMarket(game, row.market));
  if (!supportedGames.length) return null;
  const factor = historySource === 'nflverse' ? oppFactor(stats, opponent, last.pos, row.market, season, asOf) : 1;
  const projection = project(supportedGames, row.market, factor);
  if (!projection || row.line == null && row.side !== 'Yes') return null;
  const history = playerHistory(supportedGames, row.market, row.side, row.line);
  if (historySource === 'nflverse') history.defense = defenseMatchup(stats, season, opponent, last.pos, row.market, asOf);
  const injury = injuries.get(`${canonicalNflTeam(team)}|${normName(row.player)}`);
  return {
    id: `${event.id}:${row.player}:${row.market}:${row.side}:${row.line}`,
    name: row.player,
    pos: last.pos as Pos,
    team,
    opp: opponent,
    gameId: event.id,
    eventLabel: gameLabel(event),
    kickoff: event.commence_time,
    market: row.market,
    side: row.side,
    line: row.line,
    odds: row.odds,
    oddsAt: row.updatedAt,
    marketP,
    marketPSource: marketP == null ? 'single-side' : 'no-vig',
    sample: projection.sample,
    mean: projection.mean,
    sd: projection.sd,
    history,
    injury,
    source: 'live',
    historySource,
    historyPlayerId: last.playerId,
    roleGames: history.roleGames,
    roleSupported: history.roleGames >= 3,
    eventVerified: true,
    quoteVerified: true,
    historyVerified: true,
    verification: {
      event: { id: event.id, kickoff: event.commence_time, label: gameLabel(event) },
      quote: {
        bookmaker: 'fanduel',
        player: row.player,
        market: row.market,
        side: row.side,
        line: row.line,
        odds: row.odds,
        updatedAt: row.updatedAt,
      },
      history: {
        source: historySource,
        playerId: last.playerId,
        market: row.market,
        line: row.line,
        gameIds: history.last10?.results.map((result) => result.gameId) ?? [],
      },
    },
  };
}

const utcDate = (time: string) => new Date(time).toISOString().slice(0, 10);
export function selectSchedule(events: ApiEvent[], requestedDate: string | undefined, now = Date.now()) {
  const upcoming = events.filter((event) => Number.isFinite(Date.parse(event.commence_time)) && Date.parse(event.commence_time) > now)
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));
  const availableDates = [...new Set(upcoming.map((event) => utcDate(event.commence_time)))];
  const selectedDate = requestedDate || 'ALL';
  return {
    upcoming,
    availableDates,
    selectedDate,
    events: selectedDate === 'ALL' ? upcoming : upcoming.filter((event) => utcDate(event.commence_time) === selectedDate),
  };
}
const gameLabel = (event: ApiEvent) => `${TEAM_ABBR[event.away_team] ?? event.away_team} @ ${TEAM_ABBR[event.home_team] ?? event.home_team}`;
const emptyCoverage = (event: ApiEvent, status: MarketAvailability = 'not-scanned'): GameCoverage => ({
  id: event.id, label: gameLabel(event), kickoff: event.commence_time, status, markets: [], returnedMarketKeys: [], unsupportedMarketKeys: [], props: 0,
});

export async function loadLive(
  o: { key: string; date?: string; markets?: string[] },
  now = Date.now(),
  f: typeof fetch = fetch,
  schedule?: EventSchedule,
): Promise<LoadResult> {
  const season = currentSeason(new Date(now)), notes: string[] = [];
  const { events: eventResponse, remaining: eventsRemaining } = schedule ?? await fetchEvents(o.key, f);
  const selected = selectSchedule(eventResponse, o.date, now);
  const events = selected.events;
  const stats = await loadStatsHistory(season, f), games = stats.games;
  if (stats.unavailable.length) {
    notes.push(`Historical player statistics unavailable for season${stats.unavailable.length === 1 ? '' : 's'} ${stats.unavailable.map((item) => `${item.season} (${item.error})`).join('; ')}.`);
  }
  if (!games.length) notes.push('No real historical player statistics were available; no player projections or tickets will be fabricated.');
  let inj = new Map<string, string>();
  let injuryReport:Awaited<ReturnType<typeof loadCurrentInjuries>>|undefined;
  try {
    const report = await loadCurrentInjuries(season, f, now);
    injuryReport=report;
    inj = report.statuses;
    const weeks = [...new Set(Object.values(report.latestWeekByTeam))].sort((a,b)=>a-b);
    if(report.freshSnapshot)notes.push(`Current ESPN injury snapshot ${report.currentSnapshotAt}: ${report.currentEntries} matched records across ${report.currentTeams} teams. ${report.note}`);
    notes.push(`Historical injury source latest reporting weeks: ${weeks.join(', ') || 'unavailable'}; publication date: ${report.latestReportDate ?? 'unavailable'}. These reports do not establish current game-week availability or final inactive status. Prior Out/Doubtful designations remain conservative exclusions.`);
  } catch (e) { notes.push(`Injury data unavailable (${(e as Error).message}). Injury status is unknown, not "healthy".`); }
  const d: Record<string, number> = {
    eventsScanned: 0, eventsWithProps: 0, propsSeen: 0, candidates: 0,
    noStats: 0, teamMismatch: 0, espnFallbackLookups: 0, espnFallbackMatches: 0, espnFallbackGames: 0,
    rosterVerified: 0, rosterUnmatched: 0, rosterExcluded: 0,
  };
  const pipelineRejections: PipelineRejection[] = [];
  const reject = (row: PropRow, event: ApiEvent, reason: string) => pipelineRejections.push({
    player: row.player,
    market: row.market,
    side: row.side,
    line: row.line,
    gameId: event.id,
    eventLabel: gameLabel(event),
    kickoff: event.commence_time,
    reason,
  });
  const rejectCandidate = (candidate: Candidate, reason: string) => pipelineRejections.push({
    player: candidate.name,
    market: candidate.market,
    side: candidate.side,
    line: candidate.line,
    gameId: candidate.gameId,
    eventLabel: candidate.eventLabel ?? 'event label unavailable',
    kickoff: candidate.kickoff,
    reason,
  });
  const currentTeams = new Map<string, Promise<string | undefined>>();
  const candidates: Candidate[] = [], gl = events.map((event) => emptyCoverage(event));
  const eventRowsByEvent = new Map<string, PropRow[]>();
  const unmatchedProps: UnmatchedProp[] = [];
  const foundMarkets = new Set<string>();
  let remaining: string | null = eventsRemaining;
  for (const [index, ev] of events.entries()) {
    const coverage = gl[index];
    const home = TEAM_ABBR[ev.home_team], away = TEAM_ABBR[ev.away_team];
    let rows;
    try {
      const r = await fetchEventProps(o.key, ev.id, o.markets ?? DEFAULT_MARKETS, f);
      rows = r.rows;
      coverage.returnedMarketKeys = r.marketKeys;
      coverage.unsupportedMarketKeys = r.marketKeys.filter((market) => market.startsWith('player_') && !SUPPORTED_MARKETS.includes(market));
      if (coverage.unsupportedMarketKeys.length) {
        notes.push(`${coverage.label} (${ev.id}): FanDuel returned unsupported player market key(s) ${coverage.unsupportedMarketKeys.join(', ')}; no alternate/stat mapping was guessed.`);
      }
      eventRowsByEvent.set(ev.id, rows);
      remaining = r.remaining ?? remaining;
    } catch (e) {
      coverage.status = 'error';
      coverage.providerHttpStatus = e instanceof OddsApiError ? e.status : 0;
      if(e instanceof OddsApiError) {coverage.providerErrorCode=e.code;coverage.providerRetryAfterMs=e.retryAfterMs;}
      notes.push(`${coverage.label}: ${(e as Error).message}`);
      if (e instanceof OddsApiError && [401,403,429].includes(e.status)) {
        for (const next of gl.slice(index + 1)) next.status = 'not-scanned';
        break;
      }
      continue;
    }
    d.eventsScanned++;
    if (rows.length) d.eventsWithProps++;
    coverage.props = rows.length;
    coverage.markets = [...new Set(rows.map((row) => row.market))].sort();
    coverage.status = coverage.markets.length
      ? 'available'
      : coverage.unsupportedMarketKeys.length ? 'unsupported' : 'none';
    coverage.markets.forEach((market) => foundMarkets.add(market));
    for (const r of rows) {
      d.propsSeen++;
      if (!home || !away) {
        d.teamMismatch++;
        reject(r, ev, 'Event home/away teams could not be matched to supported NFL teams.');
        continue;
      }
      const positions = propDefinition(r.market)?.positions ?? POS_OK[r.market.replace('_alternate', '')] ?? [];
      if (!positions.length) {
        d.noStats++;
        reject(r, ev, 'No supported historical-stat mapping exists for this player market.');
        continue;
      }
      const teams = [home, away];
      let pg = matchingNflverseHistory(games, r.player, positions, teams, r.market, now);
      let teamOverride: string | undefined;
      if (!pg) {
        const former = matchingNflverseHistory(games, r.player, positions, teams, r.market, now, true);
        if (former?.length) {
          const pos = former.at(-1)!.pos;
          const key = `${normName(r.player)}|${pos}|${teams.join('|')}`;
          if (!currentTeams.has(key)) currentTeams.set(key, verifyCurrentRoster(teams.map((team) => ({
            key: team, name: r.player, position: pos, team,
          })), f).then((result) => result.players.size === 1 ? [...result.players.values()][0].team : undefined));
          teamOverride = await currentTeams.get(key);
          if (teamOverride) pg = former;
        }
      }
      const candidate = pg
        ? buildLiveCandidate(r, ev, pg, games, season, now, inj, 'nflverse', teamOverride, noVigMarketProbability(r, rows))
        : null;
      if (candidate) {
        candidates.push(candidate);
        d.candidates++;
      } else {
        if (pg) {
          d.teamMismatch++;
          reject(r, ev, 'Matched historical data failed player, position, team, event, or market verification.');
          continue;
        }
        unmatchedProps.push({
          row: r,
          event: ev,
          teams,
          lookupKey: historyLookupKey(r.player, positions, teams),
        });
      }
    }
  }
  const fallbackRequests = new Map<string, EspnPlayerLookup>();
  for (const unmatched of unmatchedProps) {
    const positions = propDefinition(unmatched.row.market)?.positions ?? POS_OK[unmatched.row.market.replace('_alternate', '')] ?? [];
    if (positions.length) fallbackRequests.set(unmatched.lookupKey, {
      key: unmatched.lookupKey,
      name: unmatched.row.player,
      positions,
      teams: unmatched.teams,
    });
  }
  if (fallbackRequests.size) {
    d.espnFallbackLookups = fallbackRequests.size;
    try {
      const fallback = await loadEspnFallbackStats([...fallbackRequests.values()], [season, season - 1], f, now);
      d.espnFallbackMatches = fallback.games.size;
      d.espnFallbackGames = new Set([...fallback.games.values()].flat().map((game) => game.gameId)).size;
      for (const unmatched of unmatchedProps) {
        const playerGames = fallback.games.get(unmatched.lookupKey) ?? [];
        const team = fallback.teamByLookup.get(unmatched.lookupKey);
        if (!playerGames.length || !team) {
          d.noStats++;
          reject(unmatched.row, unmatched.event, 'No unique verified player history from nflverse or ESPN.');
          continue;
        }
        const eventRows = eventRowsByEvent.get(unmatched.event.id) ?? [];
        const candidate = buildLiveCandidate(
          unmatched.row, unmatched.event, playerGames, games, season, now, inj, 'espn', team,
          noVigMarketProbability(unmatched.row, eventRows),
        );
        if (!candidate) {
          d.teamMismatch++;
          reject(unmatched.row, unmatched.event, 'ESPN history failed player, position, team, event, or market verification.');
          continue;
        }
        candidates.push(candidate);
        d.candidates++;
      }
      if (fallback.unmatched) notes.push(`ESPN's free roster could not uniquely match ${fallback.unmatched} of ${fallbackRequests.size} unmatched player names; those props remain excluded.`);
      if (fallback.errors.length) {
        const examples = fallback.errors.slice(0, 3).join('; ');
        notes.push(`Some ESPN fallback history requests failed (${fallback.errors.length}); only verified returned game logs were used. Examples: ${examples}${fallback.errors.length > 3 ? '; additional errors omitted' : ''}`);
      }
    } catch (error) {
      d.noStats += unmatchedProps.length;
      for (const unmatched of unmatchedProps) {
        reject(unmatched.row, unmatched.event, 'ESPN historical-stat fallback failed; no verified history was substituted.');
      }
      notes.push(`Free ESPN historical-stat fallback failed (${error instanceof Error ? error.message : String(error)}); unmatched props remain excluded.`);
    }
  }
  if (candidates.length) {
    const rosterLookups = new Map<string, { key: string; name: string; position: string; team: string }>();
    for (const candidate of candidates) {
      const key = `${canonicalNflTeam(candidate.team)}|${candidate.pos}|${normName(candidate.name)}`;
      rosterLookups.set(key, { key, name: candidate.name, position: candidate.pos, team: candidate.team });
    }
    const roster = await verifyCurrentRoster([...rosterLookups.values()], f);
    d.rosterVerified = roster.players.size;
    d.rosterUnmatched = roster.unmatched;
    if (roster.errors.length) {
      notes.push(`Current ESPN roster verification failed for ${roster.errors.length} team roster(s); unmatched players were excluded. ${roster.errors.slice(0, 3).join('; ')}`);
    }
    const verified: Candidate[] = [];
    for (const candidate of candidates) {
      const key = `${canonicalNflTeam(candidate.team)}|${candidate.pos}|${normName(candidate.name)}`;
      const rosterPlayer = roster.players.get(key);
      if (!rosterPlayer || canonicalNflTeam(rosterPlayer.team) !== canonicalNflTeam(candidate.team) ||
          rosterPlayer.position !== candidate.pos) {
        rejectCandidate(candidate, 'Current ESPN roster/team/position could not be verified.');
        continue;
      }
      const rosterStatus = rosterPlayer.status?.trim() || 'Roster-listed; detailed roster status unavailable';
      const status = `${rosterStatus} ${candidate.injury ?? ''}`.toLowerCase();
      if(!activeRoster(rosterStatus)){rejectCandidate(candidate,'Explicit active roster status could not be verified.');continue;}
      if (UNAVAILABLE_STATUS.test(status)) {
        rejectCandidate(candidate, `Unavailable roster/injury designation: ${status}`);
        continue;
      }
      verified.push({
        ...candidate,
        espnPlayerId: /^\d+$/.test(rosterPlayer.id) ? `espn:${rosterPlayer.id}` : undefined,
        rosterVerified: true,
        rosterStatus,
        availability:{injurySnapshotAt:injuryReport?.currentSnapshotAt??null,injuryTeamCovered:injuryReport?.coveredTeams.includes(canonicalNflTeam(candidate.team))??false,checkedAt:now},
      });
    }
    d.rosterExcluded = candidates.length - verified.length;
    candidates.splice(0, candidates.length, ...verified);
    if (d.rosterExcluded) {
      notes.push(`${d.rosterExcluded} props were excluded because current roster status showed inactive/unavailable or current team/position could not be verified.`);
    }
  }
  if (d.noStats) notes.push(`${d.noStats} FanDuel props still had no verified historical player statistics after the nflverse and ESPN checks; they were excluded without fabricated values.`);
  if (d.teamMismatch) notes.push(`${d.teamMismatch} props were excluded because historical team or position data did not match the upcoming game.`);
  if (!events.length) notes.push(`No upcoming NFL games are scheduled for ${selected.selectedDate}.`);
  else if (d.eventsScanned && !foundMarkets.size) notes.push('FanDuel returned no supported player-prop markets for the selected games.');
  const candidateGameCount = new Set(candidates.map((candidate) => candidate.gameId)).size;
  if (events.length === 1 || candidateGameCount === 1) {
    notes.push(`Only one upcoming game${candidateGameCount === 1 && events.length > 1 ? ' currently has matched player props' : ' is available'}; a six-pick ticket requires at least two games because no more than three picks may come from one game.`);
  } else if (candidateGameCount === 0 && events.length) {
    notes.push('No upcoming games currently have FanDuel props matched to real historical player statistics, so no tickets can be generated.');
  }
  if (events.length && !d.eventsScanned && notes.some((note) => /429|quota|limit/i.test(note))) {
    notes.push('Odds API rate or credit limit reached; no live prop quotes were loaded.');
  }
  notes.push('Recent role support is based on game-level carries, targets, and pass attempts; snap counts are shown only when the nflverse source provides offense_snaps. Weather and game script are not modeled.');
  return {
    mode: 'live',
    pipelineRejections: groupPipelineRejections(pipelineRejections),
    notes,
    candidates: scoreAll(candidates, now),
    games: gl,
    availableDates: selected.availableDates,
    selectedDate: selected.selectedDate,
    diagnostics: { ...d, marketsFound: [...foundMarkets].join(', ') || 'none', oddsApiCreditsRemaining: remaining ?? 'unknown' },
  };
}

const DEMO: [string, string, Pos, string, string, string, string, string, number, number, number, number, number, string, number][] = [
  ['q1', 'Marcus Vale', 'QB', 'AAA', 'BBB', 'G1', 'player_pass_yds', 'Over', 262.5, -114, 278, 52, 10, '', 4],
  ['q2', 'Dre Kowalski', 'QB', 'CCC', 'DDD', 'G2', 'player_pass_tds', 'Over', 1.5, -135, 1.9, 0.9, 9, '', 6],
  ['q3', 'Eli Strand', 'QB', 'EEE', 'FFF', 'G3', 'player_pass_yds', 'Over', 289.5, 105, 297, 58, 3, '', 90],
  ['r1', 'Jalen Okoro', 'RB', 'AAA', 'BBB', 'G1', 'player_rush_yds', 'Over', 68.5, -110, 74, 24, 10, '', 4],
  ['r2', 'Tre Mabry', 'RB', 'CCC', 'DDD', 'G2', 'player_anytime_td', 'Yes', 0, 110, 0.62, 0, 10, '', 6],
  ['r3', 'Colt Ferris', 'RB', 'BBB', 'AAA', 'G1', 'player_rush_yds', 'Over', 54.5, -105, 58, 22, 9, 'Questionable', 5],
  ['r4', 'Nico Barlow', 'RB', 'EEE', 'FFF', 'G3', 'player_rush_attempts', 'Over', 17.5, -120, 18.4, 3.6, 10, '', 8],
  ['r5', 'Wes Tolliver', 'RB', 'DDD', 'CCC', 'G2', 'player_rush_yds', 'Over', 79.5, 120, 76, 26, 7, '', 6],
  ['w1', 'Amari Fenn', 'WR', 'AAA', 'BBB', 'G1', 'player_reception_yds', 'Over', 74.5, -110, 81, 26, 10, '', 4],
  ['w2', 'Devon Pike', 'WR', 'CCC', 'DDD', 'G2', 'player_receptions', 'Over', 5.5, -125, 6.1, 1.9, 10, '', 6],
  ['w3', 'Zane Holt', 'WR', 'BBB', 'AAA', 'G1', 'player_reception_yds', 'Over', 62.5, -105, 64, 24, 8, '', 5],
  ['w4', 'Rico Dane', 'WR', 'EEE', 'FFF', 'G3', 'player_reception_yds', 'Over', 88.5, 125, 86, 30, 10, '', 8],
  ['w5', 'Cal Ibarra', 'WR', 'DDD', 'CCC', 'G2', 'player_anytime_td', 'Yes', 0, 150, 0.46, 0, 10, '', 6],
  ['t1', 'Owen Sutter', 'TE', 'AAA', 'BBB', 'G1', 'player_reception_yds', 'Over', 48.5, -115, 52, 19, 10, '', 4],
  ['t2', 'Gabe Lindqvist', 'TE', 'EEE', 'FFF', 'G3', 'player_receptions', 'Over', 4.5, -130, 4.9, 1.6, 6, '', 8],
  ['t3', 'Max Rowan', 'TE', 'CCC', 'DDD', 'G2', 'player_anytime_td', 'Yes', 0, 190, 0.38, 0, 10, '', 6],
];
/** Fictional players and illustrative odds. Always labeled Demo Data. */
export function demoResult(now = Date.now(), reason = ''): LoadResult {
  const cs: Candidate[] = DEMO.map((a) => ({ id: a[0], name: a[1], pos: a[2], team: a[3], opp: a[4], gameId: a[5], kickoff: new Date(now + 864e5).toISOString(), market: a[6], side: a[7] as Candidate['side'],
    line: a[6] === 'player_anytime_td' ? null : a[8], odds: a[9], oddsAt: new Date(now - a[14] * 60000).toISOString(), sample: a[12], mean: a[10], sd: a[11], injury: a[13] || undefined, source: 'demo' }));
  const selectedDate = utcDate(new Date(now + 864e5).toISOString());
  const demoGames = [{ id: 'G1', label: 'AAA vs BBB' }, { id: 'G2', label: 'CCC vs DDD' }, { id: 'G3', label: 'EEE vs FFF' }];
  return { mode: 'demo', notes: [`${reason} Showing Demo Data (fictional players, illustrative odds).`.trim()], candidates: scoreAll(cs, now),
    games: demoGames.map((game) => ({ ...game, kickoff: new Date(now + 864e5).toISOString(), status: 'available', markets: [...new Set(cs.filter((candidate) => candidate.gameId === game.id).map((candidate) => candidate.market))], returnedMarketKeys: [], unsupportedMarketKeys: [], props: cs.filter((candidate) => candidate.gameId === game.id).length })),
    availableDates: [selectedDate], selectedDate, diagnostics: {} };
}
