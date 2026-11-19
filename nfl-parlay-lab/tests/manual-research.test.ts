import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {freeSchedule,freePlayers,parseManualQuote,manualResearch,ManualInputError} from '../src/server/freeResearch.ts';
import {fetcher,players,NOW,kickoff,finishFixtureGames} from './manualFixtures.ts';
import {SCHEMA} from '../src/server/db.ts';
import {saveTicket,listSavedTickets} from '../src/server/savedTickets.ts';
import {gradeSavedTickets,savedGrades,ticketGrade} from '../src/server/savedGrades.ts';
import {canRecordForecast} from '../src/server/tracking.ts';
import {eligible,makeTicket,validateLegs} from '../src/lib/optimizer.ts';
const quotes=()=>players.map(p=>({eventId:p[5]==='g1'?'2026_10_BUF_MIN':'2026_10_LA_SEA',player:p[0],market:p[4],side:'Over',line:50.5,odds:p[0]==='RB Aggressive'?190:-110,observedAt:new Date(NOW).toISOString(),confirmed:true}));

test('free schedule and manual six-pick pipeline never call paid providers and retain explicit manual provenance',async()=>{
 let paid=0;const f:typeof fetch=async(input,init)=>{if(String(input).includes('the-odds-api.com')){paid++;throw new Error('Paid requests forbidden');}return fetcher(input,init);};
 const events=await freeSchedule(f,NOW);assert.equal(events.length,2);
 assert.equal(Date.parse(events[0].commence_time),Date.parse(kickoff));
 const people=await freePlayers(events[0],f,NOW);assert.ok(people.players.some(p=>p.name==='QB One'));
 const r=await manualResearch(quotes(),f,NOW);
 assert.ok(r.best.options.length);assert.ok(r.aggr.options.length);assert.equal(paid,0);
 const best=r.best.options[0],aggr=r.aggr.options[0];assert.ok(aggr.decimal>best.decimal);
 assert.notDeepEqual(best.legs.map(l=>l.id).sort(),aggr.legs.map(l=>l.id).sort());
 for(const t of [best,aggr]){
  assert.deepEqual(validateLegs(t.legs),[]);assert.equal(t.purpose,'manual-research');
  assert.ok(t.legs.every(l=>l.source==='manual'&&l.quoteVerified===false&&l.manualQuoteConfirmed===true));
  assert.ok(t.legs.every(l=>!canRecordForecast(l,NOW)),'manual quotes never validate live calibration');
  assert.ok(t.warnings.some(w=>w.includes('not independently verified live')));
 }
 const leg=best.legs[0];assert.equal(eligible('best',{...leg,manualQuoteConfirmed:false},NOW),false);
 assert.throws(()=>makeTicket(best.legs,'best',{modelValidated:true,now:NOW}),/research only/);
 const testResearch=await manualResearch(quotes(),f,NOW,true);assert.equal(testResearch.best.options[0].purpose,'test-research');
});

test('manual input rejects stale, future, unconfirmed, unsupported and fabricated contract fields',async()=>{
 const events=await freeSchedule(fetcher,NOW),base=quotes()[0];
 for(const patch of [{confirmed:false},{odds:0},{line:null},{side:'Yes'},{market:'invented'},
  {eventId:'invented'},{observedAt:new Date(NOW-31*60000).toISOString()}, {observedAt:new Date(NOW+6*60000).toISOString()}]) {
   assert.throws(()=>parseManualQuote({...base,...patch},events,NOW),ManualInputError);
 }
 const unavailable=await manualResearch([{...base,player:'Invented Player'}],fetcher,NOW);
 assert.equal(unavailable.best.options.length,0);assert.equal(unavailable.candidates.length,0);
});

test('free pregame schedule rejects future-dated records already carrying results or missing exact kickoffs',async()=>{
 const f:typeof fetch=async()=>new Response('game_id,season,week,game_type,gameday,gametime,home_team,away_team,home_score,away_score\n2026_10_BUF_MIN,2026,10,REG,2026-11-15,13:00,MIN,BUF,21,20\n2026_10_LA_SEA,2026,10,REG,2026-11-15,,SEA,LA,,');
 assert.deepEqual(await freeSchedule(f,NOW),[]);
});

test('manual archives grade verified finals independently from live calibration and preserve records',async()=>{
 const r=await manualResearch(quotes(),fetcher,NOW);
 const db=new Database(':memory:');db.exec(SCHEMA);
 try {
  const saved=saveTicket(db,{...r.best.options[0],kind:'best'},NOW);
  assert.equal(saved.source,'manual');assert.equal(saved.purpose,'manual-research');
  const before=listSavedTickets(db)[0].legs_json;
  const future=await gradeSavedTickets(db,fetcher,NOW);assert.equal(future.checked,1);assert.equal(savedGrades(db)[saved.id].status,'pending');
  finishFixtureGames();await gradeSavedTickets(db,fetcher,Date.parse(kickoff)+8*3600_000);
  assert.equal(savedGrades(db)[saved.id].status,'win');
  assert.equal(listSavedTickets(db)[0].legs_json,before);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get() as {n:number}).n,0);
  assert.equal(ticketGrade([{player:'A',status:'pending',hit:null}]),'pending');
 }finally{db.close();}
});


test('archive grading keeps pushes, missing results and losses separate without inventing payouts',()=>{
 const win={player:'fixture',status:'settled' as const,hit:1 as const};
 const push={player:'fixture',status:'push' as const,hit:null};
 const pending={player:'fixture',status:'pending' as const,hit:null,reason:'missing-result'};
 assert.equal(ticketGrade(Array(6).fill(push)),'void');
 assert.equal(ticketGrade([push,...Array(5).fill(win)]),'push-adjusted-win');
 assert.equal(ticketGrade([{...win,hit:0},...Array(5).fill(win)]),'loss');
 assert.equal(ticketGrade([pending,...Array(5).fill(win)]),'pending');
});
