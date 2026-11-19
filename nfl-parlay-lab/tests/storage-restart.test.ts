import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('SQLite research tickets survive a process restart', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'parlay-restart-'));
  const moduleUrl = new URL('../src/server/db.ts', import.meta.url).href;
  const run = (statement: string) => spawnSync(process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e',
      `import { getDb } from ${JSON.stringify(moduleUrl)}; const db = getDb(); ${statement}; db.close();`],
    { env: { ...process.env, DB_PATH: path.join(directory, 'parlay.db'), REQUIRE_PERSISTENT_DB: '0' }, encoding: 'utf8' });
  try {
    const write = run(`db.prepare("INSERT INTO saved_tickets (kind, created_at, source, legs_json, purpose) VALUES ('best', 1, 'live', '[]', 'test-research')").run()`);
    assert.equal(write.status, 0, write.stderr);
    const read = run(`console.log(JSON.stringify(db.prepare('SELECT purpose FROM saved_tickets').all()))`);
    assert.equal(read.status, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), [{ purpose: 'test-research' }]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
