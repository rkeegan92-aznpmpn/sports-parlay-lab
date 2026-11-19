import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {gradePaperWagers,capturePaperSlate,previewPaper,paperDashboard,type PaperSlate} from '../src/server/paper.ts';
import {refreshPropLine} from '../src/server/propline.ts';
import {collectionCycle} from '../src/server/collectionCycle.ts';
import {KEY,NOW,kickoff,api,free} from './proplineFixtures.ts';
import {finishFixtureGames} from './manualFixtures.ts';
test('real grading pipeline uses verified final fixture statistics, persists outcomes and keeps archives separate through correction recheck',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const keys={fanduelapi:'','odds-api':'',propline:KEY};const slate:PaperSlate={key:'2026:10:2026-11-15',season:2026,week:10,date:'2026-11-15',firstKickoff:Date.parse(kickoff),gameIds:['2026_10_BUF_MIN','2026_10_LA_SEA'],label:'Synthetic lifecycle fixture'};
 try{
  await refreshPropLine(db,KEY,'FULL','ALL',free,api([]),NOW);await capturePaperSlate(db,slate,keys,free,NOW);assert.equal(paperDashboard(db).wagers.length,4);
  await gradePaperWagers(db,free,Date.parse(kickoff)-1);assert.ok(paperDashboard(db).wagers.every(w=>w.status==='pending'));
  finishFixtureGames();await collectionCycle(db,undefined,free,Date.parse(kickoff)+7*3600000);
  const d=paperDashboard(db);assert.ok(d.wagers.every(w=>w.status==='win'));assert.ok(d.wagers.every(w=>w.grades?.finalized));assert.ok(d.wagers.every(w=>w.grades?.legs.every(g=>g.actual===100&&g.resultSource==='nflverse')));assert.ok(d.summary.profitCents>0);assert.equal(d.outstandingCents,0);
  const before=JSON.stringify(db.prepare('SELECT * FROM paper_ledger').all());await gradePaperWagers(db,free,Date.parse(kickoff)+8*3600000);assert.equal(JSON.stringify(db.prepare('SELECT * FROM paper_ledger').all()),before);
  const {gunzipSync,gzipSync}=await import('node:zlib');const corrected:typeof fetch=async(input,init)=>{const r=await free(input,init);if(!String(input).endsWith('/assets/2026'))return r;const lines=gunzipSync(Buffer.from(await r.arrayBuffer())).toString().trim().split('\n'),header=lines[0].split(',');return new Response(gzipSync([lines[0],...lines.slice(1).map(line=>{const cells=line.split(',');if(cells[header.indexOf('player_display_name')]==='QB One'&&cells[header.indexOf('week')]==='10')cells[header.indexOf('passing_yards')]='0';return cells.join(',');})].join('\n')));};
  await gradePaperWagers(db,corrected,Date.parse(kickoff)+7.5*3600000);assert.ok(paperDashboard(db).wagers.every(w=>w.status==='win'),'An older delayed check must not override the check already recorded at +8h');
  await gradePaperWagers(db,corrected,Date.parse(kickoff)+9*3600000);assert.ok(paperDashboard(db).wagers.every(w=>w.status==='loss'));assert.equal(paperDashboard(db).availableCents,96000);assert.ok(paperDashboard(db).ledger.some((l:any)=>l.kind==='correction'));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get() as {n:number}).n,0);
 }finally{db.close();}
});
