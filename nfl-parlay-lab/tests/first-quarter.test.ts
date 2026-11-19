import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFirstQuarter, makeFirstQuarterCandidates } from '../src/lib/firstQuarter.ts';
import type { ApiEvent, FirstQuarterPropRow } from '../src/lib/providers/oddsApi.ts';
import type { FirstQuarterHistory } from '../src/lib/firstQuarter.ts';
import type { StatGame } from '../src/lib/providers/stats.ts';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const event: ApiEvent = {
  id: 'game-1',
  commence_time: '2026-11-15T18:00:00Z',
  home_team: 'Minnesota Vikings',
  away_team: 'Buffalo Bills',
};
const stats = (name: string, pos: string, playerId: string): StatGame => ({
  name, pos, playerId, team: 'BUF', opp: 'MIN', season: 2026, week: 8, gameId: 'old-game', v: {},
});
const prepared=(c:import('../src/lib/types.ts').FirstQuarterCandidate[])=>c.map(l=>({...l,rosterVerified:true,rosterStatus:'Active',injurySnapshotAt:new Date(NOW).toISOString()}));
const row = (participant: string, market: string, odds = -110): FirstQuarterPropRow => ({
  participant, market, side: 'Over', line: 20.5, odds, updatedAt: new Date(NOW - 60_000).toISOString(),
});

test('quarter selections use Q1 history only and produce best/qualified aggressive triples', () => {
  const rows = [
    row('Test QB', 'player_pass_yds_q1'),
    row('Test WR', 'player_reception_yds_q1'),
    row('Test RB', 'player_rush_yds_q1'),
  ];
  const playerGames: FirstQuarterHistory['playerGames'] = [
    ...['QB1', 'WR1', 'RB1'].flatMap((playerId) => Array.from({ length: 5 }, (_, i) => ({
      playerId,
      gameId: `g${i}`,
      market: playerId === 'QB1' ? 'player_pass_yds_q1' as const : playerId === 'WR1' ? 'player_reception_yds_q1' as const : 'player_rush_yds_q1' as const,
      value: 30,
      opportunities: 2,
      season: 2026,
      week: i + 1,
      position: playerId.slice(0, 2),
      team: 'BUF',
      opponent: 'MIN',
    }))),
  ];
  const history: FirstQuarterHistory = { playerGames, teamGames: [], gameTotals: [] };
  const candidates = makeFirstQuarterCandidates(rows, event, [
    stats('Test QB', 'QB', 'QB1'), stats('Test WR', 'WR', 'WR1'), stats('Test RB', 'RB', 'RB1'),
  ], history, { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' }, NOW);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((candidate) => candidate.sample === 5 && candidate.mean === 30 && candidate.hitRate === 1));
  assert.ok(candidates.every((candidate) => candidate.last5?.games === 5 && candidate.last10 === null));
  assert.ok(candidates.every((candidate) => candidate.team === 'BUF' && candidate.opponent === 'MIN'));
  const result = generateFirstQuarter(prepared(candidates),NOW);
  assert.equal(result.best.options[0].legs.length, 3);
  assert.equal(result.best.options[0].warnings.some((warning) => warning.includes('may not permit')), true);
  assert.equal(result.aggressive.options.length,0,'One eligible triple cannot be presented twice as two distinct tickets');
  assert.match(result.aggressive.missing[0],/second distinct/);
  assert.ok(result.best.options[0].legs.every((candidate) => candidate.market.includes('1Q')));
});

test('player Q1 analysis reports last-5/10 hit rates, projected opportunities, and opponent defense', () => {
  const playerGames: FirstQuarterHistory['playerGames'] = Array.from({ length: 10 }, (_, index) => ({
    playerId: 'QB1',
    gameId: `g${index + 1}`,
    market: 'player_pass_yds_q1' as const,
    value: (index + 1) * 10,
    opportunities: index + 1,
    season: 2026,
    week: index + 1,
    position: 'QB',
    team: 'BUF',
    opponent: 'MIN',
  }));
  const teamGames: FirstQuarterHistory['teamGames'] = Array.from({ length: 10 }, (_, index) => [
    { gameId: `g${index + 1}`, team: 'BUF', opponent: 'MIN', points: 0, season: 2026, week: index + 1 },
    { gameId: `g${index + 1}`, team: 'MIN', opponent: 'BUF', points: 0, season: 2026, week: index + 1 },
  ]).flat();
  const candidates = makeFirstQuarterCandidates(
    [{ ...row('Test QB', 'player_pass_yds_q1'), line: 55.5 }],
    event,
    [stats('Test QB', 'QB', 'QB1')],
    { playerGames, teamGames, gameTotals: [] },
    { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' },
    NOW,
    2026,
  );
  const [candidate] = candidates;

  assert.equal(candidate.last5?.games, 5);
  assert.equal(candidate.last5?.average, 80);
  assert.equal(candidate.last5?.hits, 5);
  assert.equal(candidate.last5?.hitRate, 1);
  assert.equal(candidate.last10?.games, 10);
  assert.equal(candidate.last10?.average, 55);
  assert.equal(candidate.last10?.hits, 5);
  assert.equal(candidate.last10?.hitRate, 0.5);
  assert.equal(candidate.opportunityLabel, 'pass attempts');
  assert.equal(candidate.projectedOpportunities, 7.3);
  assert.deepEqual(candidate.defense, {
    rank: 2,
    teams: 2,
    games: 10,
    averageAllowed: 55,
    season: 2026,
  });
  const shortHistory = makeFirstQuarterCandidates(
    [{ ...row('Test QB', 'player_pass_yds_q1'), line: 55.5 }],
    event,
    [stats('Test QB', 'QB', 'QB1')],
    { playerGames: playerGames.slice(0, 3), teamGames: teamGames.slice(0, 6), gameTotals: [] },
    { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' },
    NOW,
    2026,
  );
  assert.equal(shortHistory[0].defense, null);
});

test('odds-only best estimates are explicit and cannot qualify for aggressive tickets', () => {
  const rows = [
    row('Test QB', 'player_pass_yds_q1'),
    row('Test WR', 'player_reception_yds_q1'),
    row('Test RB', 'player_rush_yds_q1'),
  ];
  const candidates = makeFirstQuarterCandidates(rows, event, [
    stats('Test QB', 'QB', 'QB1'), stats('Test WR', 'WR', 'WR1'), stats('Test RB', 'RB', 'RB1'),
  ], { playerGames: [], teamGames: [], gameTotals: [] }, { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' }, NOW);
  assert.ok(candidates.every((candidate) => candidate.sample === 0 && candidate.mean === null));
  assert.ok(candidates.every((candidate) => candidate.last5 === null && candidate.last10 === null));
  assert.ok(candidates.every((candidate) => candidate.projectedOpportunities === null && candidate.defense === null));
  assert.ok(candidates.every((candidate) => Math.abs(candidate.probability - 0.5238095) < 0.001));
  const result = generateFirstQuarter(prepared(candidates),NOW);
  assert.equal(result.best.options.length, 1);
  assert.equal(result.aggressive.options.length, 0);
  assert.ok(result.aggressive.missing[0].includes('historical first-quarter games'));
});

test('one player cannot be duplicated or selected over and under in the same triple', () => {
  const candidates = makeFirstQuarterCandidates([
    row('Test QB', 'player_pass_yds_q1'),
    { ...row('Test QB', 'player_pass_yds_q1'), side: 'Under' },
    row('Test WR', 'player_reception_yds_q1'),
    row('Test RB', 'player_rush_yds_q1'),
  ], event, [
    stats('Test QB', 'QB', 'QB1'), stats('Test WR', 'WR', 'WR1'), stats('Test RB', 'RB', 'RB1'),
  ], { playerGames: [], teamGames: [], gameTotals: [] }, { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' }, NOW);
  const ticket = generateFirstQuarter(prepared(candidates),NOW).best.options[0];
  assert.equal(new Set(ticket.legs.map((leg) => leg.player)).size, 3);
  assert.equal(ticket.legs.filter((leg) => leg.player === 'Test QB').length, 1);
});

test('Q1 player markets require their designated player position when historical identity is known', () => {
  const mismatchedRows = [
    row('Test RB', 'player_pass_yds_q1'),
    row('Test WR', 'player_pass_yds_q1'),
    row('Test WR', 'player_rush_yds_q1'),
  ];
  const candidates = makeFirstQuarterCandidates(mismatchedRows, event, [
    stats('Test QB', 'QB', 'QB1'),
    stats('Test RB', 'RB', 'RB1'),
    stats('Test WR', 'WR', 'WR1'),
  ], { playerGames: [], teamGames: [], gameTotals: [] }, { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' }, NOW);
  assert.deepEqual(candidates, []);
  const roleCorrect=makeFirstQuarterCandidates([row('Test QB','player_rush_yds_q1'),row('Test RB','player_reception_yds_q1')],event,[stats('Test QB','QB','QB1'),stats('Test RB','RB','RB1')],{playerGames:[],teamGames:[],gameTotals:[]},{'Buffalo Bills':'BUF','Minnesota Vikings':'MIN'},NOW);
  assert.equal(roleCorrect.length,2,'QB rushing and RB receiving are valid market/position matches, not full-game substitutions');
  assert.deepEqual(makeFirstQuarterCandidates([row('Test QB','player_pass_yds_q1')],event,[stats('Test QB','QB','one'),stats('Test QB','QB','ambiguous')],
    {playerGames:[],teamGames:[],gameTotals:[]},{'Buffalo Bills':'BUF','Minnesota Vikings':'MIN'},NOW),[]);
});

test('future-dated Q1 quotes cannot qualify as fresh selections', () => {
  const future = { ...row('Test QB', 'player_pass_yds_q1'), updatedAt: new Date(NOW + 10 * 60_000).toISOString() };
  const candidates = makeFirstQuarterCandidates([future], event, [stats('Test QB', 'QB', 'QB1')],
    { playerGames: [], teamGames: [], gameTotals: [] }, { 'Buffalo Bills': 'BUF', 'Minnesota Vikings': 'MIN' }, NOW);
  assert.equal(candidates.length, 0);
});
