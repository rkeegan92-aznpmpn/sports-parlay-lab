import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEspnFallbackStats, verifyCurrentRoster } from '../src/lib/providers/espn.ts';

const roster = {
  team: { abbreviation: 'BUF' },
  athletes: [{ items: [{
    id: '100',
    fullName: 'Test QB',
    position: { abbreviation: 'QB' }, status:{type:'active'},
  }] }],
};

const summary = {
  header: {
    id: '401',
    season: { year: 2026 },
    week: { number: 4 },
    competitions: [{ date: '2026-09-20T17:00:00Z', competitors: [
      { homeAway: 'home', team: { abbreviation: 'MIN' } },
      { homeAway: 'away', team: { abbreviation: 'BUF' } },
    ] }],
  },
  boxscore: { players: [{
    team: { abbreviation: 'BUF' },
    statistics: [
      { name: 'passing', keys: ['passingYards', 'passingTouchdowns', 'completions/passingAttempts'], athletes: [
        { athlete: { id: '100', displayName: 'Test QB' }, stats: ['260', '2', '20/30'] },
      ] },
      { name: 'kickReturns', keys: ['kickReturnTouchdowns'], athletes: [
        { athlete: { id: '100' }, stats: ['1'] },
      ] },
      { name: 'puntReturns', keys: ['puntReturnTouchdowns'], athletes: [
        { athlete: { id: '100' }, stats: ['2'] },
      ] },
    ],
  }] },
};

test('ESPN fallback uses exact roster identity and verified game-summary statistics', async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/teams/buf/roster')) return Response.json(roster);
    if (url.pathname.endsWith('/teams/min/roster')) return Response.json({ team: { abbreviation: 'MIN' }, athletes: [] });
    if (url.pathname.endsWith('/athletes/100/gamelog')) {
      return Response.json(url.searchParams.get('season') === '2026'
        ? { events: {
          '401': { id: '401', gameDate: '2026-09-20T17:00:00Z', week: 4 },
          '402': { id: '402', gameDate: '2026-01-10T17:00:00Z', week: 18, eventNote: 'Wild Card' },
          '403': { id: '403', gameDate: '2026-01-17T17:00:00Z', week: 19, seasonType: { id: '3', name: 'Postseason' } },
        } }
        : { events: {} });
    }
    if (url.pathname.endsWith('/summary')) return Response.json(summary);
    throw new Error(`Unexpected ESPN request: ${url.pathname}`);
  };

  const result = await loadEspnFallbackStats([{
    key: 'test-qb',
    name: 'Test QB',
    positions: ['QB'],
    teams: ['BUF', 'MIN'],
  }], [2026, 2025], fetcher);

  const games = result.games.get('test-qb')!;
  assert.equal(result.unmatched, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.teamByLookup.get('test-qb'), 'BUF');
  assert.equal(games.length, 1);
  assert.deepEqual([games[0].name, games[0].pos, games[0].team, games[0].opp], ['Test QB', 'QB', 'BUF', 'MIN']);
  assert.deepEqual([
    games[0].v.passing_yards,
    games[0].v.passing_tds,
    games[0].v.attempts,
    games[0].v.special_teams_tds,
  ], [260, 2, 30, 3]);
  assert.ok(requests.some((request) => request.includes('/summary?event=401')));
});

test('ESPN fallback does not guess among ambiguous or missing roster names', async () => {
  let gameLogRequests = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/teams/buf/roster')) return Response.json(roster);
    if (url.pathname.endsWith('/athletes/100/gamelog')) {
      gameLogRequests++;
      return Response.json({ events: {} });
    }
    throw new Error(`Unexpected ESPN request: ${url.pathname}`);
  };
  const result = await loadEspnFallbackStats([{
    key: 'not-on-roster',
    name: 'Different Player',
    positions: ['QB'],
    teams: ['BUF'],
  }], [2026], fetcher);

  assert.equal(result.unmatched, 1);
  assert.equal(result.games.size, 0);
  assert.equal(gameLogRequests, 0);
});

test('current roster verification requires exact player, position, and team identity', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/teams/buf/roster')) return Response.json({
      ...roster,
      athletes: [{ items: [{ ...roster.athletes[0].items[0], status: { type: 'active' } }] }],
    });
    if (url.pathname.endsWith('/teams/min/roster')) return Response.json({ team: { abbreviation: 'MIN' }, athletes: [] });
    throw new Error(`Unexpected ESPN request: ${url.pathname}`);
  };
  const result = await verifyCurrentRoster([
    { key: 'valid', name: 'Test QB', position: 'QB', team: 'BUF' },
    { key: 'wrong-team', name: 'Test QB', position: 'QB', team: 'MIN' },
    { key: 'wrong-position', name: 'Test QB', position: 'WR', team: 'BUF' },
  ], fetcher);

  assert.equal(result.players.get('valid')?.team, 'BUF');
  assert.match(result.players.get('valid')?.status ?? '', /active/i);
  assert.equal(result.players.has('wrong-team'), false);
  assert.equal(result.players.has('wrong-position'), false);
  assert.equal(result.unmatched, 2);
  assert.deepEqual(result.errors, []);
});

test('ESPN roster status includes injury designations even when roster status is Active', async () => {
  const fetcher: typeof fetch = async () => Response.json({ ...roster, athletes: [{ items: [{
    ...roster.athletes[0].items[0], status: { type: 'active' }, injuries: [{ status: 'Out' }],
  }] }] });
  const result = await verifyCurrentRoster([{ key: 'qb', name: 'Test QB', position: 'QB', team: 'BUF' }], fetcher);
  assert.match(result.players.get('qb')?.status ?? '', /Out/);
});

test('quarter availability rejects injuries and unknown roster identities', async () => {
  const { verifyQuarterAvailability } = await import('../src/lib/providers/espn.ts');
  const candidate = { id: 'prop', player: 'Test QB', gameId: 'game', market: '1Q passing yards', team: 'BUF', opponent: 'MIN' } as import('../src/lib/types.ts').FirstQuarterCandidate;
  const teams = new Map([['game', ['BUF', 'MIN']]]);
  const fetcher: typeof fetch = async (input) => Response.json(String(input).includes('/buf/') ? roster : { athletes: [] });
  const good = await verifyQuarterAvailability([candidate], teams, new Map(), fetcher);
  assert.equal(good.candidates.length, 1);
  assert.equal((await verifyQuarterAvailability([candidate], teams, new Map([['BUF|test qb', 'Out']]), fetcher)).excluded, 1);
  assert.equal((await verifyQuarterAvailability([{ ...candidate, player: 'Unknown QB' }], teams, null, fetcher)).excluded, 1);
});

test('ESPN settlement requires final status and stored athlete identity, without a current roster slot', async () => {
  const { loadEspnSettlementStats } = await import('../src/lib/providers/espn.ts');
  const { settlementOutcome } = await import('../src/lib/settle.ts');
  let completed = false;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/gamelog')) return Response.json({ events: { '401': { id: '401', gameDate: '2026-09-20T17:00:00Z', week: 4 } } });
    if (url.includes('/summary')) return Response.json({ ...summary, header: { ...summary.header, competitions: summary.header.competitions.map((competition) => ({ ...competition, status: { type: { completed } } })) } });
    throw new Error('Settlement must not require current roster membership');
  };
  const request = { playerId: 'espn:100', season: 2026, kickoffTs: Date.parse('2026-09-20T17:00:00Z') };
  assert.equal((await loadEspnSettlementStats([request], fetcher)).games.length, 0);
  completed = true;
  const result = await loadEspnSettlementStats([request], fetcher);
  assert.equal(result.games.length, 1);
  const selection = { ...request, player: 'Test QB', team: 'BUF', opp: 'MIN', market: 'player_pass_yds', side: 'Over', line: 250.5 };
  assert.deepEqual(settlementOutcome(selection, result.games), { status: 'settled', hit: 1 });
  assert.deepEqual(settlementOutcome({ ...selection, line: 260 }, result.games), { status: 'push', hit: null });
  assert.equal(settlementOutcome({ ...selection, playerId: 'espn:999' }, result.games).status, 'pending');
});

test('stored ESPN event ID follows postponement and settles only a final matching game', async () => {
  const { loadEspnSettlementStats } = await import('../src/lib/providers/espn.ts');
  const { settlementOutcome } = await import('../src/lib/settle.ts');
  let completed = false;
  const fetcher: typeof fetch = async (input) => {
    assert.ok(String(input).includes('/summary?event=401'), 'stored event identity must not be rematched by the old date');
    return Response.json({ ...summary, header: { ...summary.header, competitions: summary.header.competitions.map((competition) => ({ ...competition,
      date: '2026-09-24T17:00:00Z', status: { type: { completed, name: completed ? 'STATUS_FINAL' : 'STATUS_POSTPONED' } } })) } });
  };
  const selection = { playerId: 'espn:100', season: 2026, kickoffTs: Date.parse('2026-09-20T17:00:00Z'), eventId: '401' };
  const waiting = await loadEspnSettlementStats([selection], fetcher);
  assert.equal(waiting.games.length, 0);
  assert.equal(waiting.eventStates.get('401'), 'postponed-or-cancelled');
  completed = true;
  const result = await loadEspnSettlementStats([selection], fetcher);
  assert.equal(result.games.length, 1);
  const forecast = { ...selection, gameId: '401', requireFinal: true, player: 'Test QB', team: 'BUF', opp: 'MIN', market: 'player_pass_yds', side: 'Over', line: 250.5 };
  assert.equal(settlementOutcome(forecast, result.games).hit, 1);
  assert.equal(settlementOutcome({ ...forecast, gameId: '402' }, result.games).status, 'pending');
  assert.equal(settlementOutcome({ ...forecast, line: 260 }, result.games).status, 'push');
});
