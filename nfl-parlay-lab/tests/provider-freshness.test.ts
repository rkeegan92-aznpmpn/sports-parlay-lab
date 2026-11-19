import test from 'node:test';
import assert from 'node:assert/strict';
import {providerTimestamp} from '../src/server/providerTimestamp.ts';
import {feedMeta,quoteFreshness,fetchBoard,FanDuelRestError} from '../src/server/fanduelRest.ts';
const now=Date.parse('2026-11-13T01:10:00Z');
const metadata={as_of:'2026-11-13T01:05:00+00',observed_at:'2026-11-13T01:03:00+00',delay_seconds:300,source_status:' DELAYED ',source_age_seconds:120};
test('explicit ISO offsets normalize to identical UTC independently of server timezone',()=>{
 const old=process.env.TZ;
 try{for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){process.env.TZ=zone;for(const input of ['2026-11-13T01:05:00+00','2026-11-13T01:05:00+0000','2026-11-13T01:05:00Z','2026-11-12T17:05:00-08','2026-11-13T06:35:00+05:30'])assert.equal(providerTimestamp(input),'2026-11-13T01:05:00.000Z');}}
 finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
 for(const input of ['2026-11-13T01:05:00','11/13/2026','2026-02-29T00:00:00Z','2026-11-13T25:00:00Z',123])assert.equal(providerTimestamp(input),null);
 assert.equal(providerTimestamp('2024-02-29T00:00:00Z'),'2024-02-29T00:00:00.000Z');
});
test('documented five-minute delay and explicit short offsets pass without double-counting plan delay',()=>{
 const meta=feedMeta(metadata),f=quoteFreshness(meta,'2026-11-13T01:05:00+00',now);
 assert.equal(f.eligible,true);assert.equal(f.ageSeconds,420);assert.equal(f.reportedSourceWallAgeSeconds,420);assert.equal(f.maxAgeSeconds,1800);assert.equal(f.futureToleranceSeconds,60);
});
test('cached reported source age grows from as_of and cannot silently outlive the cutoff',()=>{
 const meta=feedMeta({...metadata,source_age_seconds:1500});
 assert.equal(quoteFreshness(meta,metadata.as_of,now).eligible,true);
 const aged=quoteFreshness(meta,metadata.as_of,now+1000);assert.equal(aged.eligible,false);assert.equal(aged.reportedSourceWallAgeSeconds,1801);assert.ok(aged.checks.some(c=>c.field==='effective_wall_age'&&!c.passed));
});
test('missing/invalid metadata and unknown health remain excluded; clock tolerance unchanged',()=>{
 for(const patch of [{as_of:'2026-11-13T01:05:00'},{observed_at:'bad'},{source_age_seconds:-1},{source_age_seconds:'120'},{delay_seconds:null},{source_status:'healthy'},{source_status:'stale'},{source_status:'down'}])assert.equal(quoteFreshness(feedMeta({...metadata,...patch}),metadata.as_of,now).eligible,false);
 const m=feedMeta({...metadata,as_of:new Date(now).toISOString(),observed_at:new Date(now).toISOString(),source_age_seconds:0});
 assert.equal(quoteFreshness(m,new Date(now+60000).toISOString(),now).eligible,true);
 assert.equal(quoteFreshness(m,new Date(now+60001).toISOString(),now).eligible,false);
});
test('HTTP Retry-After date remains supported independently of strict ISO provider timestamps',async()=>{
 const reset=new Date(now+3600000).toUTCString();
 await assert.rejects(()=>fetchBoard('synthetic-test-only',async()=>Response.json({error:{}},{status:429,headers:{'Retry-After':reset}}),now),e=>e instanceof FanDuelRestError&&e.retryAt===now+3600000);
});
