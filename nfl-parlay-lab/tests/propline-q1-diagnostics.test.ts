import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {refreshPropLine,propLineEvidence,parsePropLineEvent} from '../src/server/propline.ts';
import {multiResearch} from '../src/server/multiProvider.ts';
import {KEY,NOW,OBSERVED,eventBody,api,free} from './proplineFixtures.ts';
const keys={fanduelapi:'','odds-api':'',propline:KEY};
test('cache evidence distinguishes genuinely empty filtered response, wrong periods, totals-only and rejected prices',async()=>{
 for(const state of ['empty','full-game','totals','stale','no-fanduel','valid'] as const){
  const db=new Database(':memory:');db.exec(SCHEMA);
  try{const body:any=eventBody(0,state==='full-game'?'FULL':'Q1');
   if(state==='totals')for(const b of body.bookmakers)for(const m of b.markets)m.key='totals';
   if(state==='stale')for(const b of body.bookmakers)for(const m of b.markets)for(const o of m.outcomes)o.last_seen_at=new Date(NOW-400000).toISOString();
   if(state==='no-fanduel')body.bookmakers[0].key='draftkings';
   await refreshPropLine(db,KEY,'Q1','ALL',free,async()=>Response.json(state==='empty'?[]:[body]),NOW);
   const d=propLineEvidence(db,KEY,'Q1','ALL',NOW);assert.equal(d.rawEvidenceAvailable,true);assert.equal(d.request?.periodParameter,'q1');assert.ok(d.request?.marketKeys.every(k=>!k.endsWith('_q1')));
   const expected={empty:'provider-returned-no-events-under-filters','full-game':'no-explicit-selected-period-markets',totals:'no-supported-period-player-markets',stale:'all-returned-player-prices-rejected','no-fanduel':'no-fanduel-bookmaker-returned',valid:'parsed-prices-present'}[state];assert.equal(d.status,expected);
   if(state==='stale'){assert.ok(d.rawCounts!.supportedPlayerOutcomes>0);assert.equal(d.parsedSidePrices,0);assert.ok(Object.keys(d.parserRejections).some(s=>s.includes('withdrawn')));}
   if(state==='valid')assert.ok(d.parsedSidePrices>0);
  }finally{db.close();}
 }
});
test('an explicit selected Q1 refresh is not swallowed by empty ALL cache; FULL cache reuse stays unchanged',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshPropLine(db,KEY,'Q1','ALL',free,async()=>Response.json([]),NOW);const borrowed=propLineEvidence(db,KEY,'Q1','2026_10_BUF_MIN',NOW);assert.equal(borrowed.borrowedAllCache,true);
  const snapshot=await refreshPropLine(db,KEY,'Q1','2026_10_BUF_MIN',free,api(calls),NOW+1);assert.equal(calls.length,2);assert.equal(snapshot.selectedGame,'2026_10_BUF_MIN');assert.equal(snapshot.diagnostics?.request.endpoint,'selected');assert.equal(snapshot.events.length,1);assert.ok(snapshot.rows['101'].length);
  const full=await refreshPropLine(db,KEY,'FULL','ALL',free,api(calls),NOW);const before=calls.length;const reuse=await refreshPropLine(db,KEY,'FULL','2026_10_BUF_MIN',free,api(calls),NOW+2);assert.equal(calls.length,before);assert.equal(reuse.at,full.at);
 }finally{db.close();}
});
test('a nonempty ALL Q1 cache with only another matchup does not suppress selected refresh, while matching prices are reused',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshPropLine(db,KEY,'Q1','ALL',free,async()=>Response.json([eventBody(1,'Q1')]),NOW);
  await refreshPropLine(db,KEY,'Q1','2026_10_BUF_MIN',free,api(calls),NOW+1);assert.equal(calls.length,2);
  await refreshPropLine(db,KEY,'Q1','2026_10_BUF_MIN',free,api(calls),NOW+2);assert.equal(calls.length,2);
 }finally{db.close();}
});
test('legacy snapshots never fabricate zero raw counts; inspections never modify archives or cache',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  await refreshPropLine(db,KEY,'Q1','ALL',free,api([]),NOW);const row=db.prepare("SELECT key,value FROM cache WHERE key LIKE 'propline:v1:snapshot:%'").get() as {key:string;value:string};const legacy=JSON.parse(row.value);delete legacy.diagnostics;legacy.rows={};legacy.rejections=['Missing explicit-zone market timestamp.'];db.prepare('UPDATE cache SET value=? WHERE key=?').run(JSON.stringify(legacy),row.key);
  const before=JSON.stringify(db.prepare('SELECT * FROM cache').all()),d=propLineEvidence(db,KEY,'Q1','2026_10_BUF_MIN',NOW);assert.equal(d.status,'legacy-raw-evidence-unavailable');assert.equal(d.rawCounts,null);assert.equal(d.parsedSidePrices,0);assert.ok(d.retainedMarketIdentifiers.includes('player_pass_yds:q1'));assert.ok(d.retainedRejectionReasons.includes('Missing explicit-zone market timestamp.'));assert.ok(d.missing.some(s=>s.includes('cannot establish')));assert.equal(JSON.stringify(db.prepare('SELECT * FROM cache').all()),before);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0);
 }finally{db.close();}
});
test('model eligibility diagnostics follow raw parser counts without weakening history, injury or timestamp checks',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  await refreshPropLine(db,KEY,'Q1','ALL',free,api([]),NOW);const r=await multiResearch(db,keys,'Q1','2026_10_BUF_MIN',free,NOW);
  assert.ok(r.propLineDiagnostics.rawCounts!.supportedPlayerOutcomes>0);assert.ok(r.propLineDiagnostics.pipeline.selectedSidePrices>0);assert.ok(r.propLineDiagnostics.pipeline.availabilityVerifiedCandidates>0);assert.ok(r.propLineDiagnostics.pipeline.eligibleBestSidePrices>0);
  const stale=await multiResearch(db,keys,'Q1','2026_10_BUF_MIN',free,NOW+31*60000);assert.equal(stale.propLineDiagnostics.pipeline.freshProviderSidePrices,0);assert.ok(stale.options.every(s=>!s.ticket));
  assert.equal(parsePropLineEvent(eventBody(0,'FULL'),'Q1',NOW).rows.length,0);
 }finally{db.close();}
});

test('returned Q1 prices with missing current injury coverage remain blocked and show the player-data cause',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  await refreshPropLine(db,KEY,'Q1','ALL',free,api([]),NOW);
  const missingInjuries:typeof fetch=async(input,init)=>String(input).endsWith('/nfl/injuries')?new Response('{}',{status:503}):free(input,init);
  const r=await multiResearch(db,keys,'Q1','2026_10_BUF_MIN',missingInjuries,NOW);assert.ok(r.propLineDiagnostics.rawCounts!.supportedPlayerOutcomes>0);assert.ok(r.propLineDiagnostics.pipeline.selectedSidePrices>0);assert.equal(r.propLineDiagnostics.playerAnalysis?.injurySnapshotAvailable,false);assert.ok(r.propLineDiagnostics.playerAnalysis?.availabilityRejections.length);assert.ok(r.options.every(s=>!s.ticket));
 }finally{db.close();}
});
