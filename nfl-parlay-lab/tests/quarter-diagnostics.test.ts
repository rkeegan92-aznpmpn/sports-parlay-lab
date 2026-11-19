import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectQuarterBoard,quarterDate} from '../src/server/quarterDiagnostics.ts';
import {feedMeta,type Board} from '../src/server/fanduelRest.ts';
import {fanduelQuarterResearch} from '../src/server/firstQuarterResearch.ts';
import {selectSchedule} from '../src/lib/service.ts';
const capture=JSON.parse(fs.readFileSync(new URL('./fixtures/fanduel-observed-q1-schema.json',import.meta.url),'utf8'));
const board=():Board=>({complete:false,fetchedAt:Date.parse(capture.responses[0].meta.as_of),events:[{record:{event_id:'36275757',event_name:'Washington Commanders @ New York Giants',starts_at:'2026-11-13T01:16:00.000Z'},meta:feedMeta(capture.responses[0].meta)}],props:capture.responses.flatMap((r:{data:Record<string,unknown>[];meta:unknown})=>r.data.map(record=>({record,meta:feedMeta(r.meta)})))});
const games=[{id:'2026_10_WAS_NYG',commence_time:'2026-11-13T01:15:00.000Z',home_team:'New York Giants',away_team:'Washington Commanders',label:'WAS @ NYG',week:10,espnEventId:undefined}];
const now=Date.parse('2026-11-12T00:08:00Z');
test('observed public schema really has Q1 rows and null teams; sample data is not authenticated live coverage',async()=>{
 const b=board(),d=inspectQuarterBoard(b,games,now,'2026-11-12','2026_10_WAS_NYG');
 assert.equal(d.diagnostics.rawRows,4);assert.equal(d.diagnostics.rawQ1Rows,2);assert.deepEqual(d.diagnostics.periodCounts,{q1:2,q2:1,game:1});assert.equal(d.diagnostics.supportedQ1Rows,2);assert.equal(d.diagnostics.matchedGames,1);assert.equal(d.diagnostics.selectedSidePrices,4);
 assert.ok(d.quotes.some(q=>q.player==='Antonio Williams'&&q.line===3.5&&q.odds===-118));assert.ok(d.quotes.some(q=>q.player==='J.J McCarthy'&&q.line===45.5));assert.ok(d.quotes.every(q=>q.line!==210.5&&q.line!==6.5));
 assert.equal(d.diagnostics.freshSidePrices,0,'Sample response lacks REST source-health proof; it must not become recommendations');assert.ok(d.diagnostics.rejections.some(r=>r.reason.includes('source health')));
 assert.equal(d.diagnostics.coverage,'q1-rows-present');assert.equal(d.diagnostics.eligibilityEvaluated,false);
 await assert.rejects(()=>fanduelQuarterResearch(b,async()=>{throw new Error('No network allowed');},now),/Incomplete/);
});
test('Q1 date filtering uses NFL Eastern date, with UTC rollover/DST; six-pick UTC selection remains unchanged',()=>{
 assert.equal(quarterDate(games[0].commence_time),'2026-11-12');assert.equal(quarterDate('2026-11-01T03:59:00Z'),'2026-10-31');assert.equal(quarterDate('2026-11-01T04:01:00Z'),'2026-11-01');
 assert.equal(inspectQuarterBoard(board(),games,now,'2026-11-12').quotes.length,4);
 const filtered=inspectQuarterBoard(board(),games,now,'2026-11-13');assert.equal(filtered.quotes.length,0);assert.ok(filtered.diagnostics.rejections.some(r=>r.stage==='selection-filter'));
 assert.equal(inspectQuarterBoard(board(),games,now,'ALL','36275757').quotes.length,4,'Exact mapped provider ID resolves to the same verified game');
 assert.equal(selectSchedule(games,'2026-11-12',now).events.length,0);assert.equal(selectSchedule(games,'2026-11-13',now).events.length,1,'Do not change the working six-pick date contract');
});
test('diagnostics distinguish absent coverage, schema loss and unsupported stats without inventing periods',()=>{
 const base=board(),noQuarter={...base,props:base.props.filter(p=>p.record.period==='game')};assert.equal(inspectQuarterBoard(noQuarter,games,now).diagnostics.coverage,'no-q1-rows-in-snapshot');
 const noField={...base,props:base.props.map(p=>({...p,record:{...p.record,period:undefined}}))};const d=inspectQuarterBoard(noField,games,now).diagnostics;assert.equal(d.rawQ1Rows,0);assert.equal(d.missingPeriodRows,4);assert.equal(d.coverage,'period-field-missing');
 const other={...base,props:base.props.map(p=>({...p,record:{...p.record,stat:'unknown_stat'}}))};assert.equal(inspectQuarterBoard(other,games,now).diagnostics.coverage,'q1-stats-not-supported');
});
test('documented Q1 tokens normalize case/whitespace only; quarter two and full-game values never relabel',()=>{
 const b=board();b.props=b.props.map(p=>p.record.period==='q1'?{...p,record:{...p.record,period:' Q1 ',stat:String(p.record.stat).toUpperCase(),market_status:'OPEN'}}:p);
 const d=inspectQuarterBoard(b,games,now);assert.equal(d.diagnostics.rawQ1Rows,2);assert.equal(d.diagnostics.normalizedRows,2);assert.equal(d.quotes.length,4);assert.equal(b.props[0].record.period,' Q1 ','Do not mutate the stored cache');
});
test('kickoff, invalid quotes, event mismatches, and staleness each get specific diagnostics',()=>{
 const b=board();const past=inspectQuarterBoard(b,games,Date.parse('2026-11-13T01:17:00Z'));assert.equal(past.diagnostics.matchedGames,0);assert.ok(past.diagnostics.events.every(e=>!e.pregame));assert.ok(past.diagnostics.rejections.some(r=>r.stage==='kickoff'));
 const stale=inspectQuarterBoard(b,games,now+31*60000);assert.ok(stale.diagnostics.rejections.some(r=>r.stage==='freshness'&&r.reason.includes('30-minute')));
 const missingPrices={...b,props:b.props.map(p=>({...p,record:{...p.record,over_american:null,under_american:null}}))};assert.ok(inspectQuarterBoard(missingPrices,games,now).diagnostics.rejections.some(r=>r.stage==='quote-schema'));
 const wrongEvent={...b,events:b.events.map(e=>({...e,record:{...e.record,starts_at:'2026-11-14T01:16:00Z'}}))};assert.ok(inspectQuarterBoard(wrongEvent,games,now).diagnostics.rejections.some(r=>r.stage==='event-match'));
});

test('Q1 availability verifies legitimate QB rushing and RB receiving while rejecting wrong positions',async()=>{
 const {verifyQuarterAvailability}=await import('../src/lib/providers/espn.ts');
 const {fetcher,NOW}=await import('./manualFixtures.ts');
 const base={gameId:'game',team:'BUF',opponent:'MIN'};
 const inputs=[{...base,id:'qbr',player:'QB One',market:'1Q rushing yards'},{...base,id:'rbr',player:'RB One',market:'1Q receiving yards'},{...base,id:'wrong',player:'RB One',market:'1Q passing yards'}] as import('../src/lib/types.ts').FirstQuarterCandidate[];
 const result=await verifyQuarterAvailability(inputs,new Map([['game',['BUF','MIN']]]),new Map(),fetcher,{currentSnapshotAt:new Date(NOW).toISOString(),coveredTeams:['BUF','MIN'],now:NOW});
 assert.deepEqual(result.candidates.map(c=>c.id),['qbr','rbr']);assert.equal(result.excluded,1);assert.ok(result.rejections[0].reason.includes('position'));
});

test('explicit provider offsets match UTC kickoff without changing lines or prices',()=>{
 const b=board();const meta=feedMeta({as_of:'2026-11-12T00:06:00+00',observed_at:'2026-11-12T00:06:00+0000',delay_seconds:300,source_status:'delayed',source_age_seconds:120});
 b.events=b.events.map(e=>({...e,record:{...e.record,starts_at:'2026-11-12T17:16:00-08'}}));
 b.props=b.props.map(p=>({...p,meta,record:{...p.record,starts_at:'2026-11-13T01:16:00+00',observed_at:'2026-11-12T00:06:00+00'}}));
 const d=inspectQuarterBoard(b,games,now);assert.equal(d.diagnostics.freshSidePrices,4);assert.equal(d.diagnostics.priceChecks.length,2);
 assert.equal(d.diagnostics.priceChecks[0].providerKickoffUtc,'2026-11-13T01:16:00.000Z');assert.equal(d.diagnostics.priceChecks[0].verifiedKickoffUtc,'2026-11-13T01:15:00.000Z');
 assert.equal(d.diagnostics.priceChecks[0].rawAsOf,'2026-11-12T00:06:00+00');assert.ok(d.active.some(q=>q.line===3.5&&q.odds===-118));
 const mismatch={...b,events:b.events.map(e=>({...e,record:{...e.record,starts_at:'2026-11-13T01:16:01+00'}}))};assert.equal(inspectQuarterBoard(mismatch,games,now).active.length,0,'Existing one-minute matching tolerance is not widened');
 assert.equal(inspectQuarterBoard(b,games,Date.parse(games[0].commence_time)).active.length,0,'Verified schedule cutoff wins over later provider kickoff');
});
test('post-kickoff observations are excluded even within future-clock tolerance',()=>{
 const b=board(),kickoff=Date.parse(games[0].commence_time),at=new Date(kickoff).toISOString();
 const meta=feedMeta({as_of:at,observed_at:at,delay_seconds:0,source_status:'ok',source_age_seconds:0});
 b.props=b.props.map(p=>({...p,meta,record:{...p.record,observed_at:at}}));
 const d=inspectQuarterBoard(b,games,kickoff-30000);
 assert.equal(d.diagnostics.timestampFreshSidePrices,4);assert.equal(d.diagnostics.freshSidePrices,0);assert.ok(d.diagnostics.rejections.some(r=>r.stage==='kickoff'));
});
