import {PROP_STATS,quarterMarketName,periodMarketName,asQuarterMarket,contractHit,contractPush} from './propMarkets.ts';
import {activeRoster,UNAVAILABLE_STATUS} from './availability.ts';
import { americanToDecimal, decimalToAmerican, impliedProb } from './odds.ts';
import type { FirstQuarterBuildResult, FirstQuarterCandidate, FirstQuarterTicket, Pos } from './types.ts';
import type { FirstQuarterPropRow, ApiEvent } from './providers/oddsApi.ts';
import type { FirstQuarterPlayerGame, FirstQuarterTeamGame, FirstQuarterGameTotal, StatGame } from './providers/stats.ts';
import { normName } from './providers/stats.ts';

export interface FirstQuarterHistory {
  playerGames: FirstQuarterPlayerGame[];
  teamGames: FirstQuarterTeamGame[];
  gameTotals: FirstQuarterGameTotal[];
}

const PLAYER_MARKETS = new Set(Object.values(PROP_STATS).map(d=>d.market+'_q1'));
const marketPosition=Object.fromEntries(Object.values(PROP_STATS).map(d=>[d.market+'_q1',d.positions]));
const marketName=(market:string)=>market==='team_totals_q1'?'1Q team total':market==='totals_q1'?'1Q game total':periodMarketName(market);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const fresh = (at: string, now: number) => {
  const age = (now - Date.parse(at)) / 60000;
  return Number.isFinite(age) && age >= -5 && age <= 30;
};
const opportunityLabel = (market: string): FirstQuarterCandidate['opportunityLabel'] => {
  if (market === 'player_pass_yds_q1') return 'pass attempts';
  if (market === 'player_rush_yds_q1') return 'rush attempts';
  if (market === 'player_reception_yds_q1') return 'targets';
  return null;
};

function findPlayer(row: FirstQuarterPropRow, event: ApiEvent, stats: StatGame[], teamAbbr: Record<string, string>) {
  if (!PLAYER_MARKETS.has(asQuarterMarket(row.market))) return undefined;
  const matches=stats
    .filter((game) => normName(game.name) === normName(row.participant) &&
      marketPosition[asQuarterMarket(row.market)].includes(game.pos as Pos) &&
      [event.home_team, event.away_team].some((team) => normName(team) === normName(game.team) || teamAbbr[team] === game.team))
    .sort((a, b) => b.season - a.season || b.week - a.week);
  if(new Set(matches.map(g=>g.playerId).filter(Boolean)).size>1)return undefined;
  return matches[0];
}

function historicalValues(
  row: FirstQuarterPropRow,
  event: ApiEvent,
  history: FirstQuarterHistory,
  teamAbbr: Record<string, string>,
) {
  if (row.market === 'team_totals_q1') {
    const team = [event.home_team, event.away_team].find((name) =>
      normName(name) === normName(row.participant) ||
      teamAbbr[name]?.toLowerCase() === row.participant.toLowerCase(),
    );
    if (!team) return [];
    const abbreviation = teamAbbr[team] ?? team;
    return history.teamGames
      .filter((game) => game.team === abbreviation || game.team === team)
      .map((game) => game.points);
  }
  return history.gameTotals.map((game) => game.points);
}

function orderedPlayerHistory(player: StatGame | undefined, row: FirstQuarterPropRow, history: FirstQuarterHistory) {
  if (!player?.playerId) return [];
  const statGames = new Map(
    // The player-season rows provide a stable order even if the PBP download order changes.
    history.playerGames
      .filter((game) => game.playerId === player.playerId && game.market === row.market)
      .map((game) => [game.gameId, game]),
  );
  return [...statGames.values()].sort((a, b) => a.season - b.season || a.week - b.week);
}

function historyWindow(values: number[], line: number, side: 'Over' | 'Under' | 'AtLeast', count: number) {
  if (!values.length) return null;
  const recent = values.slice(-count);
  const decisions = recent.filter((value) => !contractPush(value,side,line));
  const hits = decisions.filter((value) => contractHit(value,side,line)).length;
  return {
    games: recent.length,
    average: mean(recent),
    hits: decisions.length ? hits : null,
    hitRate: decisions.length ? hits / decisions.length : null,
    hitGames: decisions.length,
  };
}

function defensivePerformance(
  history: FirstQuarterHistory,
  position: string,
  market: string,
  opponent: string,
  season: number,
) {
  const allowed = new Map<string, Map<string, number>>();
  for (const game of history.teamGames) {
    if (game.season !== season) continue;
    const games = allowed.get(game.opponent) ?? new Map<string, number>();
    games.set(game.gameId, 0);
    allowed.set(game.opponent, games);
  }
  for (const playerGame of history.playerGames) {
    if (playerGame.season !== season || playerGame.position !== position || playerGame.market !== market) continue;
    const games = allowed.get(playerGame.opponent);
    if (games?.has(playerGame.gameId)) games.set(playerGame.gameId, games.get(playerGame.gameId)! + playerGame.value);
  }
  const ranked = [...allowed].flatMap(([team, games]) => games.size >= 4
    ? [{ team, games: games.size, averageAllowed: mean([...games.values()]) }]
    : []).sort((a, b) => a.averageAllowed - b.averageAllowed);
  const defense = ranked.find((team) => team.team === opponent);
  if (!defense) return null;
  return {
    rank: ranked.findIndex((team) => team.team === opponent) + 1,
    teams: ranked.length,
    games: defense.games,
    averageAllowed: defense.averageAllowed,
    season,
  };
}

/** Builds candidates from live quarter-only quotes and verified Q1 history where it can be matched. */
export function makeFirstQuarterCandidates(
  rows: FirstQuarterPropRow[],
  event: ApiEvent,
  stats: StatGame[],
  history: FirstQuarterHistory,
  teamAbbr: Record<string, string>,
  now = Date.now(),
  currentSeason = new Date().getUTCMonth() <= 1 ? new Date().getUTCFullYear() - 1 : new Date().getUTCFullYear(),
  stalePreview = false,
  period = 'q1',
): FirstQuarterCandidate[] {
  if(!(Date.parse(event.commence_time)>now))return [];
  const grouped = new Map<string, FirstQuarterPropRow[]>();
  for (const row of rows) {
    if(![...PLAYER_MARKETS,'team_totals_q1','totals_q1'].includes(asQuarterMarket(row.market))||!row.market.endsWith('_'+period)||!['Over','Under','AtLeast'].includes(row.side)||!Number.isFinite(row.line)||row.line<0||!Number.isFinite(row.odds)||Math.abs(row.odds)<100)continue;
    const key = `${row.market}|${row.participant}|${row.line}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const result: FirstQuarterCandidate[] = [];
  for (const group of grouped.values()) {
    for (const row of group) {
      if (!fresh(row.updatedAt, now)&&!(stalePreview&&Date.parse(row.updatedAt)<=now&&Date.parse(row.updatedAt)<Date.parse(event.commence_time))) continue;
      const knownParticipant = PLAYER_MARKETS.has(asQuarterMarket(row.market)) && stats.some((game) =>
        normName(game.name) === normName(row.participant) &&
        [event.home_team, event.away_team].some((team) =>
          normName(team) === normName(game.team) || teamAbbr[team] === game.team),
      );
      const player = findPlayer(row, event, stats, teamAbbr);
      if (knownParticipant && !player) continue;
      const playerGames = PLAYER_MARKETS.has(asQuarterMarket(row.market)) ? orderedPlayerHistory(player, row, history) : [];
      const historical = PLAYER_MARKETS.has(asQuarterMarket(row.market))
        ? playerGames.map((game) => game.value)
        : historicalValues(row, event, history, teamAbbr);
      const decisions = historical.filter((value) => !contractPush(value,row.side,row.line));
      const hits = decisions.filter((value) => contractHit(value,row.side,row.line));
      const observed = decisions.length ? hits.length / decisions.length : null;
      const opposite=row.side==='Over'?'Under':row.side==='Under'?'Over':null,paired=group.filter(other=>other.side===opposite);
      const fairMarket=paired.length===1&&group.filter(other=>other.side===row.side).length===1?impliedProb(row.odds)/(impliedProb(row.odds)+impliedProb(paired[0].odds)):impliedProb(row.odds);
      const probability = observed == null
        ? fairMarket
        : (decisions.length / (decisions.length + 6)) * observed + (6 / (decisions.length + 6)) * fairMarket;
      const team = row.market === 'team_totals_q1'
        ? [event.home_team, event.away_team].find((name) =>
          normName(name) === normName(row.participant) ||
          teamAbbr[name]?.toLowerCase() === row.participant.toLowerCase(),
        ) ?? row.participant
        : player
          ? [event.home_team, event.away_team].find((name) => teamAbbr[name] === player.team) ?? player.team
          : '';
      const opponent = team
        ? team === event.home_team ? event.away_team : event.home_team
        : '';
      const opportunityValues = playerGames.map((game) => game.opportunities);
      const recentAverage = (count: number) => mean(opportunityValues.slice(-count));
      const projectedOpportunities = opportunityValues.length
        ? 0.3 * recentAverage(3) + 0.3 * recentAverage(5) + 0.4 * recentAverage(10)
        : null;
      const q1Opponent = teamAbbr[opponent] ?? opponent;
      result.push({
        historyPlayerId:player?.playerId,
        id: `${event.id}:${row.market}:${normName(row.participant)}:${row.side}:${row.line}`,
        player: row.participant,
        team: teamAbbr[team] ?? (team ? team : 'Game'),
        opponent: team ? teamAbbr[opponent] ?? opponent : 'Both teams',
        matchup: `${teamAbbr[event.away_team] ?? event.away_team} @ ${teamAbbr[event.home_team] ?? event.home_team}`,
        gameId: event.id,
        kickoff: event.commence_time,
        market: marketName(row.market),
        side: row.side,
        line: row.line,
        odds: row.odds,
        oddsAt: row.updatedAt,
        probability,
        sample: decisions.length,
        mean: historical.length ? mean(historical) : null,
        hitRate: observed,
        last5: PLAYER_MARKETS.has(asQuarterMarket(row.market))
          ? historyWindow(historical, row.line, row.side, 5)
          : null,
        last10: PLAYER_MARKETS.has(asQuarterMarket(row.market)) && historical.length >= 10
          ? historyWindow(historical, row.line, row.side, 10)
          : null,
        opportunityLabel: opportunityLabel(row.market),
        projectedOpportunities,
        defense: player
          ? defensivePerformance(history, player.pos, row.market, q1Opponent, currentSeason)
          : null,
      });
    }
  }
  return result;
}

export function invalidQuarterPair(a: FirstQuarterCandidate, b: FirstQuarterCandidate) {
  return a.id === b.id || (a.gameId === b.gameId && (normName(a.player) === normName(b.player)||!!a.espnPlayerId&&a.espnPlayerId===b.espnPlayerId||!!a.historyPlayerId&&a.historyPlayerId===b.historyPlayerId));
}

function ticket(legs: FirstQuarterCandidate[]): FirstQuarterTicket {
  const decimal = legs.reduce((product, leg) => product * americanToDecimal(leg.odds), 1);
  const games = new Set(legs.map((leg) => leg.gameId));
  const warnings = ['Q1 RESEARCH ONLY — estimates are uncalibrated; no wagers or guaranteed wins.', 'Combined probability is an independent-leg estimate; correlations can change the true probability.'];
  if (games.size < legs.length) {
    warnings.push('Same-game combination: FanDuel may not permit these legs together in a same-game parlay, and its combined price is not verified.');
  }
  return {
    legs,
    decimal,
    american: decimalToAmerican(decimal),
    probability: legs.reduce((product, leg) => product * leg.probability, 1),
    warnings,
  };
}

export function firstQuarterRejectionReasons(c:FirstQuarterCandidate,aggressive=false,now=Date.now()):string[]{
 const reasons:string[]=[];
 if(!Object.values(PROP_STATS).some(d=>quarterMarketName(d.market+'_q1')===c.market))reasons.push('Unsupported first-quarter player market.');
 if(c.rosterVerified!==true||!activeRoster(c.rosterStatus))reasons.push('Explicit active roster identity is unverified.');
 if(UNAVAILABLE_STATUS.test(c.injuryStatus??''))reasons.push('Player injury/availability status excludes automatic selection.');
 const snapshot=now-Date.parse(c.injurySnapshotAt??'');if(!(snapshot>=-5*60000&&snapshot<=24*3600_000))reasons.push('Current verified team injury snapshot is missing or stale.');
 if(!(Date.parse(c.kickoff)>now))reasons.push('Kickoff is missing, invalid or reached.');
 if(!(Date.parse(c.oddsAt)<Date.parse(c.kickoff)))reasons.push('Quote observation is not strictly before verified kickoff.');
 if(!fresh(c.oddsAt,now))reasons.push('Q1 odds are stale or future-dated.');
 if(!Number.isFinite(c.line)||c.line<0||!Number.isFinite(c.odds)||Math.abs(c.odds)<100)reasons.push('Invalid first-quarter line or side price.');
 if(!Number.isFinite(c.probability)||c.probability<=0||c.probability>=1)reasons.push('No usable probability estimate.');
 if(aggressive&&c.sample<4)reasons.push('Aggressive Q1 needs at least four verified Q1 historical games.');
 if(aggressive&&c.probability<impliedProb(c.odds)-0.03)reasons.push('Aggressive Q1 historical/price support threshold was not met.');
 return reasons;
}
function build(candidates: FirstQuarterCandidate[], aggressive: boolean,now:number): FirstQuarterBuildResult {
  const eligible = candidates.filter(candidate=>firstQuarterRejectionReasons(candidate,aggressive,now).length===0);
  if (eligible.length < 3) {
    return {
      options: [],
      missing: aggressive
        ? [`3 supported 1Q selections with at least 4 historical first-quarter games (have ${eligible.length})`]
        : [`3 fresh FanDuel first-quarter selections (have ${eligible.length})`],
    };
  }
  const combos: { value: number; ticket: FirstQuarterTicket }[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      if (invalidQuarterPair(eligible[i], eligible[j])) continue;
      for (let k = j + 1; k < eligible.length; k++) {
        const legs = [eligible[i], eligible[j], eligible[k]];
        if (invalidQuarterPair(legs[0], legs[2]) || invalidQuarterPair(legs[1], legs[2])) continue;
        const built = ticket(legs);
        const sameGamePenalty = new Set(legs.map((leg) => leg.gameId)).size < 3 ? 0.2 : 1;
        const value = aggressive
          ? built.decimal * sameGamePenalty
          : built.probability * sameGamePenalty;
        combos.push({ value, ticket: built });
      }
    }
  }
  combos.sort((a, b) => b.value - a.value);
  const options = combos.slice(0, 6).map((combo) => combo.ticket);
  return options.length
    ? { options, missing: [] }
    : { options: [], missing: ['3 non-duplicate, non-contradictory 1Q selections'] };
}

export function generateFirstQuarter(candidates: FirstQuarterCandidate[],now=Date.now()) {
  const best=build(candidates,false,now),aggressive=build(candidates,true,now);
  const signature=(t:FirstQuarterTicket)=>t.legs.map(l=>JSON.stringify([l.gameId,normName(l.player),l.market,l.side,l.line])).sort().join('|');
  if(best.options[0]){
    aggressive.options=aggressive.options.filter(t=>signature(t)!==signature(best.options[0]));
    if(!aggressive.options.length&&!aggressive.missing.length)aggressive.missing=['No second distinct supported 1Q triple; additional verified first-quarter selections are required.'];
  }
  return {best,aggressive};
}
