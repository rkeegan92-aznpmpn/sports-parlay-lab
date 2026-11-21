import { scoreCandidate } from '../src/lib/model.ts';
import { demoResult } from '../src/lib/service.ts';

export const NOW = Date.parse('2026-11-08T12:00:00Z');
const demo = () => demoResult(NOW).candidates;
const pick = (ids: string[]) => ids.map((i) => demo().find((c) => c.id === i)!);
export const verifiedLivePool = () => demo().map((candidate) => {
  const gameResults = Array.from({ length: 10 }, (_, index) => ({
    date: new Date(NOW - (index + 1) * 864e5).toISOString(),
    season: 2026, week: index + 1, team: candidate.team, opponent: candidate.opp, value: candidate.mean,
    gameId: `${candidate.id}-history-${index}`, playerId: `gsis-${candidate.id}`,
  }));
  const history = {
    last5: null,
    last10: { games: 10, average: candidate.mean, median: candidate.mean, consistency: null, hits: 8, hitRate: 0.8, hitGames: 10, results: gameResults },
    trend: null, homeAverage: null, awayAverage: null, opportunityAverage: 10,
    roleGames: 5, snapAverage: null, snapCounts: null, defense: null, playingTime: 'unavailable' as const,
  };
  const live = {
    ...candidate, source: 'live' as const, history, sample: 10,
    historySource: 'nflverse' as const, historyPlayerId: `gsis-${candidate.id}`,
    eventLabel: `${candidate.team} @ ${candidate.opp}`,
    rosterVerified: true, rosterStatus: 'Active', roleSupported: true, roleGames: 5,
    eventVerified: true, quoteVerified: true, historyVerified: true,
    marketP: 0.5, marketPSource: 'no-vig' as const,
    oddsAt: new Date(NOW).toISOString(), kickoff: new Date(NOW + 3600_000).toISOString(),
    verification: {
      event: { id: candidate.gameId, kickoff: new Date(NOW + 3600_000).toISOString(), label: `${candidate.team} @ ${candidate.opp}` },
      quote: { bookmaker: 'fanduel' as const, player: candidate.name, market: candidate.market, side: candidate.side, line: candidate.line, odds: candidate.odds, updatedAt: new Date(NOW).toISOString() },
      history: { source: 'nflverse' as const, playerId: `gsis-${candidate.id}`, market: candidate.market, line: candidate.line, gameIds: gameResults.map((result) => result.gameId) },
    },
  };
  return { ...live, scored: scoreCandidate(live, NOW) };
});
