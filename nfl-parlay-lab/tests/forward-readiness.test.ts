import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {collectionPolicy,phaseHealth} from '../src/server/collectionHealth.ts';
import {collectionCycle} from '../src/server/collectionCycle.ts';
import {credentialFingerprint} from '../src/server/credentials.ts';
import {forwardReadiness} from '../src/server/forwardReadiness.ts';
import {MODEL_VERSION} from '../src/lib/model.ts';
import {savedGrades} from '../src/server/savedGrades.ts';
const NOW=Date.parse('2026-11-10T18:00:00Z'),KO=Date.parse('2026-11-15T18:00:00Z');
test('default collector is cache-only regardless of old credentials; paid capture requires explicit mode',()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);try{
  db.prepare('INSERT INTO cache VALUES(?,?,?)').run(`odds:cooldown:${credentialFingerprint('fixture-key')}`,JSON.stringify({code:'OUT_OF_USAGE_CREDITS',status:401,until:NOW-1}),NOW-60000);
  assert.equal(collectionPolicy(db,'fixture-key',undefined,NOW).capture,false);
  assert.equal(collectionPolicy(db,'fixture-key','capture-and-settle',NOW).capture,true);
  assert.equal(collectionPolicy(db,undefined,undefined,NOW).capture,false);assert.match(collectionPolicy(db,'fixture-key',undefined,NOW).reason,/Cache-only/);assert.equal(collectionPolicy(db,undefined,'capture-and-settle',NOW).capture,false);
  assert.equal(collectionPolicy(db,'another-fixture',undefined,NOW).capture,false);
 }finally{db.close();}
});
test('3,684 synthetic future forecasts remain pending, read-only audit distinguishes them from saved-ticket accuracy',()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  const insert=db.prepare(`INSERT INTO forecast_snapshots(model_version,snapshot_ts,kickoff_ts,season,player,history_player_id,history_source,team,opp,pos,market,side,line,odds,odds_at,p,market_p,market_p_source,event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(()=>{for(let i=0;i<3684;i++)insert.run(MODEL_VERSION,NOW,KO,2026,`Fixture ${i%30}`,`id-${i%30}`,'nflverse','BUF','MIN','RB','player_rush_yds','Over',50.5,-110,new Date(NOW-i*10).toISOString(),.7,.5,'single-side','fixture-event');})();
  db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run('best',NOW,'BACKTEST-GRADING-PROBE','[]','simulation');db.prepare('INSERT INTO saved_ticket_grades(ticket_id,status,legs_json,checked_at,finalized) VALUES(?,?,?,?,?)').run(1,'win',JSON.stringify([{player:'Fixture',status:'settled',hit:1,actual:80,resultSource:'nflverse'}]),NOW,1);
  const before=db.prepare('SELECT total_changes() n').get();const audit=forwardReadiness(db,NOW);
  assert.equal(audit.forecastAudit.buckets.futureKickoff,3684);assert.equal(audit.forecastAudit.dueForSettlement,0);assert.equal(audit.tickets.verifiedDecisiveLegs,0);assert.equal(audit.tickets.excludedNonForwardArchives,1);
  assert.deepEqual(db.prepare('SELECT total_changes() n').get(),before);assert.ok(audit.conclusions.some(c=>c.includes('not a measured 0%')));
 }finally{db.close();}
});
test('a forecast-settlement exception cannot prevent independent exact-ID ESPN saved-ticket grading',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 const kickoff=Date.parse('2026-09-24T17:00:00Z');
 const legs=['QB','RB','RB','WR','WR','TE'].map((pos,i)=>({name:`Fixture ${i}`,pos,team:'BUF',opp:'MIN',historyPlayerId:`gsis-${i}`,espnPlayerId:`espn:${100+i}`,espnEventId:'401',market:'player_rush_yds',side:'Over',line:50.5,kickoff:new Date(kickoff).toISOString()}));
 db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run('best',kickoff-3600000,'manual',JSON.stringify(legs),'test-research');
 const before=db.prepare('SELECT * FROM saved_tickets').all();
 const f:typeof fetch=async input=>String(input).includes('/summary?event=401')?Response.json({header:{id:'401',season:{year:2026,type:2},week:{number:4},competitions:[{date:'2026-09-24T17:00:00Z',status:{type:{completed:true}},competitors:[{homeAway:'home',team:{abbreviation:'MIN'}},{homeAway:'away',team:{abbreviation:'BUF'}}]}]},boxscore:{players:[{team:{abbreviation:'BUF'},statistics:[{name:'rushing',keys:['rushingYards'],athletes:legs.map((l,i)=>({athlete:{id:String(100+i),displayName:l.name},stats:['80']}))}]}]}}):new Response('',{status:404});
 try{
  const cycle=await collectionCycle(db,undefined,f,kickoff+3600000,{validate:async()=>{throw new Error('Injected forecast failure');}});
  assert.ok(cycle.validation.providerErrors.length);assert.equal(forwardReadiness(db,kickoff+3600000).tickets.examples[0].exactEspnBridges,6);assert.equal(savedGrades(db)[1].status,'win');assert.ok(savedGrades(db)[1].legs.every(l=>l.resultSource==='espn'&&l.actual===80));
  const phases=phaseHealth(db);assert.equal(phases.find(p=>p.phase==='forecast-settlement')!.status,'failed');assert.equal(phases.find(p=>p.phase==='ticket-grading')!.status,'degraded');
  assert.deepEqual(db.prepare('SELECT * FROM saved_tickets').all(),before);
  const contradictory=legs.map(l=>({...l,kickoff:'2026-09-27T17:00:00Z',resultGameId:'2026_05_BUF_MIN'}));db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run('best',kickoff-3600000,'manual',JSON.stringify(contradictory),'test-research');await collectionCycle(db,undefined,f,kickoff+7*86400000);assert.equal(savedGrades(db)[2].status,'pending','unavailable primary cannot silently select a different rematch date/week');
  const legacy=legs.map(({historyPlayerId,...l})=>({...l,espnEventId:''}));db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run('best',kickoff-3600000,'manual',JSON.stringify(legacy),'test-research');
  const withSchedule:typeof fetch=async(input,init)=>String(input).includes('games.csv')?new Response('game_id,season,week,game_type,gameday,home_team,away_team,espn\n2026_04_BUF_MIN,2026,4,REG,2026-09-24,MIN,BUF,401'):f(input,init);
  await collectionCycle(db,undefined,withSchedule,kickoff+3600000);assert.equal(savedGrades(db)[3].status,'win');assert.ok(savedGrades(db)[3].legs.every(l=>l.identityMethod==='stored-player-and-authoritative-schedule-event'));
  const wrong=legs.map((l,i)=>i===0?{...l,name:'Wrong Saved Player'}:l);db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run('best',kickoff-3600000,'manual',JSON.stringify(wrong),'test-research');await collectionCycle(db,undefined,f,kickoff+3600000);assert.equal(savedGrades(db)[4].status,'pending');assert.equal(savedGrades(db)[4].legs[0].reason,'player-identity-mismatch');
 }finally{db.close();}
});
