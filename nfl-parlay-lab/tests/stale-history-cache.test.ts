import { liveCacheKey } from '../src/server/credentials.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getData } from '../src/server/load.ts';
import { getDb } from '../src/server/db.ts';
import { currentSeason, type LoadResult } from '../src/lib/service.ts';
import { MODEL_VERSION } from '../src/lib/model.ts';

test('cached historical-provider failures refresh player history without requesting per-game odds', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-parlay-history-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const oldEnv = {
    DB_PATH: process.env.DB_PATH,
    ODDS_API_KEY: process.env.ODDS_API_KEY,
    ODDS_CACHE_MIN: process.env.ODDS_CACHE_MIN,
  };
  process.env.DB_PATH = dbPath;
  process.env.ODDS_API_KEY = 'test-key';
  process.env.ODDS_CACHE_MIN = '30';
  const now = Date.now();
  const season = currentSeason(new Date(now));
  const event = {
    id: 'upcoming-game',
    commence_time: new Date(now + 2 * 864e5).toISOString(),
    away_team: 'Buffalo Bills',
    home_team: 'Miami Dolphins',
  };
  const csvHeader = 'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,passing_yards,passing_tds,attempts,carries,rushing_yards,receptions,targets,receiving_yards,rushing_tds,receiving_tds,special_teams_tds';
  const currentRows = [200, 210, 220, 230, 240].map((yards, index) =>
    `Josh Allen,QB,BUF,MIA,${season},${index + 1},REG,${season}_${String(index + 1).padStart(2, '0')}_MIA_BUF,josh-allen,${season}-09-01,${yards},2,30,3,10,0,0,0,0,0,0`,
  );
  const statsCsv = [csvHeader, ...currentRows, `Josh Allen,QB,BUF,MIA,${season - 1},18,REG,${season - 1}_18_MIA_BUF,josh-allen,${season - 1}-12-01,250,2,30,2,8,0,0,0,0,0,0`].join('\n');
  const injuriesCsv = 'full_name,team,week,report_status\nJosh Allen,BUF,1,Questionable\n';
  let perGameOddsRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.the-odds-api.com' && url.pathname.endsWith('/events')) {
      return Response.json([event], { headers: { 'x-requests-remaining': '99' } });
    }
    if (url.hostname === 'api.the-odds-api.com' && url.pathname.endsWith('/odds')) {
      perGameOddsRequests++;
      return Response.json({ bookmakers: [] });
    }
    if (url.pathname.endsWith('/releases/tags/stats_player')) {
      return Response.json({ assets: [season, season - 1].map((year) => ({
        name: `stats_player_week_${year}.csv.gz`,
        url: `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/stats-${year}`,
      })) });
    }
    if (url.pathname.endsWith('/releases/tags/injuries')) {
      return Response.json({ assets: [{ name: `injuries_${season}.csv.gz`, url: 'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/injuries' }] });
    }
    if (url.pathname.endsWith(`/assets/stats-${season}`)) return new Response(gzipSync(Buffer.from(statsCsv)));
    if (url.pathname.endsWith(`/assets/stats-${season - 1}`)) return new Response(gzipSync(Buffer.from(`${csvHeader}\n`)));
    if (url.pathname.endsWith('/assets/injuries')) return new Response(gzipSync(Buffer.from(injuriesCsv)));
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)');
    const candidate: LoadResult['candidates'][number] = {
      id: `${event.id}:Josh Allen:player_pass_yds:Over:200.5`,
      name: 'Josh Allen',
      pos: 'QB',
      team: 'BUF',
      opp: 'MIA',
      gameId: event.id,
      kickoff: event.commence_time,
      market: 'player_pass_yds',
      side: 'Over',
      line: 200.5,
      odds: -110,
      oddsAt: new Date(now).toISOString(),
      sample: 1,
      mean: 999,
      sd: 1,
      source: 'live',
      historyPlayerId: 'josh-allen',
    };
    const oldResponse: LoadResult = {
      mode: 'live',
      notes: ['Historical player statistics unavailable for seasons 2026 (HTTP 504).', 'Injury data unavailable (HTTP 504).'],
      candidates: [candidate],
      pipelineRejections: [],
      games: [{ id: event.id, label: 'BUF @ MIA', kickoff: event.commence_time, status: 'available', markets: ['player_pass_yds'], returnedMarketKeys: ['player_pass_yds'], unsupportedMarketKeys: [], props: 1 }],
      availableDates: [],
      selectedDate: 'ALL',
      diagnostics: {},
    };
    db.prepare('INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?)').run(`${liveCacheKey(process.env.ODDS_API_KEY!)}:${MODEL_VERSION}`, JSON.stringify(oldResponse), now);
    db.close();

    const result = await getData();

    assert.equal(result.candidates[0].sample, 6);
    assert.equal(result.candidates[0].history?.last5?.games, 5);
    assert.equal(result.candidates[0].history?.last5?.average, 220);
    assert.equal(result.candidates[0].injury, 'Questionable');
    assert.equal(result.notes.some((note) => /HTTP 504/.test(note)), false);
    assert.equal(perGameOddsRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    getDb().close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
