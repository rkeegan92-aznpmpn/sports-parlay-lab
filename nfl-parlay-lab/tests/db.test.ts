import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb } from '../src/server/db.ts';

test('saved research purpose migration preserves existing tickets and test labels', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'parlay-purpose-'));
  const previous = process.env.DB_PATH;
  process.env.DB_PATH = path.join(directory, 'legacy.db');
  const legacy = new Database(process.env.DB_PATH);
  legacy.exec(`CREATE TABLE saved_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
    created_at INTEGER NOT NULL, source TEXT NOT NULL, joint_p REAL, decimal REAL, legs_json TEXT NOT NULL);
    INSERT INTO saved_tickets (kind, created_at, source, legs_json) VALUES ('best', 1, 'live', '[]');`);
  legacy.exec(`CREATE TABLE forecast_snapshots (id INTEGER PRIMARY KEY, model_version TEXT, snapshot_ts INTEGER, kickoff_ts INTEGER,
    season INTEGER, player TEXT, history_player_id TEXT, history_source TEXT, team TEXT, opp TEXT, pos TEXT, market TEXT,
    side TEXT, line REAL, odds INTEGER, odds_at TEXT, p REAL, market_p REAL, market_p_source TEXT, hit INTEGER);
    INSERT INTO forecast_snapshots VALUES (1,'historical-hit-beta-v2',1,2,2026,'Legacy Player','gsis-old','nflverse','BUF','MIN','QB','player_pass_yds','Over',200.5,-110,'2026-01-01T00:00:00Z',0.7,0.5,'no-vig',1);`);
  legacy.close();
  const db = getDb();
  try {
    assert.deepEqual(db.prepare('SELECT hit,legacy_hit,event_id,settlement_reason FROM forecast_snapshots').get(), {hit:null,legacy_hit:1,event_id:'',settlement_reason:'requires-final-result-reverification'});
    assert.deepEqual(db.prepare('SELECT id, purpose FROM saved_tickets').all(), [{ id: 1, purpose: 'legacy-research' }]);
    db.prepare('INSERT INTO saved_tickets (kind, created_at, source, legs_json, purpose) VALUES (?, ?, ?, ?, ?)')
      .run('best', 2, 'live', '[]', 'test-research');
    assert.equal((db.prepare('SELECT purpose FROM saved_tickets WHERE id = 2').get() as { purpose: string }).purpose, 'test-research');
    assert.equal(getDb(), db);
  } finally {
    db.close();
    if (previous === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
