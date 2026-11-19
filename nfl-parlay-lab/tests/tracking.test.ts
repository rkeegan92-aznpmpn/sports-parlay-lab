import { liveCacheKey } from '../src/server/credentials.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { gzipSync } from 'node:zlib';
import { SCHEMA } from '../src/server/db.ts';
import { loadLive, refreshCandidateHistory } from '../src/lib/service.ts';
import { eligible, generate } from '../src/lib/optimizer.ts';
import { MODEL_VERSION, scoreAll } from '../src/lib/model.ts';
import { recordForecasts, updateValidation, evaluationRows, trackingStatus, calibrationSnapshot } from '../src/server/tracking.ts';
import { loadStats } from '../src/lib/providers/stats.ts';

// Synthetic provider fixtures only: never used as application data.
const NOW = Date.parse('2026-11-09T12:00:00Z');
const kickoff = '2026-11-15T18:00:00Z';
const players = [
  ['QB One', 'QB', 'BUF', 'MIN', 'player_pass_yds', 'g1'],
  ['RB One', 'RB', 'BUF', 'MIN', 'player_rush_yds', 'g1'],
  ['WR One', 'WR', 'MIN', 'BUF', 'player_reception_yds', 'g1'],
  ['RB Two', 'RB', 'SEA', 'LAR', 'player_rush_yds', 'g2'],
  ['WR Two', 'WR', 'LAR', 'SEA', 'player_reception_yds', 'g2'],
  ['TE One', 'TE', 'SEA', 'LAR', 'player_reception_yds', 'g2'],
  ['RB Aggressive', 'RB', 'SEA', 'LAR', 'player_rush_yds', 'g2'],
];
const header = 'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,passing_yards,passing_tds,passing_attempts,rushing_attempts,rushing_yards,receptions,targets,receiving_yards';
const canonical = (team: string) => team === 'LAR' ? 'LA' : team;
const csvRow = (player: string[], week: number, date: string, value: number) => {
  const [name, pos, team, opp] = player;
  return `${name},${pos},${team},${opp},2026,${week},REG,2026_${String(week).padStart(2, '0')}_${[canonical(team), canonical(opp)].sort().join('_')},id-${name},${date},${value},2,25,10,${value},8,10,${value}`;
};
let finalResults = false;
let traded = false;
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (/games\.csv(?:\.gz)?$/.test(url.pathname)) return new Response(gzipSync(Buffer.from('game_id,season,week,game_type,gameday,home_team,away_team,home_score,away_score,espn\n' + ['2026_10_BUF_MIN,2026,10,REG,2026-11-15,MIN,BUF,', '2026_10_LA_SEA,2026,10,REG,2026-11-15,SEA,LA,'].map((row) => row + (finalResults ? '21,20,' : ',,')).join('\n'))));
  if (url.pathname.endsWith('/releases/tags/stats_player')) return Response.json({ assets: [2026, 2025].map((year) => ({ name: `stats_player_week_${year}.csv.gz`, url: `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/${year}` })) });
  if (url.pathname.endsWith('/releases/tags/injuries')) return Response.json({ assets: [{ name: 'injuries_2026.csv.gz', url: 'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/injuries' }] });
  if (url.pathname.endsWith('/assets/injuries')) return new Response(gzipSync(Buffer.from('full_name,team,week,report_status\n')));
  if (url.pathname.endsWith('/assets/2025')) return new Response(gzipSync(Buffer.from(header + '\n')));
  if (url.pathname.endsWith('/assets/2026')) {
    const rows = players.flatMap((player) => Array.from({ length: 6 }, (_, i) => csvRow(traded && player[0] === 'QB One' ? [player[0], player[1], 'JAX', 'TEN', player[4], player[5]] : player, i + 1, `2026-10-${String(i + 1).padStart(2, '0')}`, player[0] === 'RB Aggressive' && i < 2 ? 10 : 100)));
    if (finalResults) rows.push(...players.map((player) => csvRow(player, 10, '2026-11-15', 100)));
    return new Response(gzipSync(Buffer.from([header, ...rows].join('\n'))));
  }
  if (url.pathname.endsWith('/events')) return Response.json([
    { id: 'g1', commence_time: kickoff, away_team: 'Buffalo Bills', home_team: 'Minnesota Vikings' },
    { id: 'g2', commence_time: kickoff, away_team: 'Los Angeles Rams', home_team: 'Seattle Seahawks' },
  ]);
  if (url.pathname.endsWith('/roster')) {
    const slug = url.pathname.split('/').at(-2)!;
    const team = slug === 'lar' ? 'LAR' : slug.toUpperCase();
    return Response.json({ team: { abbreviation: team }, athletes: [{ items: players.filter((player) => player[2] === team).map((player) => ({ id: `espn-${player[0]}`, fullName: player[0], position: { abbreviation: player[1] }, status: { type: 'active' } })) }] });
  }
  if (url.pathname.endsWith('/odds')) {
    const event = url.pathname.split('/').at(-2);
    return Response.json({ bookmakers: [{ key: 'fanduel', markets: players.filter((player) => player[5] === event).map((player) => ({
      key: player[4], last_update: new Date(NOW).toISOString(), outcomes: [
        { name: 'Over', description: player[0], point: 50.5, price: player[0] === 'RB Aggressive' ? 190 : -110 },
        { name: 'Under', description: player[0], point: 50.5, price: -110 },
      ],
    })) }] });
  }
  throw new Error(`Unexpected fixture URL ${url.pathname}`);
};

test('live matching -> separate TEST MODE six-picks -> pregame capture -> real-result settlement', async () => {
  finalResults = false;
  const data = await loadLive({ key: 'fixture-only' }, NOW, fetcher);
  assert.equal(data.candidates.length, 14);
  assert.ok(data.candidates.every((candidate) => candidate.roleSupported && candidate.rosterVerified));
  assert.ok(data.candidates.filter((candidate) => candidate.pos === 'QB').every((candidate) => candidate.roleGames === 5));
  const research = generate(data.candidates, NOW, { testMode: true });
  assert.ok(research.best.options.length > 0);
  assert.ok(research.aggr.options.length > 0);
  const best = research.best.options[0], aggressive = research.aggr.options[0];
  assert.ok(aggressive.decimal > best.decimal);
  assert.notDeepEqual(best.legs.map((leg) => leg.id).sort(), aggressive.legs.map((leg) => leg.id).sort());
  for (const ticket of [best, aggressive]) {
    assert.deepEqual(['QB', 'RB', 'WR', 'TE'].map((pos) => ticket.legs.filter((leg) => leg.pos === pos).length), [1, 2, 2, 1]);
    assert.equal(ticket.purpose, 'test-research');
  }
  assert.equal(generate(data.candidates, NOW).best.options.length, 0);
  const db = new Database(':memory:'); db.exec(SCHEMA);
  try {
    assert.equal(recordForecasts(db, data.candidates, NOW), 14);
    assert.equal(recordForecasts(db, data.candidates, NOW + 1), 0);
    assert.equal(recordForecasts(db, data.candidates, Date.parse(kickoff) + 1), 0);
    const before = await updateValidation(db, fetcher, NOW);
    assert.equal(before.n, 0); assert.equal(before.tracking.upcoming, 14);
    finalResults = true;
    const after = await updateValidation(db, fetcher, Date.parse(kickoff) + 8 * 3600_000);
    assert.equal(after.n, 14);
    assert.equal(after.tracking.awaitingResults, 0);
    assert.equal(after.validationStatus, 'unvalidated');
    assert.ok(after.validationWarnings.some((warning) => warning.includes('200')));
    const newStats = await loadStats(2026, fetcher);
    const qbGame = newStats.find((game) => game.name === 'QB One')!;
    newStats.push({ ...qbGame, week: 7, gameId: '2026_07_BUF_MIN', gameDate: '2026-10-30T00:00:00Z' });
    const refreshed = scoreAll(refreshCandidateHistory(data.candidates, newStats, new Map(), 2026, NOW), NOW);
    assert.equal(refreshed.find((candidate) => candidate.name === 'QB One')?.verification?.history.gameIds.length, 7);
    assert.equal(eligible('best', refreshed.find((candidate) => candidate.name === 'QB One' && candidate.side === 'Over')!, NOW), true);
    assert.ok(refreshed.every((candidate) => candidate.verification?.history.gameIds.join() === candidate.history?.last10?.results.map((result) => result.gameId).join()));
    // A refreshed price is another quote, not another validation trial.
    const first = db.prepare('SELECT * FROM forecast_snapshots LIMIT 1').get() as Record<string, unknown>;
    db.prepare(`INSERT INTO forecast_snapshots (model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,hit,settlement_status,result_game_id,result_source,result_date,result_kickoff_ts)
      SELECT model_version,snapshot_ts+1,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds+1,odds_at,p,market_p,market_p_source,hit,settlement_status,result_game_id,result_source,result_date,result_kickoff_ts FROM forecast_snapshots WHERE id=?`).run(first.id);
    assert.equal(evaluationRows(db).length, 14);
    assert.equal(trackingStatus(db, NOW).captured, 15);
  } finally { db.close(); finalResults = false; }
});

test('a traded player retains verified nflverse history only after unique current-roster matching', async () => {
  traded = true;
  try {
    const data = await loadLive({ key: 'fixture-only' }, NOW, fetcher);
    const qb = data.candidates.find((candidate) => candidate.name === 'QB One');
    assert.ok(qb);
    assert.equal(qb.team, 'BUF');
    assert.equal(qb.historySource, 'nflverse');
    assert.ok(qb.history?.last10?.results.every((result) => result.team === 'JAX'));
    assert.equal(qb.rosterVerified, true);
    assert.equal(data.diagnostics.espnFallbackLookups, 0);
  } finally { traded = false; }
});

test('cached live responses capture forecasts even when no ticket has been selected', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const directory = mkdtempSync(path.join(tmpdir(), 'parlay-cached-tracking-'));
  const oldPath = process.env.DB_PATH, oldKey = process.env.ODDS_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DB_PATH = path.join(directory, 'tracking.db');
  process.env.ODDS_API_KEY = 'fixture-only';
  const { getDb } = await import('../src/server/db.ts');
  const { getData } = await import('../src/server/load.ts');
  const db = getDb();
  try {
    const data = await loadLive({ key: 'fixture-only' }, NOW, fetcher);
    const now = Date.now(), ko = new Date(now + 3 * 864e5).toISOString(), updated = new Date(now).toISOString();
    data.games = data.games.map((game) => ({ ...game, kickoff: ko }));
    data.candidates = scoreAll(data.candidates.map((candidate) => ({ ...candidate, kickoff: ko, oddsAt: updated,
      verification: { ...candidate.verification!, event: { ...candidate.verification!.event, kickoff: ko }, quote: { ...candidate.verification!.quote, updatedAt: updated } } })), now);
    db.prepare('INSERT INTO cache (key,value,fetched_at) VALUES (?,?,?)').run(`${liveCacheKey(process.env.ODDS_API_KEY!)}:${MODEL_VERSION}`, JSON.stringify(data), now);
    globalThis.fetch = async (input) => {
      assert.ok(String(input).endsWith(`/events?apiKey=fixture-only`), 'cache hit must not re-request paid odds');
      return Response.json(data.games.map((game) => ({ id: game.id, commence_time: ko,
        away_team: game.id === 'g1' ? 'Buffalo Bills' : 'Los Angeles Rams',
        home_team: game.id === 'g1' ? 'Minnesota Vikings' : 'Seattle Seahawks' })));
    };
    await getData(); await getData();
    assert.equal(trackingStatus(db).captured, 14);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    if (oldPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = oldPath;
    if (oldKey === undefined) delete process.env.ODDS_API_KEY; else process.env.ODDS_API_KEY = oldKey;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('regular generators unlock only after all unchanged calibration requirements pass', async () => {
  // Synthetic test calibration records demonstrate the gate; never installed as application history.
  const { validationDashboard } = await import('../src/server/validationDashboard.ts');
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const insert = db.prepare(`INSERT INTO forecast_snapshots
    (model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,hit,settlement_status,event_id,result_game_id,result_source,result_date,result_kickoff_ts)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const data = await loadLive({ key: 'fixture-only' }, NOW, fetcher);
  try {
    for (let i=0; i<200; i++) {
      const ko = Date.parse('2026-09-01T18:00:00Z') + Math.floor(i/25)*864e5;
      const pos = ['QB','RB','RB','WR','WR','TE'][i%6];
      insert.run(MODEL_VERSION, ko-3600_000, ko, 2026, `Calibration Fixture ${i}`, `fixture-${i}`, 'nflverse', 'BUF','MIN',pos,
        pos==='QB'?'player_pass_yds':pos==='RB'?'player_rush_yds':'player_reception_yds', 'Over',50.5,-110,new Date(ko-3600_000).toISOString(),.8,.5,'no-vig',i%5===0?0:1,'settled',`fixture-event-${i}`,`fixture-result-${i}`,'nflverse',new Date(ko).toISOString().slice(0,10),ko);
      if (i===198) {
        const insufficient=validationDashboard(db,NOW);
        const gate = insufficient.validationStatus==='validated';
        assert.equal(insufficient.n,199);
        assert.equal(insufficient.validationStatus,'unvalidated');
        assert.equal(generate(data.candidates,NOW,{modelValidated:gate}).best.options.length,0);
      }
    }
    const supported=validationDashboard(db,NOW);
    assert.equal(supported.n,200);
    assert.equal(supported.validationStatus,'validated');
    assert.ok(supported.validationProgress.every((item)=>item.met));
    const tickets=generate(data.candidates,NOW,{modelValidated:supported.validationStatus==='validated'});
    assert.ok(tickets.best.options.length>0 && tickets.aggr.options.length>0);
    assert.ok(tickets.aggr.options[0].decimal>tickets.best.options[0].decimal);
    for (const ticket of [tickets.best.options[0],tickets.aggr.options[0]]) {
      assert.deepEqual(['QB','RB','WR','TE'].map((pos)=>ticket.legs.filter((leg)=>leg.pos===pos).length),[1,2,2,1]);
      assert.ok([...new Set(ticket.legs.map((leg)=>leg.gameId))].every((id)=>ticket.legs.filter((leg)=>leg.gameId===id).length<=3));
    }
    db.prepare("UPDATE forecast_snapshots SET result_date='2026-09-01',kickoff_ts=?").run(Date.parse('2026-09-01T18:00:00Z'));
    assert.equal(validationDashboard(db,NOW).validationStatus,'unvalidated'); // 200 records alone never satisfy the date gate.
  } finally { db.close(); }
});

test('capture records event identity and quote provenance and never backdates a slow retrieval', async () => {
  const { captureForecasts }=await import('../src/server/tracking.ts');
  const data=await loadLive({key:'fixture-only'},NOW,fetcher);
  const db=new Database(':memory:');db.exec(SCHEMA);
  try {
    assert.equal(await captureForecasts(db,data.candidates,fetcher,NOW),14);
    const row=db.prepare('SELECT event_id,result_game_id,history_player_id,snapshot_ts,odds_at,market,line,odds FROM forecast_snapshots LIMIT 1').get() as Record<string,unknown>;
    assert.equal(row.event_id,'g1');assert.equal(row.result_game_id,'2026_10_BUF_MIN');
    assert.equal(row.history_player_id,'id-QB One');assert.equal(row.snapshot_ts,NOW);
    assert.equal(row.odds_at,new Date(NOW).toISOString());assert.equal(row.market,'player_pass_yds');
    assert.equal(row.line,50.5);assert.equal(row.odds,-110);
    db.exec('DELETE FROM forecast_snapshots');
    const clock=Date.now;
    try {
      Date.now=()=>NOW;
      const slow:typeof fetch=async(input,init)=>{Date.now=()=>Date.parse(kickoff)+1;return fetcher(input,init);};
      assert.equal(await captureForecasts(db,data.candidates,slow),0);
    } finally {Date.now=clock;}
  } finally {db.close();}
});


test('pregame generation uses read-only calibration snapshot with zero settled outcomes and no final-result access', async () => {
  finalResults = false;
  const data = await loadLive({key:'fixture-only'}, NOW, fetcher);
  const db = new Database(':memory:'); db.exec(SCHEMA);
  try {
    recordForecasts(db, data.candidates, NOW);
    const changes = db.prepare('SELECT total_changes() AS n').get();
    const calibration = calibrationSnapshot(db, NOW);
    assert.equal(calibration.n, 0);
    assert.equal(calibration.validationStatus, 'unvalidated');
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(), changes, 'status read does not settle or alter forecasts');
    const tickets = generate(data.candidates, NOW, {pregameResearch:true, modelValidated:false});
    assert.ok(tickets.best.options.length);
    assert.ok(tickets.aggr.options.length);
    assert.equal(tickets.best.options[0].purpose, 'pregame-research');
    assert.equal(calibrationSnapshot(db, NOW).n, 0, 'ticket generation never manufactures calibration');
  } finally { db.close(); }
});
