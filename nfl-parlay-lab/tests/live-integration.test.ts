import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA } from '../src/server/db.ts';
import { liveHealth } from '../src/server/liveHealth.ts';
import { acquireCollector, collectorResult } from '../src/server/collector.ts';
import { diagnoseLive } from '../src/server/liveDiagnostics.ts';
import { getData, canReuseLiveCache } from '../src/server/load.ts';
import { demoResult } from '../src/lib/service.ts';

test('fast health distinguishes absent credentials, failing collector, stopped collector and disabled collection without scanning forecasts', () => {
  const db=new Database(':memory:'); db.exec(SCHEMA);
  try {
    // Poison audit tables: health must not depend on their schemas/queries.
    db.exec('DROP TABLE forecast_snapshots; DROP TABLE saved_tickets;');
    const before=db.prepare('SELECT total_changes() AS n').get();
    const missing=liveHealth(db,{},1000);
    assert.equal(missing.mode,'unavailable');
    assert.equal(missing.oddsApiKeyConfigured,false);
    assert.match(missing.nextAction,/No paid key is required/);
    assert.match(missing.nextAction,/settlement-only/);
    assert.equal(missing.collector.status,'stopped');
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(),before);
    acquireCollector(db,'fixture',1000);
    collectorResult(db,'fixture','ODDS_API_KEY is missing',null,1100);
    const failing=liveHealth(db,{},1200);
    assert.equal(failing.collector.status,'failing');
    assert.equal(failing.collector.active,true);
    const configured=liveHealth(db,{ODDS_API_KEY:'fixture-private-key',COLLECTOR_ENABLED:'0'},1200);
    assert.equal(configured.credentials,'configured-unverified');
    assert.equal(configured.collectorEnabled,false);
    assert.ok(!JSON.stringify(configured).includes('fixture-private-key'));
    assert.equal(liveHealth(db,{},100000).collector.status,'stopped');
  } finally {db.close();}
});

test('missing credentials never request paid odds or produce substituted tickets; free source failures remain explicit', async () => {
  const calls:string[]=[];
  const fetcher:typeof fetch=async input=>{calls.push(String(input));return new Response('',{status:503});};
  const r=await diagnoseLive({fetcher});
  assert.ok(!calls.some(url=>url.includes('the-odds-api.com')));
  assert.ok(r.blockers.some(b=>b.includes('ODDS_API_KEY missing')));
  assert.equal(r.sources.injuries.status,'unavailable');
  assert.equal(r.sources.statistics.status,'missing');
  assert.deepEqual((r.live as {tickets:unknown}).tickets,{best:null,aggressive:null});
});

test('live diagnosis distinguishes authentication, quota and entitlement failures without echoing provider errors or keys', async () => {
  for(const status of [401,403,422,429]) {
    const key='fixture-private-key';
    const fetcher:typeof fetch=async input=>new Response(JSON.stringify({error:`apiKey=${key}`}),{status:String(input).includes('the-odds-api.com')?status:503});
    const r=await diagnoseLive({key,fetcher});
    assert.equal((r.live as {httpStatus:number}).httpStatus,status);
    assert.ok(!JSON.stringify(r).includes(key));
    assert.ok(r.blockers.some(b=>status===401?b.includes('authentication'):status===429?b.includes('quota'):b.includes('access')));
  }
});

test('missing live key fails explicitly before database access instead of selecting demo data', async () => {
  const key=process.env.ODDS_API_KEY, demo=process.env.DEMO_MODE;
  try {
    delete process.env.ODDS_API_KEY;delete process.env.DEMO_MODE;
    await assert.rejects(getData(),/ODDS_API_KEY is missing/);
    process.env.DEMO_MODE='1';
    assert.equal((await getData()).mode,'demo','demo remains available only through explicit opt-in');
  } finally {
    if(key===undefined)delete process.env.ODDS_API_KEY;else process.env.ODDS_API_KEY=key;
    if(demo===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=demo;
  }
});


test('live cache refreshes for new or rescheduled games and expired provider quotes despite a recent pipeline cache timestamp', () => {
  const now=Date.parse('2026-11-10T18:00:00Z');
  const event={id:'real-event-fixture',away_team:'Buffalo Bills',home_team:'Miami Dolphins',commence_time:'2026-11-15T18:00:00Z'};
  const cached={games:[{id:event.id,label:'BUF @ MIA',kickoff:event.commence_time,status:'available' as const,markets:[],returnedMarketKeys:[],unsupportedMarketKeys:[],props:0}],candidates:[{...demoResult(now).candidates[0],oddsAt:new Date(now-29*60000).toISOString()}],pipelineRejections:[]};
  assert.equal(canReuseLiveCache(cached,[event],now),true);
  assert.equal(canReuseLiveCache(cached,[event],now+2*60000),false);
  assert.equal(canReuseLiveCache(cached,[{...event,commence_time:'2026-11-16T18:00:00Z'}],now),false);
  assert.equal(canReuseLiveCache(cached,[event,{...event,id:'new-event'}],now),false);
  assert.equal(canReuseLiveCache({...cached,candidates:[{oddsAt:'invalid'}] as typeof cached.candidates},[event],now),false);
  assert.equal(canReuseLiveCache({...cached,pipelineRejections:undefined},[event],now),false,'legacy cache entries without exact rejection context are refreshed');
});


test('events-list access does not conceal missing player-prop entitlement', async () => {
  const now=Date.parse('2026-11-10T18:00:00Z');
  const fetcher:typeof fetch=async input=> {
    const url=String(input);
    if(url.includes('the-odds-api.com') && new URL(url).pathname.endsWith('/events')) return Response.json([{id:'fixture-upcoming',home_team:'Miami Dolphins',away_team:'Buffalo Bills',commence_time:'2026-11-15T18:00:00Z'}]);
    return new Response('',{status:url.includes('the-odds-api.com')?422:503});
  };
  const r=await diagnoseLive({key:'fixture-private-key',now,fetcher});
  assert.ok(r.blockers.some(b=>b.includes('player-prop access was denied')));
  assert.equal((r.live as {games:{providerHttpStatus:number}[]}).games[0].providerHttpStatus,422);
  assert.deepEqual((r.live as {tickets:unknown}).tickets,{best:null,aggressive:null});
});


test('subscription quota failure stops the event scan and does not become an invalid-key claim', async () => {
  let props=0;
  const fetcher:typeof fetch=async input=> {
    const u=new URL(String(input));
    if(u.hostname==='api.the-odds-api.com') {
      if(u.pathname.endsWith('/events')) return Response.json(['first','second'].map(id=>({id,home_team:'Miami Dolphins',away_team:'Buffalo Bills',commence_time:'2026-11-15T18:00:00Z'})));
      props++;return Response.json({error_code:'OUT_OF_USAGE_CREDITS'},{status:401});
    }
    return new Response('',{status:404});
  };
  const r=await diagnoseLive({key:'fixture-only',now:Date.parse('2026-11-10T18:00:00Z'),fetcher});
  assert.equal(props,1);
  assert.ok(r.blockers.some(b=>b.includes('OUT_OF_USAGE_CREDITS')));
  assert.ok(!r.blockers.some(b=>b.includes('rejected authentication')));
});
