import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {pick6Batch,type BatchProgress} from '../src/server/pick6Batch.ts';
import {paperDashboard,savePaperSelection,paperGames,gradePaperWagers} from '../src/server/paper.ts';
import {refreshPropLine} from '../src/server/propline.ts';
import {fullSignature} from '../src/lib/fourOptions.ts';
import {finishFixtureGames} from './manualFixtures.ts';
import {gradeSavedTickets,savedGrades} from '../src/server/savedGrades.ts';
import {KEY,NOW,kickoff,free,api,eventBody} from './proplineFixtures.ts';
const keys={fanduelapi:'must-not-contact-fixture','odds-api':'must-not-contact-fixture',propline:KEY};
const setup=()=>{const db=new Database(':memory:');db.exec(SCHEMA);return db;};
const count=(db:Database.Database,t:string)=>(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as {n:number}).n;
test('one touch saves four strategies; paper shares exact quotes and repeated clicks never duplicate or spend credits',async()=>{
 const db=setup(),calls:string[]=[],progress:BatchProgress[]=[];try{
  const live=await pick6Batch(db,keys,'live',false,free,api(calls),NOW,p=>progress.push(p));assert.equal(live.created,4);assert.equal(live.analysis.providerStatus.providers.find(p=>p.id==='fanduelapi')!.configured,true);assert.equal(live.providerRequests,1);assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/v1/sports/football_nfl/odds?'));assert.deepEqual(progress.map(p=>p.stage),['cache','refresh','generate','save','complete']);
  const ids=live.records.map(r=>r.id),snapshots=db.prepare('SELECT id,legs_json FROM saved_tickets ORDER BY id').all();assert.equal(count(db,'saved_ticket_grades'),4);assert.ok(live.analysis.options.every(o=>o.ticket?.purpose==='pregame-research'));
  const paper=await pick6Batch(db,keys,'paper',false,free,api(calls),NOW+1000);assert.equal(paper.created,4);assert.equal(paper.providerRequests,0);assert.equal(calls.length,1);assert.equal(paperDashboard(db).availableCents,96000);assert.ok(paperDashboard(db).wagers.every(w=>w.status==='pending'&&w.stake_cents===1000));
  assert.deepEqual(paper.analysis.options.map(o=>fullSignature(o.ticket!)),live.analysis.options.map(o=>fullSignature(o.ticket!)));
  for(const o of live.analysis.options){const legs=o.ticket!.legs;assert.deepEqual(['QB','RB','WR','TE'].map(p=>legs.filter(l=>l.pos===p).length),[1,2,2,1]);assert.ok(Math.max(...[...new Set(legs.map(l=>l.gameId))].map(g=>legs.filter(l=>l.gameId===g).length))<=3);}
  const [again,paperAgain]=await Promise.all([pick6Batch(db,keys,'live',false,free,api(calls),NOW+2000),pick6Batch(db,keys,'paper',false,free,api(calls),NOW+2000)]);assert.equal(again.created,0);assert.equal(paperAgain.created,0);assert.deepEqual(again.records.map(r=>r.id),ids);assert.equal(calls.length,1);assert.equal(count(db,'saved_tickets'),4);assert.equal(count(db,'paper_wagers'),4);assert.equal(paperDashboard(db).availableCents,96000);assert.deepEqual(db.prepare('SELECT id,legs_json FROM saved_tickets ORDER BY id').all(),snapshots);const expired=await pick6Batch(db,keys,'paper',false,free,api(calls),NOW+6*60000);assert.equal(expired.created,0);assert.equal(expired.providerRequests,0);assert.equal(calls.length,1,'Existing four paper captures must not refresh even an expired request cache');
 }finally{db.close();}
});
test('parallel empty-cache actions coalesce refresh and atomically deduplicate all archives',async()=>{
 const db=setup(),calls:string[]=[];try{const results=await Promise.all([pick6Batch(db,keys,'live',false,free,api(calls),NOW),pick6Batch(db,keys,'live',false,free,api(calls),NOW)]);assert.equal(calls.length,1);assert.equal(results.reduce((n,r)=>n+r.created,0),4);assert.equal(count(db,'saved_tickets'),4);const papers=await Promise.all([pick6Batch(db,keys,'paper',false,free,api(calls),NOW+1000),pick6Batch(db,keys,'paper',false,free,api(calls),NOW+1000)]);assert.equal(papers.reduce((n,r)=>n+r.created,0),4);assert.equal(count(db,'paper_wagers'),4);assert.equal(paperDashboard(db).availableCents,96000);}finally{db.close();}
});
test('saved paper scope, TEST MODE restrictions and fresh empty coverage never spend extra requests or fabricate legs',async()=>{
 const db=setup(),calls:string[]=[];try{
  await assert.rejects(pick6Batch(db,keys,'paper',true,free,api(calls),NOW),/TEST MODE/);assert.equal(calls.length,0);
  const games=await paperGames(free,NOW);savePaperSelection(db,{mode:'GAMES',gameIds:[games[0].id]},games,NOW);await assert.rejects(pick6Batch(db,keys,'paper',false,free,api(calls),NOW),/at least two/);assert.equal(calls.length,0);
  savePaperSelection(db,{mode:'ALL',gameIds:[]},[],NOW);const empty=await pick6Batch(db,keys,'paper',false,free,async()=>{calls.push('empty');return Response.json([]);},NOW);assert.equal(empty.created,0);assert.equal(empty.missing.length,4);assert.equal(paperDashboard(db).availableCents,100000);
  const again=await pick6Batch(db,keys,'paper',false,free,api(calls),NOW+1000);assert.equal(again.created,0);assert.equal(calls.length,1);
 }finally{db.close();}
});
test('authentication, access, rate and service failures never retry or fall back to other providers',async()=>{
 for(const status of [401,403,429,503]){const db=setup();let calls=0;try{const request:typeof fetch=async()=>{calls++;return Response.json({detail:{error:status===429?'daily_limit_exceeded':'invalid_api_key'}},{status,headers:{'retry-after':'600'}});};await assert.rejects(pick6Batch(db,keys,'live',false,free,request,NOW));await assert.rejects(pick6Batch(db,keys,'paper',false,free,request,NOW+1000));assert.equal(calls,1);assert.equal(count(db,'saved_tickets'),0);assert.equal(count(db,'paper_wagers'),0);assert.equal(paperDashboard(db).availableCents,100000);}finally{db.close();}}
});
test('expired cache refreshes once; stale response never saves tickets or triggers immediate refill requests',async()=>{
 const db=setup(),calls:string[]=[];try{await refreshPropLine(db,KEY,'FULL','ALL',free,api(calls),NOW-301000);const stale:typeof fetch=async()=>{calls.push('stale');const body=[eventBody(0),eventBody(1)];for(const e of body)for(const m of e.bookmakers[0].markets){m.last_update=new Date(NOW-3600000).toISOString();for(const o of m.outcomes)o.last_seen_at=m.last_update;}return Response.json(body);};
  const batch=await pick6Batch(db,keys,'live',false,free,stale,NOW);assert.equal(batch.providerRequests,1);assert.equal(batch.created,0);assert.equal(batch.missing.length,4);const again=await pick6Batch(db,keys,'paper',false,free,stale,NOW+1000);assert.equal(again.providerRequests,0);assert.equal(calls.length,2);assert.equal(count(db,'saved_tickets'),0);assert.equal(count(db,'paper_wagers'),0);
 }finally{db.close();}
});
test('partial paper funding captures only affordable strategies and preserves honest missing reasons',async()=>{
 const db=setup(),calls:string[]=[];try{db.prepare('INSERT INTO paper_ledger(event_key,created_at,kind,amount_cents,note) VALUES(?,?,?,?,?)').run('fixture:reserve',NOW,'stake',-97500,'Isolated virtual accounting fixture');const batch=await pick6Batch(db,keys,'paper',false,free,api(calls),NOW);assert.equal(batch.created,2);assert.equal(batch.missing.length,2);assert.match(batch.notes.join(' '),/Insufficient/);assert.equal(paperDashboard(db).availableCents,500);assert.equal(paperDashboard(db).outstandingCents,2000);await assert.rejects(pick6Batch(db,keys,'paper',false,free,api(calls),NOW+6*60000),/Insufficient available/);assert.equal(calls.length,1);}finally{db.close();}
});
test('live TEST MODE stays labeled; automatic final grading preserves immutable records in both histories',async()=>{
 const db=setup(),calls:string[]=[];try{
  const live=await pick6Batch(db,keys,'live',true,free,api(calls),NOW);assert.equal(live.created,4);assert.ok(db.prepare('SELECT purpose FROM saved_tickets').all().every((r:any)=>r.purpose==='test-research'));
  await pick6Batch(db,keys,'paper',false,free,api(calls),NOW+1000);const before=db.prepare('SELECT id,legs_json FROM saved_tickets').all(),paperBefore=db.prepare('SELECT id,legs_json FROM paper_wagers').all();finishFixtureGames();await gradeSavedTickets(db,free,Date.parse(kickoff)+8*3600000);await gradePaperWagers(db,free,Date.parse(kickoff)+8*3600000);assert.ok(Object.values(savedGrades(db)).every(r=>r.status==='win'));assert.ok(paperDashboard(db).wagers.every(w=>w.status==='win'));assert.deepEqual(db.prepare('SELECT id,legs_json FROM saved_tickets').all(),before);assert.deepEqual(db.prepare('SELECT id,legs_json FROM paper_wagers').all(),paperBefore);
 }finally{db.close();}
});
