import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import {SCHEMA} from '../src/server/db.ts';
import {cachedProviderFetch} from '../src/server/load.ts';
import {runHistorical} from '../src/server/historical.ts';
import {gradeSavedTickets,savedGrades} from '../src/server/savedGrades.ts';
import {collectionCycle} from '../src/server/collectionCycle.ts';
import {loadSchedule} from '../src/lib/providers/stats.ts';
import {verifyCurrentRoster} from '../src/lib/providers/espn.ts';
import {currentSeason} from '../src/lib/service.ts';
const cwd=fileURLToPath(new URL('../',import.meta.url));process.chdir(cwd);
createRequire(import.meta.url)('@next/env').loadEnvConfig(cwd,process.env.NODE_ENV!=='production',{info(){},error(){}});
const db=new Database(':memory:');db.exec(SCHEMA);let paidRequests=0;
const f=cachedProviderFetch(db,async(input,init)=>{if(String(input).includes('the-odds-api.com')){paidRequests++;throw new Error('Paid access forbidden');}return fetch(input,init);});
try{
 const year=Number(process.argv.find(a=>a.startsWith('--season='))?.split('=')[1]??currentSeason());
 const result=await runHistorical(db,year,f,true);
 assert.ok(result.tickets.length>0,'No historical tickets generated');
 assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0,'BACKTEST must never create upcoming saved tickets');
 const ticket=result.tickets.find(t=>t.finalized)!;assert.ok(ticket,'No completed simulated ticket');
 const legs=ticket.legs.map(l=>({...l,name:l.player,historyPlayerId:l.playerId,resultGameId:l.gameId,kickoff:new Date(l.kickoff).toISOString(),odds:null,source:'BACKTEST-GRADING-PROBE'}));
 // Explicit isolated counterfactual contracts, never claimed as historical FanDuel odds or genuine saved forecasts.
 db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run(ticket.kind,ticket.capturedAt,'BACKTEST-GRADING-PROBE',JSON.stringify(legs),'verification-only');
 const before=db.prepare('SELECT * FROM saved_tickets').all();
 await collectionCycle(db,undefined,f);
 const grade=savedGrades(db)[1];assert.equal(grade.finalized,true);assert.equal(grade.status,ticket.status);assert.ok(grade.legs.every(l=>l.status==='pending'||l.status==='void'||Number.isFinite(l.actual)));
 await gradeSavedTickets(db,f);assert.deepEqual(db.prepare('SELECT * FROM saved_tickets').all(),before,'Grading cannot overwrite or duplicate tickets');
 assert.equal((db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get() as {n:number}).n,0,'No synthetic calibration forecasts');
 const schedule=await loadSchedule(f);
 const roster=await verifyCurrentRoster(ticket.legs.map((l,i)=>({key:String(i),name:l.player,position:l.pos,team:l.team})),f);
 const fallbackDb=new Database(':memory:');fallbackDb.exec(SCHEMA);
 let fallbackEvidence:unknown;
 try {
  const bridged=legs.map((l,i)=>{const athlete=roster.players.get(String(i)),event=schedule.find(g=>g.game_id===l.gameId);return {...l,espnPlayerId:athlete&&/^\d+$/.test(athlete.id)?`espn:${athlete.id}`:undefined,espnEventId:event&&/^\d+$/.test(event.espn??'')?event.espn:undefined};});
  fallbackDb.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run(ticket.kind,ticket.capturedAt,'BACKTEST-GRADING-PROBE',JSON.stringify(bridged),'verification-only');
  const scheduleOutage:typeof fetch=async(input,init)=>String(input).includes('games.csv')?new Response('Controlled primary schedule outage',{status:503}):f(input,init);
  const fallbackRun=await gradeSavedTickets(fallbackDb,scheduleOutage);
  const fallbackGrade=savedGrades(fallbackDb)[1],verified=fallbackGrade.legs.filter(l=>l.resultSource==='espn'&&Number.isFinite(l.actual));
  assert.ok(verified.length>0,'No real ESPN exact-bridge fallback result verified');
  const mismatches=verified.filter(l=>grade.legs.find(g=>g.player===l.player)?.actual!==l.actual);
  assert.equal(mismatches.length,0,'Free sources disagree on completed statistics');
  fallbackEvidence={status:'PASS',primarySchedule:'controlled-unavailable',realEspnVerifiedLegs:verified.length,actuals:verified.map(l=>({player:l.player,actual:l.actual,eventId:l.resultGameId})),providerWarnings:fallbackRun.providerErrors.length,note:'Real ESPN final responses using stored exact bridges, with a controlled primary outage in an isolated memory DB. No private tickets touched.'};
 }finally{fallbackDb.close();}
 console.log(JSON.stringify({status:'PASS',season:year,version:result.version,backtestTickets:result.tickets.length,metrics:result.metrics,missingSlates:result.skipped.length,
  espnFallback:fallbackEvidence,gradingProbe:{ticketStatus:grade.status,finalized:grade.finalized,legs:grade.legs,contractProvenance:'Counterfactual benchmark lines in an isolated in-memory verification database. No historical FanDuel odds or authentic pregame forecast timestamps claimed.'},paidRequests,limits:['Historical injuries/rosters and point-in-time publication/revision archives unavailable.','24-hour statistics-availability assumption; benchmark results do not validate the live model.','Private Codespaces tickets were not accessed.']},null,2));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:'Real free-source evaluation verification failed; existing app data was not accessed.');process.exitCode=1;}finally{db.close();}
