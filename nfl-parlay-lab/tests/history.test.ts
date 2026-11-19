import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { defenseMatchup, fetchText, playerHistory, parseCsv, project, toGames } from '../src/lib/providers/stats.ts';

const csv = (rows: string[]) => parseCsv([
  'player_display_name,position,team,opponent_team,season,week,season_type,game_id,passing_yards,passing_tds,carries,rushing_yards,receptions,targets,receiving_yards,rushing_tds,receiving_tds,special_teams_tds,gsis_id,game_date',
  ...rows.map((row) => `${row},${row.split(',')[0].replace(/\W/g, '')},${row.split(',')[4]}-09-01`),
].join('\n'));

test('nflverse release downloads use compressed GitHub assets and transparently decompress them', async () => {
  const content = 'player_display_name,position,team,opponent_team,season,week,season_type,game_id,rushing_yards\nTest Runner,RB,AAA,BBB,2025,1,REG,2025_01_BBB_AAA,42\n';
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/releases/tags/stats_player')) {
      return Response.json({ assets: [{ name: 'stats_player_week_2025.csv.gz', url: 'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/123' }] });
    }
    if (url.endsWith('/releases/assets/123')) {
      assert.equal(new Headers(init?.headers).get('Accept'), 'application/octet-stream');
      assert.equal(new Headers(init?.headers).get('x-nflverse-cache-name'), 'asset:stats_player_week_2025.csv.gz');
      return new Response(gzipSync(Buffer.from(content)));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const text = await fetchText('https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv', fetcher);

  assert.equal(text, content);
  assert.equal(calls.length, 2);
});

test('nflverse downloads retry transient gateway failures', async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts++;
    return attempts === 1 ? new Response('gateway timeout', { status: 504 }) : new Response('a,b\n1,2\n');
  };

  assert.equal(await fetchText('https://stats.example.test/data.csv', fetcher), 'a,b\n1,2\n');
  assert.equal(attempts, 2);
});

test('nflverse downloads abort requests that exceed the timeout', async () => {
  const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  await assert.rejects(fetchText('https://stats.example.test/data.csv', fetcher, 5), /Timed out downloading/);
});

test('historical windows use actual game rows, report 5/10-game metrics, and skip pushes', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    `Test Receiver,WR,AAA,BBB,2025,${i + 1},REG,2025_${String(i + 1).padStart(2, '0')}_BBB_AAA,0,0,0,0,${i + 1},${i + 1},${(i + 1) * 10},0,0,0`,
  );
  const games = toGames(csv(rows));
  const history = playerHistory(games, 'player_reception_yds', 'Over', 50);

  assert.equal(history.last5?.games, 5);
  assert.equal(history.last5?.average, 80);
  assert.equal(history.last5?.median, 80);
  assert.equal(history.last5?.hits, 5);
  assert.equal(history.last5?.hitGames, 5);
  assert.equal(history.last10?.games, 10);
  assert.equal(history.last10?.average, 55);
  assert.equal(history.homeAverage, 55);
  assert.equal(history.awayAverage, null);
});

test('last-10 window reports available games even when fewer than ten exist', () => {
  const games = toGames(csv([
    'Test Receiver,WR,AAA,BBB,2025,1,REG,2025_01_BBB_AAA,0,0,0,0,1,1,10,0,0,0',
    'Test Receiver,WR,AAA,BBB,2025,3,REG,2025_03_AAA_BBB,0,0,0,0,2,2,20,0,0,0',
    'Test Receiver,WR,AAA,BBB,2025,4,REG,2025_04_BBB_AAA,0,0,0,0,3,3,30,0,0,0',
  ]));
  const history = playerHistory(games, 'player_reception_yds', 'Over', 20);

  assert.equal(history.last5?.games, 3);
  assert.equal(history.last5?.hits, 1);
  assert.equal(history.last5?.hitGames, 2);
  assert.equal(history.last10?.games, 3);
});

test('recent role usage and snap counts use only source-provided game values', () => {
  const games = toGames(parseCsv([
    'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,receiving_yards,targets,carries,offense_snaps',
    'Test Receiver,WR,AAA,BBB,2025,1,REG,2025_01_BBB_AAA,player-1,2025-09-01,10,3,0,40',
    'Test Receiver,WR,AAA,CCC,2025,2,REG,2025_02_CCC_AAA,player-1,2025-09-08,0,0,0,',
    'Test Receiver,WR,AAA,DDD,2025,3,REG,2025_03_DDD_AAA,player-1,2025-09-15,20,5,0,50',
    'Test Receiver,WR,AAA,EEE,2025,4,REG,2025_04_EEE_AAA,player-1,2025-09-22,5,1,0,30',
  ].join('\n')));
  const history = playerHistory(games, 'player_reception_yds', 'Over', 10);

  assert.equal(history.roleGames, 3);
  assert.equal(history.opportunityAverage, 2.25);
  assert.equal(history.snapAverage, 40);
  assert.deepEqual(history.snapCounts, [40, 50, 30]);
  assert.equal(history.playingTime, 'nflverse');
});

test('missing player identity, game identity, or market category is not turned into zero-stat history', () => {
  const games = toGames(parseCsv([
    'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,rushing_yards',
    'Test Runner,RB,BUF,MIN,2025,1,REG,,,42',
  ].join('\n')));

  assert.equal(games[0].gameId, '');
  assert.equal(games[0].playerId, undefined);
  assert.equal(project(games, 'player_rush_yds'), null);
  assert.equal(project([{ ...games[0], gameId: '2025_01_MIN_BUF', playerId: 'gsis-test' }], 'player_pass_yds'), null);
});

test('defensive matchup rank is only reported with at least four completed games', () => {
  const rows: string[] = [];
  for (let week = 1; week <= 4; week++) {
    rows.push(`Receiver A,WR,AAA,BBB,2026,${week},REG,2026_${week}_BBB_AAA,0,0,0,0,1,2,100,0,0,0`);
    rows.push(`Receiver B,WR,CCC,DDD,2026,${week},REG,2026_${week}_DDD_CCC,0,0,0,0,1,2,20,0,0,0`);
  }
  const games = toGames(csv(rows));

  assert.equal(defenseMatchup(games, 2026, 'BBB', 'WR', 'player_reception_yds')?.rank, 2);
  assert.equal(defenseMatchup(games, 2026, 'DDD', 'WR', 'player_reception_yds')?.rank, 1);
  assert.equal(defenseMatchup(games.slice(0, 3), 2026, 'BBB', 'WR', 'player_reception_yds'), null);
});
test('opponent matchup summaries exclude games played after the forecast cutoff', () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) =>
      `Player A,WR,AAA,BBB,2026,${index + 1},REG,2026_${String(index + 1).padStart(2, '0')}_BBB_AAA,0,0,0,0,1,1,100,0,0,0,player-a,2026-09-0${index + 1}`,
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      `Player A,WR,AAA,CCC,2026,${index + 5},REG,2026_${String(index + 5).padStart(2, '0')}_CCC_AAA,0,0,0,0,1,1,10,0,0,0,player-a,2026-11-0${index + 1}`,
    ),
  ];
  const games = toGames(parseCsv([
    'player_display_name,position,team,opponent_team,season,week,season_type,game_id,passing_yards,passing_tds,carries,rushing_yards,receptions,targets,receiving_yards,rushing_tds,receiving_tds,special_teams_tds,gsis_id,game_date',
    ...rows,
  ].join('\n')));
  const cutoff = Date.parse('2026-10-01T00:00:00Z');

  assert.equal(defenseMatchup(games, 2026, 'CCC', 'WR', 'player_reception_yds', cutoff), null);
  assert.equal(defenseMatchup(games, 2026, 'CCC', 'WR', 'player_reception_yds')?.games, 4);
});

test('nflverse release downloads fall back to public assets when manifest access fails', async () => {
  const fetcher: typeof fetch = async (input) => String(input).includes('/releases/tags/')
    ? new Response('rate limited', { status: 403 })
    : new Response(gzipSync(Buffer.from('a,b\n1,2\n')));
  assert.equal(await fetchText('https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv', fetcher), 'a,b\n1,2\n');
});

test('a newer blank injury report clears an older designation', async () => {
  const { loadInjuries } = await import('../src/lib/providers/stats.ts');
  const fetcher: typeof fetch = async (input) => String(input).includes('/releases/tags/')
    ? Response.json({ assets: [] })
    : new Response('full_name,team,week,report_status\nTest QB,BUF,1,Out\nTest QB,BUF,2,\n');
  const result = await loadInjuries(2026, fetcher);
  assert.equal(result.get('BUF|test qb'), '');
});

test('weekly player history joins only unique real schedule games without guessing conflicts', async () => {
  const { attachSchedule } = await import('../src/lib/providers/stats.ts');
  const game = { name: 'Test QB', pos: 'QB', playerId: 'p1', team: 'BUF', opp: 'MIN', season: 2026, week: 8, gameId: '', v: {} };
  const row = { game_id: '2026_08_BUF_MIN', game_type: 'REG', season: '2026', week: '8', home_team: 'MIN', away_team: 'BUF', gameday: '2026-11-01' };
  const joined = attachSchedule([game], [row])[0];
  assert.equal(joined.gameId, row.game_id);
  assert.equal(joined.gameDate, '2026-11-01T00:00:00.000Z');
  assert.equal(joined.location, 'away');
  assert.equal(attachSchedule([game], [row, row])[0].gameId, '');
  assert.equal(attachSchedule([{ ...game, gameId: 'conflicting-id' }], [row])[0].gameDate, undefined);
  assert.equal(attachSchedule([game], [{ ...row, away_team: 'SEA' }])[0].gameId, '');
});

test('old injury designations do not persist after a team publishes a later reporting week', async () => {
  const { loadInjuries } = await import('../src/lib/providers/stats.ts');
  const fetcher: typeof fetch = async (input) => String(input).includes('/releases/tags/')
    ? Response.json({ assets: [] })
    : new Response('full_name,team,week,report_status\nReturned Player,BUF,1,Out\nCurrent Player,BUF,2,Questionable\nOther Team Player,MIN,1,Out\n');
  const statuses = await loadInjuries(2026, fetcher);
  assert.equal(statuses.has('BUF|returned player'), false); // Unknown this week, not asserted healthy.
  assert.equal(statuses.get('BUF|current player'), 'Questionable');
  assert.equal(statuses.get('MIN|other team player'), 'Out');
});
