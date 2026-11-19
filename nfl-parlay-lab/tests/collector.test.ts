import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA } from '../src/server/db.ts';
import { acquireCollector, collectorStatus, collectorAttempt, collectorResult, heartbeat, stopCollector } from '../src/server/collector.ts';

test('collector lease, heartbeat, failures and stop status are honest and prevent duplicate workers', () => {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  try {
    assert.equal(collectorStatus(db, 1000).status, 'stopped');
    assert.equal(acquireCollector(db, 'first', 1000), true);
    assert.equal(acquireCollector(db, 'second', 2000), false);
    collectorAttempt(db, 'first', 3000);
    collectorResult(db, 'first', 'apiKey=private-fixture-key provider failed', 20000, 4000);
    assert.equal(collectorStatus(db, 5000).status, 'failing');
    assert.ok(!collectorStatus(db, 5000).lastError!.includes('private-fixture-key'));
    assert.equal(collectorStatus(db, 5000).lastSuccess, null);
    assert.equal(heartbeat(db, 'first', 6000), true);
    collectorResult(db,'first','Free result provider unavailable; paper phase remains independent.',21000,6500,'degraded');assert.equal(collectorStatus(db,6600).status,'degraded');assert.match(collectorStatus(db,6600).reason,/provider\/data limitations/);
    collectorResult(db, 'first', null, 21000, 7000);
    assert.equal(collectorStatus(db, 8000).status, 'running');
    assert.equal(collectorStatus(db, 8000).lastSuccess, 7000);
    assert.equal(collectorStatus(db, 100000).status, 'stopped'); // An old DB row never proves a stopped Codespace is running.
    assert.equal(acquireCollector(db, 'second', 100000, 'settle-only'), true);
    assert.equal(collectorStatus(db, 100001).mode, 'settle-only');
    assert.match(collectorStatus(db, 100001).reason,/new paid quote collection is stopped/);
    stopCollector(db, 'first', 101000);
    assert.equal(collectorStatus(db, 102000).active, true); // Old owner cannot stop its replacement.
    stopCollector(db, 'second', 103000);
    assert.equal(collectorStatus(db, 104000).status, 'stopped');
    assert.equal(collectorStatus(db, 104000).nextRun, null);
  } finally { db.close(); }
});


test('collector diagnostics redact all independent-provider credentials',()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const keys=['ODDS_API_KEY','PROPLINE_API_KEY','FANDUEL_API_KEY'] as const,previous=keys.map(k=>process.env[k]);
 try{keys.forEach((k,i)=>process.env[k]=`secret-fixture-${i}`);acquireCollector(db,'redaction',1000);collectorResult(db,'redaction',keys.map(k=>process.env[k]).join(' '),null,2000,'degraded');const message=collectorStatus(db,3000).lastError!;assert.equal(message,'[redacted] [redacted] [redacted]');}
 finally{keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});db.close();}
});
