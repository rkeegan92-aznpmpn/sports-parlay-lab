import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SCHEMA} from '../src/server/db.ts';
import {recordComparison,listComparisons} from '../src/server/quoteComparisons.ts';
import {compareObservation} from '../src/lib/quoteComparison.ts';
import {nextSundayDate,inSundayWindow} from '../src/lib/sundayWindow.ts';
import {groupQuarterRejections} from '../src/lib/quarterRejections.ts';
import {fanduelResearch} from '../src/server/fanduelResearch.ts';
import {fanduelQuarterResearch} from '../src/server/firstQuarterResearch.ts';
import {previewQuoteAllowed} from '../src/server/previewQuotes.ts';
import {quoteFreshness,refreshBoard,assertBoardUsable,readBoard,type Board} from '../src/server/fanduelRest.ts';
import {saveTicket} from '../src/server/savedTickets.ts';
import {fetcher,players,NOW,kickoff} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
import type {ComparisonTarget} from '../src/lib/researchPreview.ts';
const target:ComparisonTarget={quoteId:'q:Over',gameId:'2026_10_BUF_MIN',providerEventId:'fd1',player:'QB One',market:'player_pass_yds_q1',side:'Over',line:20.5,odds:-110,kickoff,period:'q1'};
const observation={player:target.player,gameId:target.gameId,market:target.market,side:target.side,line:target.line,odds:target.odds,observedAt:new Date(NOW).toISOString(),available:true,comparedInFanDuel:true,provenance:'manual-fanduel-app' as const};
const makeBoard=(stale=true):Board=>{
 const at=new Date(NOW-(stale?3*3600_000:300000)).toISOString(),meta={asOf:at,observedAt:at,delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
 return {complete:true,fetchedAt:NOW,events:[{record:{id:'fd1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff},meta},{record:{id:'fd2',event_name:'Los Angeles Rams @ Seattle Seahawks',starts_at:kickoff},meta}],props:[...players.map((p,i)=>({meta,record:{id:`p${i}`,event_id:p[5]==='g1'?'fd1':'fd2',starts_at:kickoff,sport:'football',league:'NFL',player:p[0],team:p[2],stat:({player_pass_yds:'passing_yards',player_rush_yds:'rushing_yards',player_reception_yds:'receiving_yards'} as Record<string,string>)[p[4]],period:'game',market_status:'open',line:50.5,over_american:p[0]==='RB Aggressive'?190:-110,under_american:-110,observed_at:at}})),...players.slice(0,3).map((p,i)=>({meta,record:{id:`q${i}`,event_id:'fd1',starts_at:kickoff,sport:'football',league:'NFL',player:p[0],team:p[2],stat:['passing_yards','rushing_yards','receiving_yards'][i],period:'q1',market_status:'open',line:20.5,over_american:-110,under_american:110,observed_at:at}}))]};
};
const free:typeof fetch=async(input,init)=>{if(/fanduelapi.com|the-odds-api.com/.test(String(input)))throw new Error('Paid requests forbidden');if(String(input).includes('play_by_play_'))return new Response(quarterCsv(String(input).includes('2026')?2026:2025));return fetcher(input,init);};
test('Sunday slate uses Eastern civil date across midnight and DST; excludes next week and kicked-off games',()=>{
 const sat=Date.parse('2026-11-15T02:00:00Z');assert.equal(nextSundayDate(sat),'2026-11-15');
 assert.equal(inSundayWindow('2026-11-16T01:20:00Z',sat),true);assert.equal(inSundayWindow('2026-11-16T05:00:00Z',sat),false);assert.equal(inSundayWindow('2026-11-22T18:00:00Z',sat),false);
 assert.equal(inSundayWindow('2026-11-15T18:00:00Z',Date.parse('2026-11-15T18:00:00Z')),false);assert.equal(nextSundayDate(Date.parse('2026-11-02T04:30:00Z')),'2026-11-01');assert.equal(nextSundayDate(Date.parse('2026-11-02T05:30:00Z')),'2026-11-08');
});
test('stale cached full-game previews keep composition and evidence without unlocking actionable generators',async()=>{
 const b=makeBoard(),original=JSON.stringify(b),strict=await fanduelResearch(b,free,NOW,true);assert.equal(strict.tickets.length,0);
 const result=await fanduelResearch(b,free,NOW,true,true,true);assert.equal(result.tickets.length,0);assert.equal(result.preview!.options.length,2);
 for(const option of result.preview!.options){assert.equal(option.actionable,false);assert.equal(option.label,'STALE — RESEARCH PREVIEW ONLY');assert.deepEqual(Object.fromEntries(['QB','RB','WR','TE'].map(p=>[p,option.legs.filter(l=>l.position===p).length])),{QB:1,RB:2,WR:2,TE:1});assert.ok(option.legs.every(l=>l.capturedAt===b.props[0].record.observed_at&&l.reasons.length&&l.ageSeconds>1800));}
 assert.notDeepEqual(result.preview!.options[0].legs.map(l=>l.quoteId).sort(),result.preview!.options[1].legs.map(l=>l.quoteId).sort());assert.equal(JSON.stringify(b),original);
 assert.equal((await fanduelResearch(makeBoard(false),free,NOW,true)).tickets.length,2);
 const db=new Database(':memory:');db.exec(SCHEMA);try{assert.throws(()=>saveTicket(db,result.preview!.options[0],NOW),/non-actionable/);assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0);}finally{db.close();}
});
test('Q1 stale preview yields two distinct genuine quarter triples; fresh API counts remain zero',async()=>{
 const b=makeBoard(),strict=await fanduelQuarterResearch(b,free,NOW);assert.equal(strict.best.options.length,0);
 const r=await fanduelQuarterResearch(b,free,NOW,'ALL','ALL',true);assert.equal(r.preview!.options.length,2);assert.equal(r.best.options.length,0);assert.equal(r.aggressive.options.length,0);assert.equal(r.diagnostics.freshSidePrices,0);assert.equal(r.diagnostics.eligibleSideProps,0);
 assert.ok(r.preview!.options.every(t=>t.legs.length===3&&t.legs.every(l=>l.period==='q1'&&l.line===20.5&&l.market.endsWith('_q1'))));assert.ok(r.rejectionGroups.some(g=>g.category==='freshness'&&g.count>0));
 const none={...b,props:b.props.filter(p=>p.record.period==='game')},missing=await fanduelQuarterResearch(none,free,NOW,'ALL','ALL',true);assert.equal(missing.preview!.options.length,0);assert.ok(missing.preview!.missing.length);
});
test('preview never repairs timestamps, invents players, bypasses injuries, or includes suspended markets',async()=>{
 const b=makeBoard();for(const patch of [{observed_at:'bad'},{starts_at:'2026-11-22T18:00:00Z'},{team:'KC'},{market_status:'suspended'}]){
 const bad={...b,props:b.props.map(p=>({...p,record:{...p.record,...patch}}))};assert.equal((await fanduelQuarterResearch(bad,free,NOW,'ALL','ALL',true)).preview!.options.length,0);
 }
 const injuries:typeof fetch=async(input,init)=>{if(String(input).endsWith('/nfl/injuries'))return new Response('{}',{status:503});return free(input,init);};assert.equal((await fanduelQuarterResearch(b,injuries,NOW,'ALL','ALL',true)).preview!.options.length,0);
 const q=(await fanduelResearch(b,free,NOW,true,true)).quotes[0];assert.equal(previewQuoteAllowed({...q,observedAt:new Date(NOW+61000).toISOString()},NOW),false);assert.equal(quoteFreshness(q.meta,q.observedAt,NOW).eligible,false);
});
test('manual observations compare exact contracts, expire, and never become API verified',()=>{
 assert.equal(compareObservation(target,observation,NOW).label,'MANUALLY VERIFIED BY USER');
 for(const patch of [{player:'Other Player'},{gameId:'other'},{market:'player_pass_yds'},{side:'Under'},{line:21.5},{odds:120}])assert.equal(compareObservation(target,{...observation,...patch},NOW).status,'changed');
 assert.equal(compareObservation(target,{...observation,available:false},NOW).status,'unavailable');assert.equal(compareObservation(target,observation,NOW+1800001).status,'stale');assert.equal(compareObservation(target,{...observation,observedAt:kickoff},Date.parse(kickoff)).status,'kickoff-reached');
});
test('manual rechecks append and survive database reopen; tickets and forecasts remain untouched',()=>{
 const folder=mkdtempSync(join(tmpdir(),'parlay-check-')),path=join(folder,'checks.db');let db=new Database(path);db.exec(SCHEMA);
 try{recordComparison(db,target,observation,NOW);recordComparison(db,target,{...observation,odds:120},NOW+1000);db.close();db=new Database(path);const rows=listComparisons(db,NOW+1000);assert.equal(rows.length,2);assert.equal(rows[0].status,'changed');assert.equal(rows[1].status,'matched');assert.equal(listComparisons(db,NOW+1800001)[1].status,'stale');for(const table of ['saved_tickets','forecast_snapshots'])assert.equal((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n,0);assert.throws(()=>recordComparison(db,target,{...observation,observedAt:'2026-11-09T12:00:00'},NOW),/timezone/);assert.throws(()=>recordComparison(db,target,{...observation,comparedInFanDuel:false},NOW),/confirmation/);}finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
test('quota cooldown prevents provider retries and preserves cached research evidence',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;const api:typeof fetch=async()=>{calls++;return Response.json({error:{code:'QUOTA_EXCEEDED'}},{status:429});};
 try{await assert.rejects(()=>refreshBoard(db,'synthetic',api,NOW));await assert.rejects(()=>refreshBoard(db,'synthetic',api,NOW+1000),/paused/);assert.equal(calls,1);}finally{db.close();}
 assert.deepEqual(groupQuarterRejections([{stage:'event-match',reason:'No match'},{stage:'raw-q1',reason:'Unsupported Q1 market'},{stage:'freshness',reason:'Old',count:2}]).map(g=>[g.category,g.count]),[['freshness',2],['unmatched game',1],['unsupported market',1]]);
});
