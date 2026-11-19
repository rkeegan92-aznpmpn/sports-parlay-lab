import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { gzipSync } from 'node:zlib';
import { cachedProviderFetch } from '../src/server/load.ts';

test('compressed GitHub release assets are cached and served from SQLite', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)');
  const assetUrl = 'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/725837163';
  const csv = 'player_display_name,season,week\nReal Player,2026,1\n';
  let requests = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    requests++;
    assert.equal(new Headers(init?.headers).get('Accept'), 'application/octet-stream');
    assert.equal(new Headers(init?.headers).has('x-nflverse-cache-name'), false);
    return new Response(gzipSync(Buffer.from(csv)));
  };
  const providerFetch = cachedProviderFetch(db, fetcher);
  const init = { headers: { Accept: 'application/octet-stream', 'x-nflverse-cache-name': 'asset:stats_player_week_2026.csv.gz' } };

  const first = new Uint8Array(await (await providerFetch(assetUrl, init)).arrayBuffer());
  const second = new Uint8Array(await (await providerFetch(assetUrl, init)).arrayBuffer());

  assert.deepEqual(first, second);
  assert.equal(requests, 1);
  const cached = db.prepare('SELECT value FROM cache WHERE key = ?').get('provider:binary-v2:asset:stats_player_week_2026.csv.gz') as { value: string } | undefined;
  assert.equal(cached?.value.startsWith('base64:'), true);
  db.close();
});

test('named free-provider responses are cached without forwarding internal cache headers', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)');
  let requests = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    requests++;
    assert.equal(new Headers(init?.headers).has('x-provider-cache-name'), false);
    return Response.json({ roster: true });
  };
  const providerFetch = cachedProviderFetch(db, fetcher);
  const init = { headers: { 'x-provider-cache-name': 'espn:roster:BUF' } };
  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/buf/roster';

  assert.deepEqual(await (await providerFetch(url, init)).json(), { roster: true });
  assert.deepEqual(await (await providerFetch(url, init)).json(), { roster: true });
  assert.equal(requests, 1);
  db.close();
});

test('direct compressed CSV fallbacks preserve bytes across cached reads', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)');
  const bytes = gzipSync(Buffer.from('player,passing_yards\nTest QB,250\n'));
  let calls = 0;
  const cached = cachedProviderFetch(db, async () => { calls++; return new Response(bytes); });
  const url = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz';
  assert.deepEqual(Buffer.from(await (await cached(url)).arrayBuffer()), bytes);
  assert.deepEqual(Buffer.from(await (await cached(url)).arrayBuffer()), bytes);
  assert.equal(calls, 1);
  db.close();
});

test('current results and final ESPN boxscores refresh sooner than old historical stats', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)');
  const name = 'espn:final-summary:123';
  db.prepare('INSERT INTO cache VALUES (?,?,?)').run(`provider:${name}`, 'text:{"old":true}', Date.now() - 16 * 60_000);
  let calls = 0;
  const cached = cachedProviderFetch(db, async () => { calls++; return Response.json({ final: true }); });
  assert.deepEqual(await (await cached('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=123', { headers: { 'x-provider-cache-name': name } })).json(), { final: true });
  assert.equal(calls, 1);
  db.close();
});
