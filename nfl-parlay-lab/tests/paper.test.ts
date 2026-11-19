import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {PAPER_SCHEMA} from '../src/server/paperSchema.ts';
import {paperSelection,savePaperSelection,resolvePaperSelection,paperGames,capturePaperTicket,capturePaperSlate,paperDashboard,paperConfig,updatePaperConfig,paperWindow,paperSlates,previewPaper,gradePaperWagers,reconcilePaperLedger,paperReturn,type PaperSlate} from '../src/server/paper.ts';
import {refreshPropLine} from '../src/server/propline.ts';
import {paperColor,paperLabel,PAPER_STRATEGIES} from '../src/lib/paper.ts';
import type {LegGrade} from '../src/server/savedGrades.ts';
import type {Ticket,Candidate} from '../src/lib/types.ts';
import {KEY,NOW,kickoff,free,api} from './proplineFixtures.ts';
const keys={fanduelapi:'','odds-api':'',propline:KEY};
const slate:PaperSlate={key:'2026:10:2026-11-15',season:2026,week:10,date:'2026-11-15',firstKickoff:Date.parse(kickoff),gameIds:['2026_10_BUF_MIN','2026_10_LA_SEA'],label:'Synthetic NFL fixture slate'};
async function setup(integerLines=false){const db=new Database(':memory:');db.exec(SCHEMA);await refreshPropLine(db,KEY,'FULL','ALL',free,async(input,init)=>{const r=await api([])(input,init);if(!integerLines)return r;const body=await r.json();for(const e of body)for(const b of e.bookmakers)for(const m of b.markets)for(const o of m.outcomes)if(typeof o.point==='number')o.point=Math.floor(o.point);return Response.json(body);},NOW);const result=await previewPaper(db,slate,keys,free,NOW);assert.equal(result.options.filter(o=>o.ticket).length,4);return {db,result,ticket:result.options[0].ticket!};}
function grades(legs:Candidate[],status:'win'|'loss'|'push'|'void'|'pending'='win'):LegGrade[]{return legs.map(l=>({rulesVersion:'research-fullgame-v1',player:l.name,pos:l.pos,market:l.market,side:l.side,line:l.line,status:status==='win'||status==='loss'?'settled':status,hit:status==='win'?1:status==='loss'?0:null,actual:status==='pending'||status==='void'?null:status==='push'?l.line!:status==='win'?(l.side==='Under'?0:100):(l.side==='Under'?100:0),reason:status==='void'?'explicit-final-boxscore-did-not-play':status==='pending'?'missing-player-result':'verified-final-result',...(status==='pending'?{}:{resultSource:'nflverse',resultGameId:l.resultGameId!,resultDate:'2026-11-15'})}));}
function putGrades(db:Database.Database,id:number,legs:LegGrade[],now=NOW+864000000){db.prepare('UPDATE paper_ticket_grades SET legs_json=?,status=?,checked_at=?,finalized=? WHERE ticket_id=?').run(JSON.stringify(legs),'unused-derived-by-paper',now,Number(legs.every(g=>g.status!=='pending')),id);reconcilePaperLedger(db,now);}

test('additive migration preserves existing records and seeds exactly one $1000 append-only virtual ledger',()=>{
 const db=new Database(':memory:');try{
  db.exec("CREATE TABLE saved_tickets(id INTEGER PRIMARY KEY,legs_json TEXT);INSERT INTO saved_tickets VALUES(99,'existing archive');CREATE TABLE cache(key TEXT PRIMARY KEY,value TEXT,fetched_at INTEGER);INSERT INTO cache VALUES('existing','unchanged',1);");
  db.exec(PAPER_SCHEMA);db.exec(PAPER_SCHEMA);assert.equal((db.prepare('SELECT SUM(amount_cents) n FROM paper_ledger').get() as {n:number}).n,100000);assert.equal((db.prepare('SELECT COUNT(*) n FROM paper_ledger').get() as {n:number}).n,1);assert.equal((db.prepare('SELECT legs_json FROM saved_tickets').get() as {legs_json:string}).legs_json,'existing archive');assert.equal((db.prepare("SELECT value FROM cache WHERE key='existing'").get() as {value:string}).value,'unchanged');assert.throws(()=>db.prepare('UPDATE paper_ledger SET amount_cents=0').run(),/append-only/);
 }finally{db.close();}
});
test('four immutable $10 wagers debit $40 once per slate/strategy, remain Pending, and leave existing archives/calibration untouched',async()=>{
 const {db,result}=await setup();try{
  const r=await capturePaperSlate(db,slate,keys,free,NOW,'manual',undefined,async()=>result);assert.equal(r.captured,4);
  const dash=paperDashboard(db,NOW);assert.equal(dash.availableCents,96000);assert.equal(dash.outstandingCents,4000);assert.equal(dash.bankrollCents,100000);assert.equal(dash.summary.profitCents,0);assert.equal(dash.wagers.length,4);assert.ok(dash.wagers.every(w=>w.status==='pending'));
  let generated=0;await capturePaperSlate(db,slate,keys,free,NOW+1,'manual',undefined,async()=>{generated++;return result;});assert.equal(generated,0);assert.equal(paperDashboard(db).availableCents,96000);
  assert.throws(()=>db.prepare('UPDATE paper_wagers SET legs_json=?').run('[]'),/immutable/);assert.throws(()=>db.prepare('DELETE FROM paper_wagers').run(),/immutable/);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get() as {n:number}).n,0);
 }finally{db.close();}
});
test('TEST MODE, demo, manual/unverified, stale, mismatched, post-kickoff and client-fabricated evidence are rejected atomically',async()=>{
 const {db,ticket}=await setup();try{
  for(const fault of ['test','demo','manual','no-proof','q1','stale','wrong-price','post-kickoff','future-observation']){
   const t:Ticket=structuredClone(ticket);if(fault==='test')t.purpose='test-research';if(fault==='demo')t.legs[0].source='demo';if(fault==='manual')t.legs[0].source='manual';if(fault==='no-proof')delete t.legs[0].quoteEvidence;if(fault==='q1')t.legs[0].quoteEvidence!.period='Q1';if(fault==='stale')t.legs[0].quoteEvidence!.status='stale-or-unverified';if(fault==='wrong-price')t.legs[0].quoteEvidence!.american=999;if(fault==='post-kickoff')t.legs[0].kickoff=new Date(NOW-1).toISOString();if(fault==='future-observation')t.legs[0].oddsAt=new Date(NOW+1000).toISOString();
   assert.throws(()=>capturePaperTicket(db,slate,'Safer',t,'manual',NOW),fault);assert.equal(paperDashboard(db).availableCents,100000);assert.equal(paperDashboard(db).wagers.length,0);
  }
 }finally{db.close();}
});
test('ledger grades win/loss, mixed push/void adjustments, all-neutral refunds and corrections without duplicate credits',async()=>{
 const {db,ticket}=await setup(true);try{
  const placed=capturePaperTicket(db,slate,'Safer',ticket,'manual',NOW),before=db.prepare('SELECT legs_json FROM paper_wagers').get() as {legs_json:string};
  const won=grades(ticket.legs);putGrades(db,placed.id,won);const payout=Math.round(ticket.decimal*1000);let d=paperDashboard(db);assert.equal(d.availableCents,99000+payout);assert.equal(d.summary.profitCents,payout-1000);assert.equal(d.outstandingCents,0);
  const entries=(db.prepare('SELECT COUNT(*) n FROM paper_ledger').get() as {n:number}).n;putGrades(db,placed.id,won);assert.equal((db.prepare('SELECT COUNT(*) n FROM paper_ledger').get() as {n:number}).n,entries);
  const loss=grades(ticket.legs);loss[0]={...loss[0],hit:0,actual:0};putGrades(db,placed.id,loss);d=paperDashboard(db);assert.equal(d.availableCents,99000);assert.equal(d.summary.profitCents,-1000);assert.ok(d.ledger.some((l:any)=>l.kind==='correction'&&l.amount_cents===-payout));
  const adjusted=grades(ticket.legs);adjusted[0]=grades(ticket.legs,'push')[0];adjusted[1]=grades(ticket.legs,'void')[1];putGrades(db,placed.id,adjusted);d=paperDashboard(db);const expected=Math.round(1000*ticket.legs.slice(2).reduce((v,l)=>v*(l.odds>0?1+l.odds/100:1+100/-l.odds),1));assert.equal(d.wagers[0].status,'push-adjusted-win');assert.equal(d.wagers[0].return_cents,expected);
  putGrades(db,placed.id,grades(ticket.legs,'push'));d=paperDashboard(db);assert.equal(d.wagers[0].status,'push');assert.equal(d.availableCents,100000);assert.equal(d.summary.profitCents,0);
  putGrades(db,placed.id,grades(ticket.legs,'void'));assert.equal(paperDashboard(db).wagers[0].status,'void');assert.equal(paperDashboard(db).availableCents,100000);
  assert.equal((db.prepare('SELECT legs_json FROM paper_wagers').get() as {legs_json:string}).legs_json,before.legs_json);
 }finally{db.close();}
});
test('partial multi-game results stay pending, verified early loss continues grading, and loss correction back to Pending restores reserved stake',async()=>{
 const {db,ticket}=await setup();try{
  const {id}=capturePaperTicket(db,slate,'Balanced',ticket,'manual',NOW),partial=grades(ticket.legs,'pending');partial[0]=grades(ticket.legs)[0];putGrades(db,id,partial);assert.equal(paperDashboard(db).wagers[0].status,'pending');assert.equal(paperDashboard(db).outstandingCents,1000);
  partial[0]={...partial[0],hit:0,actual:0};putGrades(db,id,partial);assert.equal(paperDashboard(db).wagers[0].status,'loss');assert.equal(paperDashboard(db).summary.profitCents,-1000);assert.equal(paperDashboard(db).outstandingCents,0);
  putGrades(db,id,grades(ticket.legs,'pending'));assert.equal(paperDashboard(db).outstandingCents,1000);assert.equal(paperDashboard(db).summary.profitCents,0);assert.equal(paperDashboard(db).availableCents,99000);
  const missing=grades(ticket.legs);delete missing[0].resultSource;assert.equal(paperReturn(ticket.legs,missing).status,'pending');
 }finally{db.close();}
});
test('weekly/season/strategy metrics use original NFL slate, expose accessible colors and do not count pushes as losses',async()=>{
 const {db,ticket}=await setup(true);try{
  const first=capturePaperTicket(db,slate,'Safer',ticket,'manual',NOW);putGrades(db,first.id,grades(ticket.legs));const second=capturePaperTicket(db,slate,'Long Shot',ticket,'manual',NOW);putGrades(db,second.id,grades(ticket.legs,'push'));
  const d=paperDashboard(db);assert.equal(d.weekly[0].key,'2026 week 10');assert.equal(d.seasons[0].key,'2026');assert.equal(d.summary.pushes,1);assert.equal(d.summary.losses,0);assert.equal(d.strategies.find(s=>s.strategy==='Long Shot')!.profitCents,0);assert.equal(d.summary.legAccuracy,1);assert.equal(d.summary.ticketAccuracy,1);const filtered=paperDashboard(db,NOW,{strategy:'Long Shot'});assert.equal(filtered.wagers.length,1);assert.equal(filtered.wagers[0].strategy,'Long Shot');assert.equal(filtered.availableCents,d.availableCents);assert.equal(paperDashboard(db,NOW,{before:second.id}).wagers[0].id,first.id);
  assert.deepEqual(['win','loss','pending','push','void'].map(paperColor),['green','red','yellow','gray','gray']);assert.equal(paperLabel('push-adjusted-win'),'Win (push/void adjusted)');
 }finally{db.close();}
});
test('configured automatic windows close before kickoff; a restarted app cannot move an already missed date window',async()=>{
 const {db}=await setup();try{
  const c=paperConfig(db);assert.equal(paperWindow(slate,c,slate.firstKickoff-60*60000).due,true);assert.equal(paperWindow(slate,c,slate.firstKickoff-10*60000).due,false);assert.equal(paperWindow(slate,c,slate.firstKickoff+1).due,false);
  updatePaperConfig(db,{enabled:true,leadMinutes:60,closeMinutes:10,days:[0]},NOW);assert.equal(paperConfig(db).leadMinutes,60);assert.throws(()=>updatePaperConfig(db,{enabled:true,leadMinutes:10,closeMinutes:20,days:[0]}));
  const slates=await paperSlates(free,Date.parse(kickoff)+1);assert.equal(slates[0].firstKickoff,Date.parse(kickoff));assert.equal(paperWindow(slates[0],paperConfig(db),Date.parse(kickoff)+1).due,false);updatePaperConfig(db,{enabled:false,leadMinutes:120,closeMinutes:15,days:[0]},NOW);assert.equal(paperWindow(slate,paperConfig(db),slate.firstKickoff-60*60000).due,false);
 }finally{db.close();}
});

test('bankroll cannot be overdrawn by capture',async()=>{
 const {db,ticket}=await setup();try{
  // Explicit test-only accounting fixture reserves $995, leaving less than the fixed $10 stake.
  db.prepare('INSERT INTO paper_ledger(event_key,created_at,kind,amount_cents,note) VALUES(?,?,?,?,?)').run('fixture:reserved',NOW,'stake',-99500,'Isolated test reserve');
  assert.throws(()=>capturePaperTicket(db,slate,'Safer',ticket,'manual',NOW),/Insufficient/);assert.equal(paperDashboard(db).availableCents,500);assert.equal(paperDashboard(db).wagers.length,0);
 }finally{db.close();}
});
test('capture window and pregame proof still apply after generation takes time or app resumes after kickoff',async()=>{
 const {db,result}=await setup();try{
  const missed=await capturePaperSlate(db,slate,keys,free,slate.firstKickoff+1,'automatic',undefined,async()=>result);assert.equal(missed.captured,0);assert.equal(paperDashboard(db).availableCents,100000);
  const elapsed=await capturePaperSlate(db,slate,keys,free,slate.firstKickoff-15*60000-5,'automatic',undefined,async()=>{await new Promise(r=>setTimeout(r,20));return result;});assert.equal(elapsed.captured,0);assert.ok(elapsed.notes.some(n=>n.includes('window closed')));
 }finally{db.close();}
});

test('two persistent database connections deduplicate replay and preserve bankroll across reopen',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const folder=mkdtempSync(join(tmpdir(),'paper-ledger-')),file=join(folder,'ledger.db');const {db,ticket}=await setup();db.close();
 const one=new Database(file),two=new Database(file);one.exec(SCHEMA);two.exec(SCHEMA);
 try{const a=capturePaperTicket(one,slate,'Safer',ticket,'manual',NOW),b=capturePaperTicket(two,slate,'Safer',ticket,'manual',NOW+1);assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(a.id,b.id);assert.equal(paperDashboard(two).availableCents,99000);}finally{one.close();two.close();}
 const reopened=new Database(file);try{reopened.exec(SCHEMA);assert.equal(paperDashboard(reopened).availableCents,99000);assert.equal(paperDashboard(reopened).wagers.length,1);}finally{reopened.close();rmSync(folder,{recursive:true,force:true});}
});

test('paper scopes default ALL, persist Sunday/multi-game selections, use NFL Eastern dates and canonical set identities',async()=>{
 const {db}=await setup();try{
  assert.deepEqual(paperSelection(db),{mode:'ALL',gameIds:[]});
  const base=(await paperGames(free,NOW))[0];
  const game=(id:string,kickoff:string,week=10)=>({...base,id,commence_time:kickoff,week});
  const games=[game('thu','2026-11-13T01:15:00.000Z'),game('sat','2026-11-14T18:00:00.000Z'),game('sun','2026-11-15T18:00:00.000Z'),game('sun-late','2026-11-16T01:20:00.000Z'),game('mon','2026-11-17T01:15:00.000Z'),game('next-sun','2026-11-22T18:00:00.000Z',11)];
  const all=resolvePaperSelection(games,paperSelection(db),NOW);assert.equal(all.gameIds.length,6);assert.equal(all.firstKickoff,Date.parse(games[0].commence_time));
  const sunday=resolvePaperSelection(games,{mode:'SUNDAY',gameIds:[]},NOW);assert.deepEqual(sunday.gameIds,['next-sun','sun','sun-late']);assert.equal(sunday.week,10);
  const custom=savePaperSelection(db,{mode:'GAMES',gameIds:['sun-late','thu','thu']},games,NOW);assert.deepEqual(custom.gameIds,['sun-late','thu']);assert.deepEqual(paperSelection(db),custom);
  const first=resolvePaperSelection(games,custom,NOW),second=resolvePaperSelection(games,{mode:'GAMES',gameIds:['thu','sun-late']},NOW);assert.equal(first.key,second.key);
  assert.equal(resolvePaperSelection(games,{mode:'GAMES',gameIds:games.map(g=>g.id)},NOW).key,all.key);
  assert.throws(()=>savePaperSelection(db,{mode:'GAMES',gameIds:['unknown']},games,NOW),/no longer/);assert.deepEqual(paperSelection(db),custom);
  assert.throws(()=>savePaperSelection(db,{mode:'GAMES',gameIds:[]},games,NOW));
  savePaperSelection(db,{mode:'SUNDAY',gameIds:[]},[],NOW);assert.equal(paperSelection(db).mode,'SUNDAY');assert.throws(()=>resolvePaperSelection([],{mode:'SUNDAY',gameIds:[]},NOW),/No verified/);
  const afterThursday=Date.parse(games[0].commence_time)+1000,automatic=resolvePaperSelection(games,{mode:'ALL',gameIds:[]},afterThursday,true);
  assert.equal(automatic.firstKickoff,all.firstKickoff);assert.equal(paperWindow(automatic,paperConfig(db),afterThursday).due,false);
  assert.ok(!resolvePaperSelection(games,{mode:'ALL',gameIds:[]},afterThursday).gameIds.includes('thu'));
 }finally{db.close();}
});
test('multi-date scope reuses working four-option optimizer, retains max three/game and deduplicates across legacy and all/custom scopes',async()=>{
 const {db,result,ticket}=await setup();try{
  const games=await paperGames(free,NOW),scope=resolvePaperSelection(games,{mode:'ALL',gameIds:[]},NOW),preview=await previewPaper(db,scope,keys,free,NOW);
  assert.deepEqual(preview.options.map(o=>o.ticket),result.options.map(o=>o.ticket));
  for(const o of preview.options){assert.ok(o.ticket);const legs=o.ticket.legs;assert.deepEqual(['QB','RB','WR','TE'].map(p=>legs.filter(l=>l.pos===p).length),[1,2,2,1]);for(const id of scope.gameIds)assert.ok(legs.filter(l=>l.gameId===id).length<=3);}
  capturePaperTicket(db,slate,'Safer',ticket,'manual',NOW);const capture=await capturePaperSlate(db,scope,keys,free,NOW,'manual',undefined,async()=>preview);assert.equal(capture.captured,3);assert.equal(paperDashboard(db).availableCents,96000);
  const custom=resolvePaperSelection(games,{mode:'GAMES',gameIds:[...scope.gameIds].reverse()},NOW);assert.equal((await capturePaperSlate(db,custom,keys,free,NOW,'manual',undefined,async()=>preview)).captured,0);assert.equal(paperDashboard(db).wagers.length,4);
  // Real scope metadata verifies per-leg kickoff across dates, never a blanket single-date check.
  const t=structuredClone(ticket),multi=structuredClone(scope),second=scope.gameIds[1],nextDay=new Date(Date.parse(kickoff)+86400000).toISOString();multi.games!.find(g=>g.id===second)!.commence_time=nextDay;multi.key='fixture:multi-date';
  for(const l of t.legs)if(l.gameId===second){l.kickoff=nextDay;l.quoteEvidence!.kickoff=nextDay;l.verification!.event.kickoff=nextDay;}
  const other=new Database(':memory:');other.exec(SCHEMA);try{assert.equal(capturePaperTicket(other,multi,'Safer',t,'manual',NOW).created,true);const invalid=structuredClone(t);invalid.legs[0].kickoff=new Date(Date.parse(invalid.legs[0].kickoff)+60000).toISOString();invalid.legs[0].quoteEvidence!.kickoff=invalid.legs[0].kickoff;invalid.legs[0].verification!.event.kickoff=invalid.legs[0].kickoff;assert.throws(()=>capturePaperTicket(other,multi,'Balanced',invalid,'manual',NOW),/mismatched/);}finally{other.close();}
 }finally{db.close();}
});
