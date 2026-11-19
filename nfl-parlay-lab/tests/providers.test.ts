import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MARKETS, fetchEvents, fetchEventProps, fetchFirstQuarterMarkets, fetchFirstQuarterProps, parseProps, parseFirstQuarterProps, FIRST_QUARTER_MARKETS, FIRST_QUARTER_PLAYER_MARKETS, DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS, OddsApiError } from '../src/lib/providers/oddsApi.ts';
import { parseCsv, parseCsvColumns, toGames, toFirstQuarterStats, project, oppFactor, normName } from '../src/lib/providers/stats.ts';
import { settle } from '../src/lib/settle.ts';
import { report } from '../src/lib/backtest.ts';

const resp = (status: number, body: unknown, bad = false) => async () => ({ ok: status < 400, status, headers: { get: () => '123' }, json: async () => { if (bad) throw new Error('x'); return body; } }) as unknown as Response;

test('Odds API errors map to OddsApiError', async () => {
  await assert.rejects(fetchEvents('k', resp(401, {})), (e: any) => e instanceof OddsApiError && e.status === 401 && /authentication\/subscription/i.test(e.message) && e.code === undefined);
  await assert.rejects(fetchEvents('k', resp(429, {})), (e: any) => e.status === 429);
  await assert.rejects(fetchEvents('k', resp(200, [], true)), /Malformed/);
  await assert.rejects(fetchEvents('k', resp(200, { no: 'array' })), /Unexpected/);
  await assert.rejects(fetchEvents('k', (async () => { throw new Error('offline'); }) as unknown as typeof fetch), (e: any) => e.status === 0);
  await assert.rejects(fetchEventProps('k', 'e1', ['player_pass_yds'], resp(422, {})), /plan/);
});
test('parseProps keeps FanDuel and drops malformed outcomes', () => {
  assert.deepEqual(DEFAULT_MARKETS, [
    'player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_reception_yds', 'player_receptions',
    'player_pass_yds_alternate', 'player_pass_tds_alternate', 'player_rush_yds_alternate', 'player_rush_attempts_alternate',
    'player_reception_yds_alternate', 'player_receptions_alternate', 'player_rush_attempts', 'player_anytime_td',
  ]);
  const rows = parseProps({ bookmakers: [
    { key: 'draftkings', markets: [{ key: 'player_pass_yds', outcomes: [{ name: 'Over', description: 'A', price: -110, point: 200 }] }] },
    { key: 'fanduel', last_update: '2026-11-09T03:00:00Z', markets: [{ key: 'player_pass_yds', last_update: '2026-11-09T03:01:00Z', outcomes: [
      { name: 'Over', description: 'A B', price: -115, point: 250.5 }, { name: 'Under', description: 'A B', price: -105, point: 250.5 },
      { name: 'Over', price: -110 }, { name: 'Over', description: 'C', price: 'x' },
      { name: 'Over', description: 'Bad American price', price: -50, point: 210 },
      { name: 'Over', description: 'Bad line', price: -110, point: '210' },
    ] }, { key: 'player_pass_tds_q1', outcomes: [{ name: 'Over', description: 'QB', price: -110, point: 1.5 }] }] }] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { player: 'A B', market: 'player_pass_yds', side: 'Over', line: 250.5, odds: -115, updatedAt: '2026-11-09T03:01:00Z' });
  assert.deepEqual(parseProps({}), []);
});
test('regular event lookup exposes raw FanDuel market keys while refusing unsupported keys', async () => {
  const result = await fetchEventProps('key', 'event', ['player_pass_yds_alternate'], async () => Response.json({
    bookmakers: [{ key: 'fanduel', markets: [
      { key: 'player_pass_yds_alternate', last_update: '2026-11-09T03:01:00Z', outcomes: [
        { name: 'Over', description: 'QB One', price: -110, point: 200.5 },
      ] },
      { key: 'player_pass_yds_q1_alternate', last_update: '2026-11-09T03:01:00Z', outcomes: [
        { name: 'Over', description: 'QB One', price: -110, point: 50.5 },
      ] },
    ] }],
  }));
  assert.deepEqual(result.marketKeys, ['player_pass_yds_alternate', 'player_pass_yds_q1_alternate']);
  assert.deepEqual(result.rows.map((row) => row.market), ['player_pass_yds_alternate']);
});
test('first-quarter parser accepts only FanDuel quarter markets and never full-game markets', () => {
  assert.deepEqual(FIRST_QUARTER_MARKETS, [
    'player_pass_yds_q1', 'player_rush_yds_q1', 'player_reception_yds_q1', 'team_totals_q1', 'totals_q1',
  ]);
  const rows = parseFirstQuarterProps({ bookmakers: [
    { key: 'draftkings', markets: [{ key: 'totals_q1', outcomes: [{ name: 'Over', price: -110, point: 7.5 }] }] },
    { key: 'fanduel', markets: [
      { key: 'player_pass_yds', last_update: '2026-11-09T03:01:00Z', outcomes: [{ name: 'Over', description: 'QB One', price: -110, point: 50.5 }] },
      { key: 'player_pass_yds_q1', last_update: '2026-11-09T03:01:00Z', outcomes: [
        { name: 'Over', description: 'QB One', price: -110, point: 50.5 },
        { name: 'Under', description: 'QB One', price: -105, point: 50.5 },
        { name: 'Over', description: 'Invalid price', price: 0, point: 50.5 },
      ] },
      { key: 'totals_q1', last_update: '2026-11-09T03:01:00Z', outcomes: [
        { name: 'Over', price: -110, point: 7.5 },
        { name: 'Under', price: -110, point: 7.5 },
      ] },
    ] },
  ] });
  assert.deepEqual(rows.map(({ participant, market, side, line }) => [participant, market, side, line]), [
    ['QB One', 'player_pass_yds_q1', 'Over', 50.5],
    ['QB One', 'player_pass_yds_q1', 'Under', 50.5],
    ['Game total', 'totals_q1', 'Over', 7.5],
    ['Game total', 'totals_q1', 'Under', 7.5],
  ]);
});
test('first-quarter API request uses only explicit quarter markets and FanDuel', async () => {
  let requestUrl: URL | undefined;
  await fetchFirstQuarterProps('test-key', 'event-1', async (input) => {
    requestUrl = new URL(String(input));
    return Response.json({ bookmakers: [] });
  });
  assert.equal(requestUrl?.pathname, '/v4/sports/americanfootball_nfl/events/event-1/odds');
  assert.equal(requestUrl?.searchParams.get('bookmakers'), 'fanduel');
  assert.equal(requestUrl?.searchParams.get('markets'), FIRST_QUARTER_MARKETS.join(','));
  assert.ok(!(requestUrl?.searchParams.get('markets') ?? '').split(',').some((market) => market === 'player_pass_yds'));
});
test('first-quarter market lookup prioritizes player props and keeps totals as a separate fallback', async () => {
  const queried: string[] = [];
  const playerQuote = {
    bookmakers: [{ key: 'fanduel', markets: [{
      key: 'player_pass_yds_q1', last_update: '2026-11-09T03:01:00Z',
      outcomes: [{ name: 'Over', description: 'QB One', price: -110, point: 50.5 }],
    }, {
      key: 'totals_q1', last_update: '2026-11-09T03:01:00Z',
      outcomes: [{ name: 'Over', price: -110, point: 7.5 }],
    }] }],
  };
  const playerResult = await fetchFirstQuarterMarkets('key', 'event', async (input) => {
    const url = new URL(String(input));
    queried.push(url.searchParams.get('markets')!);
    return Response.json(playerQuote);
  });
  assert.deepEqual(queried, [DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.join(',')]);
  assert.equal(playerResult.playerStatus, 'available');
  assert.deepEqual(playerResult.playerRows.map((row) => row.market), ['player_pass_yds_q1']);
  assert.deepEqual(playerResult.requestedMarketKeys, DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS);
  assert.deepEqual(playerResult.availableMarketKeys, ['player_pass_yds_q1', 'totals_q1']);
  assert.deepEqual(playerResult.unmappedPlayerMarketKeys, []);
  assert.equal(playerResult.totalRows.length, 0);
  assert.equal(playerResult.totalStatus, 'not-requested');

  queried.length = 0;
  const fallback = await fetchFirstQuarterMarkets('key', 'event', async (input) => {
    const url = new URL(String(input));
    const markets = url.searchParams.get('markets')!;
    queried.push(markets);
    if (markets === DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.join(',')) return Response.json({ bookmakers: [] });
    if (markets === 'totals_q1') return Response.json({ bookmakers: [{
      key: 'fanduel', markets: [{ key: 'totals_q1', last_update: '2026-11-09T03:01:00Z', outcomes: [
        { name: 'Over', price: -110, point: 7.5 },
      ] }],
    }] });
    return Response.json({ bookmakers: [] });
  });
  assert.deepEqual(queried, [DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.join(','), 'team_totals_q1', 'totals_q1']);
  assert.equal(fallback.playerStatus, 'none');
  assert.equal(fallback.playerRows.length, 0);
  assert.deepEqual(fallback.requestedMarketKeys, [...DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS,'team_totals_q1','totals_q1']);
  assert.deepEqual(fallback.totalRows.map((row) => [row.market, row.participant]), [['totals_q1', 'Game total']]);
  assert.deepEqual(fallback.availableMarketKeys, ['totals_q1']);
  assert.deepEqual(fallback.unmappedPlayerMarketKeys, []);
  assert.equal(fallback.totalStatus, 'available');
});
test('known explicit first-quarter aliases become player props instead of being mistaken for unavailable markets', async () => {
  const queried: string[] = [];
  const result = await fetchFirstQuarterMarkets('key', 'event', async (input) => {
    const url = new URL(String(input));
    const markets = url.searchParams.get('markets')!;
    queried.push(markets);
    if (markets === DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.join(',')) {
      return Response.json({ bookmakers: [{
        key: 'fanduel', markets: [{ key: 'player_pass_yds_1q_alternate', last_update: '2026-11-09T03:01:00Z', outcomes: [
          { name: 'Over', description: 'QB One', price: -110, point: 45.5 },
        ] }],
      }] });
    }
    return Response.json({ bookmakers: [] });
  });
  assert.deepEqual(queried, [DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.join(',')]);
  assert.equal(result.playerStatus, 'available');
  assert.deepEqual(result.playerRows.map((row) => [row.participant, row.market, row.line]), [['QB One', 'player_pass_yds_q1', 45.5]]);
  assert.deepEqual(result.availableMarketKeys, ['player_pass_yds_1q_alternate']);
  assert.deepEqual(result.unmappedPlayerMarketKeys, []);
  assert.equal(result.totalStatus, 'not-requested');
});
test('unrecognized quarter-player keys remain diagnostic rather than being mapped to an unrelated market', async () => {
  const result = await fetchFirstQuarterMarkets('key', 'event', async (input) => {
    const markets = new URL(String(input)).searchParams.get('markets')!;
    if (markets === DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.join(',')) {
      return Response.json({ bookmakers: [{
        key: 'fanduel', markets: [{ key: 'player_pass_tds_q1', outcomes: [] }],
      }] });
    }
    return Response.json({ bookmakers: [] });
  });
  assert.equal(result.playerStatus, 'none');
  assert.deepEqual(result.unmappedPlayerMarketKeys, ['player_pass_tds_q1']);
});
test('first-quarter diagnostics distinguish plan-unsupported markets from empty successful responses', async () => {
  const empty = await fetchFirstQuarterMarkets('key', 'event', async () => Response.json({ bookmakers: [] }));
  assert.equal(empty.playerStatus, 'none');
  assert.equal(empty.totalStatus, 'none');

  const unsupported = await fetchFirstQuarterMarkets('key', 'event', async () => new Response('{}', { status: 422 }));
  assert.equal(unsupported.playerStatus, 'unsupported');
  assert.equal(unsupported.totalStatus, 'unsupported');
  assert.deepEqual(unsupported.availableMarketKeys, []);
});
test('optional Q1 requests only documented NFL player keys and does not retry unsupported keys',async()=>{
 const queried:string[]=[];
 const result=await fetchFirstQuarterMarkets('key','event',async input=>{const markets=new URL(String(input)).searchParams.get('markets')!;queried.push(markets);return markets==='player_pass_yds_q1'?new Response('{}',{status:422}):Response.json({bookmakers:[]});});
 assert.deepEqual(queried,['player_pass_yds_q1','team_totals_q1','totals_q1']);
 assert.equal(result.playerStatus,'unsupported');assert.equal(result.playerRows.length,0);assert.equal(result.totalStatus,'none');
});
test('first-quarter stats aggregate Q1 plays and scores, excluding later quarters and preseason', () => {
  const plays = parseCsv([
    'game_id,season,week,season_type,qtr,home_team,away_team,total_home_score,total_away_score,pass_attempt,complete_pass,passer_player_id,receiver_player_id,rush_attempt,rusher_player_id,yards_gained',
    '2026_01_MIN_BUF,2026,1,REG,1,MIN,BUF,7,0,1,1,QB1,WR1,0,,12',
    '2026_01_MIN_BUF,2026,1,REG,1,MIN,BUF,7,0,1,0,QB1,WR1,0,,0',
    '2026_01_MIN_BUF,2026,1,REG,1,MIN,BUF,7,3,0,0,,,1,RB1,5',
    '2026_01_MIN_BUF,2026,1,REG,2,MIN,BUF,14,3,1,1,QB1,WR1,0,,45',
    '2026_01_MIN_BUF,2026,1,PRE,1,MIN,BUF,7,0,1,1,QB1,WR1,0,,99',
  ].join('\n'));
  const rows = toFirstQuarterStats(plays, [{
    name: 'Zero Q1 RB', pos: 'RB', playerId: 'RB2', team: 'BUF', opp: 'MIN', season: 2026,
    week: 1, gameId: '2026_01_MIN_BUF', v: {},
  }, {
    name: 'Test QB', pos: 'QB', playerId: 'QB1', team: 'BUF', opp: 'MIN', season: 2026,
    week: 1, gameId: '2026_01_MIN_BUF', v: {},
  }, {
    name: 'Test Runner', pos: 'RB', playerId: 'RB1', team: 'BUF', opp: 'MIN', season: 2026,
    week: 1, gameId: '2026_01_MIN_BUF', v: {},
  }, {
    name: 'Test Receiver', pos: 'WR', playerId: 'WR1', team: 'BUF', opp: 'MIN', season: 2026,
    week: 1, gameId: '2026_01_MIN_BUF', v: {},
  }]);
  const stat = (playerId: string, market: string) => rows.playerGames.find((game) => game.playerId === playerId && game.market === market);
  assert.equal(stat('QB1', 'player_pass_yds_q1')?.value, 12);
  assert.equal(stat('QB1', 'player_pass_yds_q1')?.opportunities, 2);
  assert.equal(stat('QB1', 'player_rush_yds_q1')?.opportunities, 0);
  assert.equal(stat('RB1', 'player_rush_yds_q1')?.value, 5);
  assert.equal(stat('RB1', 'player_rush_yds_q1')?.opportunities, 1);
  assert.equal(stat('RB2', 'player_rush_yds_q1')?.value, 0);
  assert.equal(stat('WR1', 'player_reception_yds_q1')?.value, 12);
  assert.equal(stat('WR1', 'player_reception_yds_q1')?.opportunities, 2);
  assert.equal(stat('RB1', 'player_reception_yds_q1')?.opportunities, 0);
  assert.deepEqual(rows.teamGames, [
    { gameId: '2026_01_MIN_BUF', team: 'MIN', opponent: 'BUF', points: 7, season: 2026, week: 1 },
    { gameId: '2026_01_MIN_BUF', team: 'BUF', opponent: 'MIN', points: 3, season: 2026, week: 1 },
  ]);
  assert.deepEqual(rows.gameTotals, [{ gameId: '2026_01_MIN_BUF', points: 10, season: 2026, week: 1 }]);
});
test('selected-column CSV parser preserves quoting while retaining only requested fields', () => {
  const csv = 'id,description,unused\r\n1,"Receiver, Jr.",large-field\r\n2,"Line ""quoted""",other';
  assert.deepEqual(parseCsvColumns(csv, ['id', 'description']), [
    { id: '1', description: 'Receiver, Jr.' },
    { id: '2', description: 'Line "quoted"' },
  ]);
});
test('CSV parsing, projection and opponent factor', () => {
  const csv = 'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,rushing_yards\n"Smith, Jr.",RB,AAA,BBB,2026,1,REG,2026_01_BBB_AAA,smith-id,80\nJoe Doe,RB,AAA,CCC,2026,2,REG,2026_02_CCC_AAA,joe-id,40\nJoe Doe,RB,AAA,BBB,2026,3,REG,2026_03_BBB_AAA,joe-id,120\n';
  const g = toGames(parseCsv(csv));
  assert.equal(g.length, 3); assert.equal(g[0].name, 'Smith, Jr.');
  const p = project(g, 'player_rush_yds')!;
  assert.equal(p.sample, 3); assert.ok(p.mean > 60 && p.mean < 100);
  assert.equal(project([], 'player_rush_yds'), null);
  const f = oppFactor(g, 'BBB', 'RB', 'player_rush_yds');
  assert.ok(f > 1 && f <= 1.15);
  assert.equal(normName('Patrick Mahomes II'), 'patrick mahomes');
});
test('settlement refuses ambiguous matches and pushes', () => {
  const g = toGames(parseCsv('player_display_name,position,team,opponent_team,season,week,game_id,gsis_id,rushing_yards\nA B,RB,X,Y,2026,1,2026_01_Y_X,a-id,70\nA B,RB,X,Y,2026,9,2026_09_Y_X,a-id,30\nC D,RB,X,Z,2026,2,2026_02_Z_X,c-id,50\n'));
  assert.equal(settle({ player: 'A B', opp: 'Y', market: 'player_rush_yds', side: 'Over', line: 60.5 }, g), null);
  assert.equal(settle({ player: 'C D', opp: 'Z', market: 'player_rush_yds', side: 'Over', line: 49.5 }, g), 1);
  assert.equal(settle({ player: 'C D', opp: 'Z', market: 'player_rush_yds', side: 'Under', line: 49.5 }, g), 0);
  assert.equal(settle({ player: 'C D', opp: 'Z', market: 'player_rush_yds', side: 'Over', line: 50 }, g), null);
});
test('chronological settlement selects the matching player, team, opponent, and kickoff date', () => {
  const games = toGames(parseCsv([
    'player_display_name,position,team,opponent_team,season,week,game_id,gsis_id,game_date,rushing_yards',
    'A B,RB,X,Y,2026,1,2026_01_Y_X,a-id,2026-09-10,70',
    'A B,RB,X,Y,2026,9,2026_09_Y_X,a-id,2026-11-05,30',
  ].join('\n')));
  assert.equal(settle({
    player: 'A B', playerId: 'a-id', team: 'X', opp: 'Y', market: 'player_rush_yds', side: 'Over', line: 60.5,
    kickoffTs: Date.parse('2026-09-10T18:00:00Z'), season: 2026,
  }, games), 1);
  assert.equal(settle({
    player: 'A B', playerId: 'wrong-player-id', team: 'X', opp: 'Y', market: 'player_rush_yds', side: 'Over', line: 60.5,
    kickoffTs: Date.parse('2026-09-10T18:00:00Z'), season: 2026,
  }, games), null);
});
test('backtest rejects leaked rows and computes metrics', () => {
  const row = (hit: 0 | 1, snap: number, ko: number, extra = {}) => ({ pos: 'QB', market: 'player_pass_yds', side: 'Over', line: 1, odds: 100, p: 0.6, hit, snapshotTs: snap, kickoffTs: ko, ...extra });
  const r = report([row(1, 1, 2), row(0, 1, 2), row(1, 2, 2), row(1, 3, 2)]);
  assert.equal(r.n, 2); assert.equal(r.rejected, 2); assert.equal(r.legHitRate, 50); assert.equal(r.legRoiPct, 0);
  const t = [1, 2, 3, 4, 5, 6].map((i) => row(1, 1, 2, { ticketId: 't1', pos: i === 1 ? 'QB' : 'RB' }));
  const r2 = report(t);
  assert.deepEqual(r2.parlays, { n: 1, hits: 1, roiPct: 6300 });
  assert.equal(report([]).legHitRate, null);
});
test('backtest isolates above-90% calibration and warns on small or materially miscalibrated samples', () => {
  const row = (p: number, hit: 0 | 1) => ({
    pos: 'QB', market: 'player_pass_yds', side: 'Over', line: 1, odds: -110,
    p, hit, snapshotTs: 1, kickoffTs: 2,
  });
  const small = report([row(0.95, 1), row(0.9, 0)]);
  assert.deepEqual(small.highProbabilityCalibration, {
    threshold: '>90%', n: 1, hits: 1, predicted: 95, actual: 100, absoluteDifference: 5,
    warnings: ['Only 1 settled pre-kickoff forecasts above 90%; at least 30 are needed for a minimally informative calibration check.'],
  });
  const calibrated = report(Array.from({ length: 30 }, (_, index) => row(0.95, index < 28 ? 1 : 0)));
  assert.equal(calibrated.highProbabilityCalibration.n, 30);
  assert.equal(calibrated.highProbabilityCalibration.predicted, 95);
  assert.equal(calibrated.highProbabilityCalibration.actual, 93.3);
  assert.deepEqual(calibrated.highProbabilityCalibration.warnings, []);
  const miscalibrated = report(Array.from({ length: 30 }, (_, index) => row(0.95, index < 20 ? 1 : 0)));
  assert.equal(miscalibrated.highProbabilityCalibration.actual, 66.7);
  assert.match(miscalibrated.highProbabilityCalibration.warnings[0], /may be miscalibrated/);
});
test('backtest sorts forecasts chronologically and compares model probability to stored market baseline', () => {
  const row = (snapshotTs: number, kickoffTs: number, p: number, marketP: number, hit: 0 | 1) => ({
    pos: 'QB', market: 'player_pass_yds', side: 'Over', line: 1, odds: 100,
    p, marketP, marketPSource: 'no-vig', hit, snapshotTs, kickoffTs,
  });
  const result = report([
    row(3, Date.parse('2026-10-10T18:00:00Z'), 0.6, 0.5, 1),
    row(1, Date.parse('2026-09-01T18:00:00Z'), 0.4, 0.5, 0),
    row(2, Date.parse('2026-09-20T18:00:00Z'), 0.5, 0.5, 1),
  ]);
  assert.equal(result.n, 3);
  assert.equal(result.validationStatus, 'unvalidated');
  assert.ok(Math.abs(result.modelBrier! - 0.19) < 1e-12);
  assert.equal(result.marketBrier, 0.25);
  assert.equal(result.walkForward[0]?.firstKickoff, '2026-09-01T18:00:00.000Z');
  assert.equal(result.walkForward[2]?.lastKickoff, '2026-10-10T18:00:00.000Z');
});
