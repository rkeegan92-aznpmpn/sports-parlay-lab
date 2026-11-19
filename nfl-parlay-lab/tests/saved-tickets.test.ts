import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCHEMA } from '../src/server/db.ts';
import { InvalidSavedTicket, listSavedTickets, saveTicket } from '../src/server/savedTickets.ts';

// Synthetic save payloads, isolated from application/provider data.
const input = (kind = 'best') => ({ kind, purpose: 'test-research', jointP: 0.12, decimal: 48,
  legs: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'].map((pos, index) => ({
    id: `fixture-${index}`, name: `Fixture Player ${index}`, pos, team: index < 3 ? 'BUF' : 'SEA',
    opp: index < 3 ? 'MIN' : 'LA', gameId: index < 3 ? 'g1' : 'g2', market: pos === 'QB' ? 'player_pass_yds' : pos === 'RB' ? 'player_rush_yds' : 'player_reception_yds',
    side: 'Over', line: 50.5, odds: -110, kickoff: '2026-11-15T18:00:00Z', oddsAt: '2026-11-09T12:00:00Z', source: 'live',
    historySource: 'nflverse', historyPlayerId: `fixture-player-${index}`,
  })) });

test('both ticket kinds, TEST MODE labels and six leg snapshots survive reopening SQLite', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'parlay-saved-history-'));
  const file = path.join(directory, 'saved.db');
  let db = new Database(file); db.exec(SCHEMA);
  try {
    const best = saveTicket(db, input('best'), 100);
    const aggressive = saveTicket(db, input('aggr'), 200);
    assert.notEqual(best.id, aggressive.id);
    db.close(); db = new Database(file);
    const history = listSavedTickets(db);
    assert.deepEqual(history.map((row) => row.kind), ['aggr', 'best']);
    assert.deepEqual(history.map((row) => row.created_at), [200, 100]);
    assert.ok(history.every((row) => row.purpose === 'test-research' && row.legs.length === 6 && !row.detailsUnavailable));
    assert.deepEqual(history[1].legs, input().legs);
    assert.equal(history[1].joint_p, 0.12);
    assert.equal(history[1].decimal, 48);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('saving rejects incomplete, duplicate, malformed, demo and wrong-position selections', () => {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const cases = [null, {}, { ...input(), kind: 'other' }, { ...input(), jointP: NaN }, { ...input(), decimal: 1 },
    { ...input(), legs: input().legs.slice(0, 5) }, { ...input(), legs: [null, ...input().legs.slice(1)] },
    { ...input(), legs: input().legs.map((leg) => ({ ...leg, source: 'demo' })) },
    { ...input(), legs: input().legs.map((leg) => ({ ...leg, pos: 'QB' })) },
    { ...input(), legs: input().legs.map((leg) => ({ ...leg, name: 'Same Player', team: 'BUF' })) }];
  try {
    for (const value of cases) assert.throws(() => saveTicket(db, value), InvalidSavedTicket);
    assert.equal(listSavedTickets(db).length, 0);
    const archived = saveTicket(db, { ...input(), purpose: 'validated-research' });
    assert.equal(archived.purpose, 'research-only'); // Storage never promotes an archive to a recommendation.
  } finally { db.close(); }
});

test('history pagination preserves older records and tolerates damaged legacy detail JSON', () => {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  try {
    for (let i = 0; i < 51; i++) saveTicket(db, input(), i);
    db.prepare("UPDATE saved_tickets SET legs_json = 'bad-json', purpose = 'legacy-research' WHERE id = 1").run();
    const first = listSavedTickets(db);
    assert.equal(first.length, 50);
    assert.equal(first[0].id, 51);
    const older = listSavedTickets(db, first.at(-1)!.id);
    assert.equal(older.length, 1);
    assert.equal(older[0].id, 1);
    assert.equal(older[0].detailsUnavailable, true);
    assert.deepEqual(older[0].legs, []);
  } finally { db.close(); }
});


test('pregame research label survives database reopen without promoting validation', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pregame-saved-'));
  const file = path.join(directory, 'saved.db');
  let db = new Database(file); db.exec(SCHEMA);
  try {
    saveTicket(db, {...input(), purpose:'pregame-research'});
    db.close(); db = new Database(file);
    assert.equal(listSavedTickets(db)[0].purpose, 'pregame-research');
    assert.deepEqual(listSavedTickets(db)[0].legs, input().legs);
  } finally { db.close(); rmSync(directory, {recursive:true, force:true}); }
});
