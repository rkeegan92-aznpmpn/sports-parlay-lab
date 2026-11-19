import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA } from '../src/server/db.ts';
import { MODEL_VERSION } from '../src/lib/model.ts';
import { settlementAudit } from '../src/server/settlementAudit.ts';
import { pregameIssues } from '../src/lib/forecastIntegrity.ts';
import { resolveScheduledGame } from '../src/lib/providers/stats.ts';
import { updateValidation } from '../src/server/tracking.ts';
import { acquireCollector, heartbeat } from '../src/server/collector.ts';

const NOW=Date.parse('2026-11-10T18:00:00Z'), KO=Date.parse('2026-11-15T18:00:00Z');
const schedule=[
  {game_id:'2026_04_BUF_MIN',season:'2026',week:'4',game_type:'REG',gameday:'2026-09-20',home_team:'MIN',away_team:'BUF',espn:'401'},
  {game_id:'2026_14_MIN_BUF',season:'2026',week:'14',game_type:'REG',gameday:'2026-12-13',home_team:'BUF',away_team:'MIN',espn:'402'},
];

test('2,791 future quote forecasts are not 2,791 due results; audit is read-only and preserves saved tickets', async()=>{
  // Explicit synthetic regression cohort only; not the user's private database.
  const db=new Database(':memory:');db.exec(SCHEMA);
  const insert=db.prepare(`INSERT INTO forecast_snapshots
    (model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,event_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  try {
    db.transaction(()=>{for(let i=0;i<2791;i++){
      const captured=NOW-Math.floor(i/31)*1000;
      insert.run(MODEL_VERSION,captured,KO,2026,`Fixture Player ${i%31}`,`fixture-${i%31}`,'nflverse','BUF','MIN','RB','player_rush_yds','Over',50.5,-110,new Date(captured).toISOString(),.7,.5,'no-vig','fixture-odds-event');
    }})();
    db.prepare("INSERT INTO saved_tickets (kind,created_at,source,legs_json,purpose) VALUES ('best',?,'live','[]','test-research')").run(NOW);
    acquireCollector(db,'fixture-worker',NOW);
    const before=db.prepare('SELECT total_changes() AS n').get();
    const audit=settlementAudit(db,NOW);
    assert.equal(audit.currentModelCaptured,2791);assert.equal(audit.buckets.futureKickoff,2791);
    assert.equal(audit.dueForSettlement,0);assert.equal(audit.bucketsReconcile,true);
    assert.equal(audit.events.length,1);assert.equal(audit.events[0].forecasts,2791);
    assert.equal(audit.nextEligibleAtUTC,new Date(KO+6*3600_000).toISOString());
    assert.equal(audit.savedTickets,1);assert.equal(audit.collector.active,true);
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(),before);
    let calls=0;
    const result=await updateValidation(db,async()=>{calls++;throw new Error('Not due: no provider calls expected');},NOW);
    assert.equal(calls,0);assert.equal(result.n,0);assert.equal(result.tracking.upcoming,2791);
    assert.equal(result.validationStatus,'unvalidated');
    assert.equal(settlementAudit(db,NOW+91000).collector.active,false);
    heartbeat(db,'fixture-worker',NOW+92000);
    assert.equal(settlementAudit(db,NOW+92001).collector.active,true);
  } finally {db.close();}
});

test('event namespace repair needs an authoritative unique match; conflicting rematch IDs cannot select a result',()=>{
  const selection={season:2026,team:'BUF',opp:'MIN',kickoffTs:Date.parse('2026-09-20T17:00:00Z')};
  assert.equal(resolveScheduledGame(schedule,{...selection,resultGameId:'401'}).match?.game_id,'2026_04_BUF_MIN');
  assert.equal(resolveScheduledGame(schedule,{...selection,espnEventId:'2026_04_BUF_MIN'}).match?.espn,'401');
  assert.equal(resolveScheduledGame(schedule,{...selection,resultGameId:'2026_04_BUF_MIN',espnEventId:'402'}).reason,'conflicting-event-identities');
  assert.equal(resolveScheduledGame([...schedule,schedule[0]],{...selection,espnEventId:'401'}).match,undefined);
  assert.equal(resolveScheduledGame(schedule,{...selection,resultGameId:'unknown-event'}).match,undefined);
});

test('bad historical clock values are diagnosed as-is, never silently multiplied or backdated',()=>{
  const valid={snapshotTs:NOW,kickoffTs:KO,season:2026,oddsAt:new Date(NOW).toISOString()};
  assert.deepEqual(pregameIssues(valid),[]);
  assert.ok(pregameIssues({...valid,kickoffTs:Math.floor(KO/1000)}).includes('kickoff-season-mismatch'));
  assert.ok(pregameIssues({...valid,snapshotTs:KO+1,oddsAt:new Date(KO).toISOString()}).includes('post-kickoff-capture'));
  assert.ok(pregameIssues({...valid,oddsAt:new Date(NOW-31*60000).toISOString()}).includes('quote-not-fresh-at-capture'));
});

test('legacy read-only audit reports missing metadata without creating tables or upgrading historical predictions',()=>{
  const db=new Database(':memory:');
  db.exec("CREATE TABLE snapshots (id INTEGER); INSERT INTO snapshots VALUES (1);");
  try {
    const before=db.prepare('SELECT name FROM sqlite_master').all();
    const audit=settlementAudit(db,NOW);
    assert.equal(audit.currentModelCaptured,0);assert.equal(audit.legacySnapshotRows,1);
    assert.ok(audit.schemaMissingFields.includes('model_version'));
    assert.deepEqual(db.prepare('SELECT name FROM sqlite_master').all(),before);
  } finally {db.close();}
});

test('Eastern schedule kickoff conversion respects DST and never guesses an ambiguous time',async()=>{
  const {scheduledKickoff}=await import('../src/lib/providers/stats.ts');
  assert.equal(scheduledKickoff({gameday:'2026-09-20',gametime:'13:00'}),Date.parse('2026-09-20T17:00:00Z'));
  assert.equal(scheduledKickoff({gameday:'2026-11-15',gametime:'13:00'}),Date.parse('2026-11-15T18:00:00Z'));
  assert.equal(scheduledKickoff({gameday:'2026-11-01',gametime:'01:30'}),undefined);
  assert.equal(scheduledKickoff({gameday:'2026-11-15',gametime:''}),undefined);
});

test('actual kickoff provenance rejects postgame forecasts even when the stored original kickoff is later',async()=>{
  const {settlementOutcome}=await import('../src/lib/settle.ts');
  const game={name:'Fixture QB',pos:'QB',playerId:'fixture-player',team:'BUF',opp:'MIN',season:2026,week:4,gameId:'2026_04_BUF_MIN',gameDate:'2026-09-20T17:00:00Z',kickoffTs:Date.parse('2026-09-20T17:00:00Z'),completed:true,availableMarkets:['player_pass_yds'],v:{passing_yards:260}};
  const selection={player:'Fixture QB',playerId:'fixture-player',team:'BUF',opp:'MIN',season:2026,gameId:game.gameId,market:'player_pass_yds',side:'Over',line:250.5,snapshotTs:Date.parse('2026-09-20T18:00:00Z'),kickoffTs:Date.parse('2026-09-21T17:00:00Z'),requireFinal:true};
  assert.equal(settlementOutcome(selection,[game]).reason,'post-actual-kickoff-capture');
  assert.equal(settlementOutcome({...selection,snapshotTs:Date.parse('2026-09-20T16:00:00Z')},[game]).hit,1);
  assert.equal(settlementOutcome(selection,[{...game,kickoffTs:undefined}]).reason,'actual-kickoff-unverified');
});
