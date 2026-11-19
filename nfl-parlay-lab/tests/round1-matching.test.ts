import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {gzipSync} from 'node:zlib';
import {SCHEMA} from '../src/server/db.ts';
import {MODEL_VERSION} from '../src/lib/model.ts';
import {updateValidation} from '../src/server/tracking.ts';

// Synthetic provider conflicts are never installed as production forecasts/results.
test('authoritative ID repairs are logged; conflicting finality/rematch IDs stay pending without grading',async()=>{
  const db=new Database(':memory:');db.exec(SCHEMA);
  const ko=Date.parse('2026-09-20T17:00:00Z'),now=Date.parse('2026-09-21T12:00:00Z');
  const insert=db.prepare(`INSERT INTO forecast_snapshots
    (model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,event_id,result_game_id,espn_event_id,espn_player_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(const [line,nfl,espn] of [[250.5,'401',''],[200.5,'2026_04_BUF_MIN','402']] as const)
    insert.run(MODEL_VERSION,ko-3600_000,ko,2026,'Fixture QB','gsis-fixture','nflverse','BUF','MIN','QB','player_pass_yds','Over',line,-110,new Date(ko-3600_000).toISOString(),.7,.5,'no-vig','odds-fixture',nfl,espn,'espn:100');
  db.prepare("INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose)VALUES('aggr',?,'live','[]','test-research')").run(ko);
  const before=db.prepare('SELECT * FROM saved_tickets').all();
  let final=false;const calls:string[]=[];
  const f:typeof fetch=async(input)=>{
    const url=String(input);calls.push(url);
    if(url.includes('games.csv'))return new Response('game_id,season,week,game_type,gameday,gametime,home_team,away_team,home_score,away_score,espn\n2026_04_BUF_MIN,2026,4,REG,2026-09-20,13:00,MIN,BUF,20,21,401\n2026_01_MIN_BUF,2026,1,REG,2026-09-06,13:00,BUF,MIN,14,10,402\n');
    if(url.endsWith('/releases/tags/stats_player'))return Response.json({assets:[{name:'stats_player_week_2026.csv.gz',url:'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/123'}]});
    if(url.endsWith('/assets/123'))return new Response(gzipSync(Buffer.from('player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,passing_yards\nFixture QB,QB,BUF,MIN,2026,4,REG,2026_04_BUF_MIN,gsis-fixture,2026-09-20,260\n')));
    if(url.includes('/summary?event=401'))return Response.json({header:{id:'401',season:{year:2026,type:2},week:{number:4},competitions:[{date:'2026-09-20T17:00:00Z',status:{type:{completed:final,name:final?'STATUS_FINAL':'STATUS_POSTPONED'}},competitors:[{homeAway:'home',team:{abbreviation:'MIN'}},{homeAway:'away',team:{abbreviation:'BUF'}}]}]},boxscore:{players:[{team:{abbreviation:'BUF'},statistics:[{name:'passing',keys:['passingYards'],athletes:[{athlete:{id:'100',displayName:'Fixture QB'},stats:['260']}]}]}]}});
    throw new Error(`Unexpected fixture provider call ${url}`);
  };
  try {
    let result=await updateValidation(db,f,now);
    assert.equal(result.n,0);
    let rows=db.prepare('SELECT * FROM forecast_snapshots ORDER BY id').all() as Record<string,unknown>[];
    assert.equal(rows[0].settlement_reason,'conflicting-final-status');
    assert.equal(rows[1].settlement_reason,'conflicting-event-identities');
    assert.equal(rows[0].result_game_id,'2026_04_BUF_MIN');assert.equal(rows[0].espn_event_id,'401');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM forecast_event_repairs').get() as {n:number}).n,1);
    assert.equal(rows[1].espn_event_id,'402');assert.equal(rows[1].result_game_id,'2026_04_BUF_MIN');
    assert.equal(calls.some((url)=>url.includes('/summary?event=402')),false);
    final=true;result=await updateValidation(db,f,now);
    assert.equal(result.n,1);assert.equal(result.validationStatus,'unvalidated');
    rows=db.prepare('SELECT * FROM forecast_snapshots ORDER BY id').all() as Record<string,unknown>[];
    assert.equal(rows[0].hit,1);assert.equal(rows[0].result_kickoff_ts,ko);assert.equal(rows[1].hit,null);
    assert.ok(rows.every((row)=>row.p===.7&&row.odds===-110&&row.snapshot_ts===ko-3600_000&&row.kickoff_ts===ko&&row.event_id==='odds-fixture'));
    assert.deepEqual(db.prepare('SELECT * FROM saved_tickets').all(),before);
  } finally {db.close();}
});
