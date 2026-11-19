import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {cachedResearchBoard,type Board} from '../src/server/fanduelRest.ts';
import {fanduelQuarterResearch} from '../src/server/firstQuarterResearch.ts';
import {fetcher,NOW,kickoff} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
const board=():Board=>{
 const at=new Date(NOW-3*3600_000).toISOString(),meta={asOf:at,observedAt:at,delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
 return {complete:true,fetchedAt:NOW-3600000,events:[{record:{id:'fd-q1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff},meta}],props:[['QB One','BUF','passing_yards'],['RB One','BUF','rushing_yards'],['WR One','MIN','receiving_yards']].map(([player,team,stat],i)=>({meta,record:{id:'q'+i,event_id:'fd-q1',sport:'football',league:'NFL',starts_at:kickoff,player,team,stat,period:'q1',market_status:'open',line:20.5,over_american:-110,under_american:110,observed_at:at}}))};
};
const free:typeof fetch=async(input,init)=>{if(/fanduelapi.com|the-odds-api.com/.test(String(input)))throw new Error('No odds-provider requests allowed');if(String(input).includes('play_by_play_'))return new Response(quarterCsv(String(input).includes('2026')?2026:2025));return fetcher(input,init);};
test('newer provider failure blocks regular generation but cannot invalidate explicit cached research',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const key='synthetic-test-only',id=createHash('sha256').update(key).digest('hex').slice(0,24),b=board();
 db.prepare('INSERT INTO cache VALUES(?,?,?)').run(`fanduel-rest:board:${id}`,JSON.stringify(b),b.fetchedAt);
 db.prepare('INSERT INTO cache VALUES(?,?,?)').run(`fanduel-rest:failure:${id}`,JSON.stringify({at:NOW}),NOW);
 db.prepare('INSERT INTO cache VALUES(?,?,?)').run(`fanduel-rest:cooldown:${id}`,JSON.stringify({until:NOW+86400000,status:429}),NOW);
 try{
  const before=db.prepare('SELECT * FROM cache ORDER BY key').all();
  assert.throws(()=>cachedResearchBoard(db,key),/A newer provider failure makes this cached board unverified/);
  const cached=cachedResearchBoard(db,key,true);assert.deepEqual(cached.board,b);assert.match(cached.providerWarning!,/No provider retry/);
  const r=await fanduelQuarterResearch(cached.board,free,NOW,'2026-11-15','ALL',true);assert.equal(r.preview!.options.length,2);assert.equal(r.previewDiagnostics!.options,2);assert.equal(r.previewDiagnostics!.bestEligiblePlayers,3);assert.equal(r.diagnostics.freshSidePrices,0);assert.equal(r.best.options.length,0);
  assert.deepEqual(db.prepare('SELECT * FROM cache ORDER BY key').all(),before);assert.throws(()=>cachedResearchBoard(db,key),/newer provider failure/);
 }finally{db.close();}
});
test('missing, corrupt and incomplete cache report storage blockers without requesting fresh odds',()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const key='test',id=createHash('sha256').update(key).digest('hex').slice(0,24);
 try{
  assert.throws(()=>cachedResearchBoard(db,key,true),/No readable cached/);
  db.prepare('INSERT INTO cache VALUES(?,?,?)').run(`fanduel-rest:board:${id}`,'broken JSON',NOW);assert.throws(()=>cachedResearchBoard(db,key,true),/No readable cached/);
  db.prepare('UPDATE cache SET value=?').run(JSON.stringify({...board(),complete:false}));assert.throws(()=>cachedResearchBoard(db,key,true),/Incomplete cached/);
 }finally{db.close();}
});
test('free schedule failure preserves cached Q1 diagnostics and explains why zero previews can match games',async()=>{
 const b=board(),original=JSON.stringify(b),f:typeof fetch=async(input,init)=>String(input).includes('games.csv')?new Response('unavailable',{status:503}):free(input,init);
 const r=await fanduelQuarterResearch(b,f,NOW,'2026-11-15','ALL',true);
 assert.equal(r.preview!.options.length,0);assert.equal(r.previewDiagnostics!.rawQ1Rows,3);assert.equal(r.previewDiagnostics!.dataAvailability.schedule,'unavailable');assert.equal(r.previewDiagnostics!.selectedGames,0);assert.match(r.missing.join(' '),/schedule retrieval failed/);assert.ok(r.diagnostics.rejections.some(r=>r.stage==='schedule-provider'));assert.equal(JSON.stringify(b),original);
 await assert.rejects(()=>fanduelQuarterResearch(b,f,NOW));
});
test('partial player pool and absent injury coverage return concrete blockers instead of blank preview',async()=>{
 const b=board();b.props=b.props.slice(0,2);const r=await fanduelQuarterResearch(b,free,NOW,'2026-11-15','ALL',true);
 assert.equal(r.previewDiagnostics!.previewInputSidePrices,4);assert.equal(r.previewDiagnostics!.bestEligiblePlayers,2);assert.equal(r.preview!.options.length,0);assert.match(r.preview!.missing.join(' '),/have 2/);
 const missingInjury:typeof fetch=async(input,init)=>String(input).endsWith('/nfl/injuries')?new Response('{}',{status:503}):free(input,init);
 const blocked=await fanduelQuarterResearch(board(),missingInjury,NOW,'2026-11-15','ALL',true);assert.equal(blocked.previewDiagnostics!.availabilityEligibleSideProps,0);assert.equal(blocked.previewDiagnostics!.options,0);assert.ok(blocked.rejectionGroups.some(g=>g.category==='player availability'));assert.match(blocked.missing.join(' '),/injury/);
});
test('wrong Sunday selection does not silently include another week to fill a preview',async()=>{
 const r=await fanduelQuarterResearch(board(),free,NOW,'2026-11-22','ALL',true);assert.equal(r.previewDiagnostics!.selectedGames,0);assert.equal(r.preview!.options.length,0);assert.match(r.missing.join(' '),/Other dates\/weeks were not substituted/);assert.ok(r.rejectionGroups.some(g=>g.category==='outside selected window'));
});
