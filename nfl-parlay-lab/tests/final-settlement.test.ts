import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA } from '../src/server/db.ts';
import { MODEL_VERSION } from '../src/lib/model.ts';
import { collectionCycle } from '../src/server/collectionCycle.ts';
import { updateValidation } from '../src/server/tracking.ts';

// Explicit synthetic final-result fixtures; no test records are installed into application history.
test('NFL identity bridge settles final ESPN results after postponement, excluding pushes and missing players', async () => {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const original = Date.parse('2026-09-20T17:00:00Z'), now = Date.parse('2026-09-25T17:00:00Z');
  const insert = db.prepare(`INSERT INTO forecast_snapshots
    (model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,event_id,result_game_id,espn_event_id,espn_player_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [line,id] of [[250.5,'100'],[2,'100'],[240.5,'999']] as const) insert.run(MODEL_VERSION,original-3600_000,original,2026,id==='999'?'Missing Fixture QB':'Fixture QB',`gsis-${id}`,'nflverse','BUF','MIN','QB',line===2?'player_pass_tds':'player_pass_yds','Over',line,-110,new Date(original-3600_000).toISOString(),.7,.5,'no-vig','odds-event-401','2026_04_BUF_MIN','401',`espn:${id}`);
  let completed = false;
  const fetcher: typeof fetch = async (input) => {
    const url=String(input);
    if (url.includes('games.csv')) return new Response('game_id,season,week,game_type,gameday,home_team,away_team,home_score,away_score,espn\n2026_04_BUF_MIN,2026,4,REG,2026-09-24,MIN,BUF,,,401\n');
    if (url.includes('/summary?event=401')) return Response.json({
      header:{ id:'401',season:{year:2026,type:2},week:{number:4},competitions:[{date:'2026-09-24T17:00:00Z', status:{type:{completed,name:completed?'STATUS_FINAL':'STATUS_POSTPONED'}}, competitors:[{homeAway:'home',team:{abbreviation:'MIN'}},{homeAway:'away',team:{abbreviation:'BUF'}}]}]},
      boxscore:{players:[{team:{abbreviation:'BUF'},statistics:[{name:'passing',keys:['passingYards','passingTouchdowns','completions/passingAttempts'],athletes:[{athlete:{id:'100',displayName:'Fixture QB'},stats:['260','2','20/30']}]}]}]},
    });
    return new Response('Unavailable fixture source', {status:404});
  };
  try {
    const waiting=await updateValidation(db,fetcher,now);
    assert.equal(waiting.n,0);
    assert.ok(waiting.tracking.pendingReasons.some((item)=>item.reason==='postponed-or-cancelled'));
    completed=true;
    const cycle=await collectionCycle(db,async()=>{throw new Error('Paid provider quota exhausted');},fetcher,now);
    assert.ok(cycle.captureFailure instanceof Error);
    const result=cycle.validation;
    assert.equal(result.n,1);
    assert.equal(result.tracking.pushes,1);
    assert.equal(result.tracking.awaitingResults,1);
    const rows=db.prepare('SELECT event_id,kickoff_ts,snapshot_ts,settlement_status,settled_at,result_source,result_date,settlement_reason FROM forecast_snapshots ORDER BY id').all() as Record<string,unknown>[];
    assert.ok(rows.every((row)=>row.event_id==='odds-event-401' && row.kickoff_ts===original && row.snapshot_ts===original-3600_000));
    assert.equal(rows[0].result_source,'espn');
    assert.equal(rows[0].result_date,'2026-09-24');
    assert.equal(result.validationProgress.find((item)=>item.id==='dates')?.current,1);
    assert.equal(rows[1].settlement_status,'push');
    assert.equal(rows[2].settlement_status,'pending');
    assert.notEqual(rows[2].settlement_reason,'final');
    assert.equal(result.validationStatus,'unvalidated');
    db.prepare(`INSERT INTO forecast_snapshots
      (model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,event_id,result_game_id,espn_event_id,espn_player_id,hit,settlement_status,result_source,result_date)
      SELECT model_version,snapshot_ts,kickoff_ts+86400000,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,event_id,result_game_id,espn_event_id,espn_player_id,hit,settlement_status,result_source,result_date FROM forecast_snapshots WHERE id=1`).run();
    const {evaluationRows}=await import('../src/server/tracking.ts');
    assert.equal(evaluationRows(db).length,1); // A rescheduled quote for the same event is not another validation trial.
  } finally {db.close();}
});
