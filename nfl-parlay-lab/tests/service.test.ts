import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { DEFAULT_MARKETS } from '../src/lib/providers/oddsApi.ts';
import { loadLive, selectSchedule } from '../src/lib/service.ts';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const nflverseResponse = (url: URL, statsCsv: string): Response | undefined => {
  if (url.pathname.endsWith('/releases/tags/stats_player')) {
    return Response.json({ assets: [2026, 2025].map((year) => ({
      name: `stats_player_week_${year}.csv.gz`,
      url: `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/${year}`,
    })) });
  }
  if (url.pathname.endsWith('/releases/tags/injuries')) {
    return Response.json({ assets: [{ name: 'injuries_2026.csv.gz', url: 'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/2026' }] });
  }
  if (url.pathname.endsWith('/assets/2026') || url.pathname.endsWith('/assets/2025')) {
    return new Response(gzipSync(Buffer.from(statsCsv)));
  }
  return undefined;
};

test('all-upcoming schedule includes every future game and excludes completed games', () => {
  const events = [
    { id: 'monday', commence_time: '2026-11-10T18:00:00Z', away_team: 'A', home_team: 'B' },
    { id: 'sunday', commence_time: '2026-11-15T18:00:00Z', away_team: 'C', home_team: 'D' },
    { id: 'completed', commence_time: '2026-11-08T18:00:00Z', away_team: 'E', home_team: 'F' },
  ];
  const all = selectSchedule(events, undefined, NOW);
  assert.equal(all.selectedDate, 'ALL');
  assert.deepEqual(all.events.map((event) => event.id), ['monday', 'sunday']);
  assert.deepEqual(all.availableDates, ['2026-11-10', '2026-11-15']);
  assert.deepEqual(selectSchedule(events, '2026-11-15', NOW).events.map((event) => event.id), ['sunday']);
});

test('live scan checks every game on the selected date and reports per-game markets', async () => {
  const dateEvents = Array.from({ length: 17 }, (_, i) => ({
    id: `game-${i}`,
    commence_time: `2026-11-15T${String(14 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z`,
    away_team: 'Buffalo Bills',
    home_team: 'Minnesota Vikings',
  }));
  const events = [...dateEvents, {
    id: 'next-date',
    commence_time: '2026-11-16T18:00:00Z',
    away_team: 'Buffalo Bills',
    home_team: 'Minnesota Vikings',
  }];
  const oddsCalls: string[] = [];
  const queriedMarkets = new Set<string>();
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const dataResponse = nflverseResponse(url, 'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,passing_yards,passing_tds\nTest QB,QB,BUF,MIN,2026,1,REG,2026_01_MIN_BUF,test-qb,2026-09-10,250,2\n');
    if (dataResponse) return dataResponse;
    if (url.pathname.endsWith('/events')) return Response.json(events, { headers: { 'x-requests-remaining': '400' } });
    if (url.pathname.endsWith('/teams/buf/roster')) return Response.json({
      team: { abbreviation: 'BUF' },
      athletes: [{ items: [{ id: 'test-qb', fullName: 'Test QB', position: { abbreviation: 'QB' }, status: { type: 'active' } }] }],
    });
    if (url.pathname.includes('/events/') && url.pathname.endsWith('/odds')) {
      const eventId = url.pathname.split('/')[5];
      oddsCalls.push(eventId);
      queriedMarkets.add(url.searchParams.get('markets') ?? '');
      if (eventId === 'game-0') {
        return Response.json({ bookmakers: [{ key: 'fanduel', markets: [
          { key: 'player_pass_yds_alternate', last_update: '2026-11-09T11:00:00Z', outcomes: [
            { name: 'Over', description: 'Test QB', price: -110, point: 250.5 },
            { name: 'Under', description: 'Test QB', price: -110, point: 250.5 },
          ] },
          { key: 'player_pass_tds', last_update: '2026-11-09T11:00:00Z', outcomes: [{ name: 'Over', description: 'Test QB', price: 105, point: 1.5 }] },
          { key: 'player_rush_attempts_alternate_2', last_update: '2026-11-09T11:00:00Z', outcomes: [{ name: 'Over', description: 'Test QB', price: 105, point: 20.5 }] },
        ] }] }, { headers: { 'x-requests-remaining': '398' } });
      }
      return Response.json({ bookmakers: [] }, { headers: { 'x-requests-remaining': '398' } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const result = await loadLive({ key: 'test-key', date: '2026-11-15' }, NOW, fetcher);

  assert.equal(oddsCalls.length, 17);
  assert.ok(!oddsCalls.includes('next-date'));
  assert.deepEqual(new Set(oddsCalls), new Set(dateEvents.map((event) => event.id)));
  assert.equal(result.games.length, 17);
  assert.equal(result.selectedDate, '2026-11-15');
  assert.deepEqual(result.availableDates, ['2026-11-15', '2026-11-16']);
  assert.equal(result.games[0].status, 'available');
  assert.deepEqual(result.games[0].markets, ['player_pass_tds', 'player_pass_yds_alternate']);
  assert.deepEqual(result.games[0].unsupportedMarketKeys, ['player_rush_attempts_alternate_2']);
  assert.equal(result.games[1].status, 'none');
  assert.deepEqual(result.candidates.map((candidate) => `${candidate.market}:${candidate.side}`).sort(), [
    'player_pass_tds:Over',
    'player_pass_yds_alternate:Over',
    'player_pass_yds_alternate:Under',
  ]);
  const yards = result.candidates.filter((candidate) => candidate.market === 'player_pass_yds_alternate');
  assert.deepEqual(yards.map((candidate) => candidate.marketP), [0.5, 0.5]);
  assert.ok(yards.every((candidate) => candidate.marketPSource === 'no-vig'));
  assert.equal(result.candidates.find((candidate) => candidate.market === 'player_pass_tds')?.marketPSource, 'single-side');
  assert.ok(yards.every((candidate) => candidate.historyPlayerId === 'test-qb'));
  assert.ok(yards.every((candidate) => candidate.eventVerified && candidate.quoteVerified && candidate.historyVerified));
  assert.ok(yards.every((candidate) => candidate.gameId === 'game-0' && candidate.eventLabel === 'BUF @ MIN'));
  assert.ok(yards.every((candidate) => candidate.rosterVerified && candidate.roleSupported === false));
  assert.equal(DEFAULT_MARKETS.length, 13);
  assert.deepEqual(queriedMarkets, new Set([DEFAULT_MARKETS.join(',')]));
});

test('live scan stops odds requests after a quota-limit response', async () => {
  const events = Array.from({ length: 3 }, (_, i) => ({
    id: `game-${i}`,
    commence_time: `2026-11-15T${18 + i}:00:00Z`,
    away_team: 'Buffalo Bills',
    home_team: 'Minnesota Vikings',
  }));
  let oddsCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const dataResponse = nflverseResponse(url, 'player_display_name,position,team,opponent_team,season,week,season_type,game_id\n');
    if (dataResponse) return dataResponse;
    if (url.pathname.endsWith('/events')) return Response.json(events);
    if (url.pathname.includes('/events/') && url.pathname.endsWith('/odds')) {
      oddsCalls++;
      return Response.json({}, { status: 429 });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const result = await loadLive({ key: 'test-key', date: '2026-11-15' }, NOW, fetcher);

  assert.equal(oddsCalls, 1);
  assert.deepEqual(result.games.map((game) => game.status), ['error', 'not-scanned', 'not-scanned']);
});

test('live player props use verified ESPN history when nflverse has no matching player row', async () => {
  const event = {
    id: 'fallback-game',
    commence_time: '2026-11-10T18:00:00Z',
    away_team: 'Buffalo Bills',
    home_team: 'Minnesota Vikings',
  };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const dataResponse = nflverseResponse(
      url,
      'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,passing_yards,passing_tds\n',
    );
    if (dataResponse) return dataResponse;
    if (url.pathname.endsWith('/events/fallback-game/odds')) {
      return Response.json({ bookmakers: [{ key: 'fanduel', markets: [{
        key: 'player_pass_yds', last_update: '2026-11-09T11:00:00Z', outcomes: [
          { name: 'Over', description: 'Test QB', price: -110, point: 250.5 },
        ],
      }] }] });
    }
    if (url.pathname.endsWith('/teams/buf/roster')) return Response.json({
      team: { abbreviation: 'BUF' },
      athletes: [{ items: [{
        id: '100', fullName: 'Test QB', position: { abbreviation: 'QB' }, status: { type: 'active' },
      }] }],
    });
    if (url.pathname.endsWith('/teams/min/roster')) return Response.json({ team: { abbreviation: 'MIN' }, athletes: [] });
    if (url.pathname.endsWith('/athletes/100/gamelog')) {
      return Response.json(url.searchParams.get('season') === '2026'
        ? { events: { '401': { id: '401', gameDate: '2026-09-20T17:00:00Z', week: 4 } } }
        : { events: {} });
    }
    if (url.pathname.endsWith('/summary')) return Response.json({
      header: {
        id: '401', season: { year: 2026 }, week: { number: 4 },
        competitions: [{ date: '2026-09-20T17:00:00Z', competitors: [
          { homeAway: 'home', team: { abbreviation: 'MIN' } },
          { homeAway: 'away', team: { abbreviation: 'BUF' } },
        ] }],
      },
      boxscore: { players: [{
        team: { abbreviation: 'BUF' },
        statistics: [{ name: 'passing', keys: ['passingYards', 'passingTouchdowns', 'completions/passingAttempts'], athletes: [
          { athlete: { id: '100', displayName: 'Test QB' }, stats: ['260', '2', '20/30'] },
        ] }],
      }] },
    });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const result = await loadLive({ key: 'test-key', date: '2026-11-10' }, NOW, fetcher, {
    events: [event],
    remaining: '100',
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, 'Test QB');
  assert.equal(result.candidates[0].historySource, 'espn');
  assert.ok(result.candidates[0].eventVerified && result.candidates[0].quoteVerified && result.candidates[0].historyVerified);
  assert.equal(result.candidates[0].sample, 1);
  assert.equal(result.candidates[0].mean, 260);
  assert.equal(result.diagnostics.espnFallbackLookups, 1);
  assert.equal(result.diagnostics.espnFallbackMatches, 1);
  assert.equal(result.diagnostics.noStats, 0);
  assert.ok(!result.notes.some((note) => note.includes('no verified historical player statistics')));
});

test('nflverse history whose game ID disagrees with its teams is excluded', async () => {
  const event = {
    id: 'mismatch-game',
    commence_time: '2026-11-10T18:00:00Z',
    away_team: 'Buffalo Bills',
    home_team: 'Minnesota Vikings',
  };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const dataResponse = nflverseResponse(
      url,
      'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,passing_yards,passing_tds\nTest QB,QB,BUF,MIN,2026,1,REG,2026_01_LV_NE,test-qb,260,2\n',
    );
    if (dataResponse) return dataResponse;
    if (url.pathname.endsWith('/events/mismatch-game/odds')) return Response.json({ bookmakers: [{
    key: 'fanduel', markets: [{ key: 'player_pass_yds', last_update: '2026-11-09T11:00:00Z', outcomes: [
      { name: 'Over', description: 'Test QB', price: -110, point: 250.5 },
      { name: 'Over', description: 'Test QB', price: -110, point: 250.5 },
    ] }],
    }] });
    if (/\/teams\/(buf|min)\/roster$/.test(url.pathname)) return new Response('{}', { status: 404 });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const result = await loadLive({ key: 'test-key', date: '2026-11-10' }, NOW, fetcher, {
    events: [event],
    remaining: '100',
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.diagnostics.noStats, 2);
  assert.ok(result.notes.some((note) => note.includes('no verified historical player statistics')));
  assert.deepEqual(result.pipelineRejections, [{
    player: 'Test QB',
    market: 'player_pass_yds',
    side: 'Over',
    line: 250.5,
    gameId: 'mismatch-game',
    eventLabel: 'BUF @ MIN',
    kickoff: event.commence_time,
    reason: 'No unique verified player history from nflverse or ESPN.',
    count: 2,
  }]);
});
