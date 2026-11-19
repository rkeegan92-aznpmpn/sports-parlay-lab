import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCurrentInjuries} from '../src/lib/providers/stats.ts';
const NOW=Date.parse('2026-11-10T20:00:00Z');
const current=(patch:Record<string,unknown>={})=>({timestamp:new Date(NOW).toISOString(),season:{year:2026,type:2},injuries:[{id:'2',injuries:[{date:new Date(NOW-3600_000).toISOString(),status:'Questionable',athlete:{displayName:'Fixture QB',team:{id:'2',abbreviation:'BUF'}}}]}],...patch});
const f=(snapshot:unknown):typeof fetch=>async input=>String(input).includes('site.api.espn.com')?Response.json(snapshot):new Response('full_name,team,week,report_status\nFixture QB,BUF,9,Out\nOld Fixture,BUF,9,Out\n');
test('fresh season/team/date-verified ESPN reports supplement older injury data without inferring health from absence',async()=>{
 const r=await loadCurrentInjuries(2026,f(current()),NOW);
 assert.equal(r.freshSnapshot,true);assert.equal(r.currentEntries,1);
 assert.equal(r.statuses.get('BUF|fixture qb'),'Questionable');
 assert.equal(r.statuses.get('BUF|old fixture'),'Out');
 assert.equal(r.statuses.has('BUF|unreported fixture'),false);
});
test('wrong-season, stale, future, mismatched-team and undated injury records do not replace historical exclusions',async()=>{
 for(const snapshot of [current({season:{year:2025,type:2}}),current({timestamp:new Date(NOW-25*3600_000).toISOString()}),current({timestamp:new Date(NOW+6*60000).toISOString()}),current({injuries:[{id:'wrong',injuries:[{date:new Date(NOW).toISOString(),status:'Questionable',athlete:{displayName:'Fixture QB',team:{id:'2',abbreviation:'BUF'}}}]}]}),current({injuries:[{id:'2',injuries:[{status:'Questionable',athlete:{displayName:'Fixture QB',team:{id:'2',abbreviation:'BUF'}}}]}]})]) {
  const r=await loadCurrentInjuries(2026,f(snapshot),NOW);assert.equal(r.freshSnapshot,false);assert.equal(r.statuses.get('BUF|fixture qb'),'Out');
 }
});
