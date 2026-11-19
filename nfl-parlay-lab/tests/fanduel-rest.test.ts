import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {fetchBoard,refreshBoard,readBoard,assertBoardUsable,quoteFreshness,FanDuelRestError,type Board} from '../src/server/fanduelRest.ts';
import {matchBoard,fanduelResearch} from '../src/server/fanduelResearch.ts';
import {freeSchedule} from '../src/server/freeResearch.ts';
import {SCHEMA} from '../src/server/db.ts';
import {saveTicket,listSavedTickets} from '../src/server/savedTickets.ts';
import {makeTicket,eligibilityWarnings,validateLegs} from '../src/lib/optimizer.ts';
import {fetcher,players,NOW,kickoff} from './manualFixtures.ts';
const secret='fd_fixture_not_a_real_credential';
const meta={has_more:false,as_of:new Date(NOW-300000).toISOString(),observed_at:new Date(NOW-300000).toISOString(),delay_seconds:300,source_status:'delayed',source_age_seconds:300};
const events=[{id:'fd1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff},{id:'fd2',event_name:'Los Angeles Rams @ Seattle Seahawks',starts_at:kickoff}];
const stats:Record<string,string>={player_pass_yds:'passing_yards',player_rush_yds:'rushing_yards',player_reception_yds:'receiving_yards'};
const props=players.map((p,i)=>({id:`p${i}`,sport:'football',league:'NFL',event_id:p[5]==='g1'?'fd1':'fd2',starts_at:kickoff,player:p[0],team:p[2],stat:stats[p[4]],period:'game',market_status:'open',line:50.5,over_american:p[0]==='RB Aggressive'?190:-110,under_american:-110,observed_at:meta.observed_at}));
const api:typeof fetch=async(input,init)=>{const u=new URL(String(input));assert.equal(u.hostname,'fanduelapi.com');assert.equal(new Headers(init?.headers).get('Authorization'),`Bearer ${secret}`);assert.equal(u.searchParams.get('sport'),'nfl');assert.equal(u.searchParams.has('apiKey'),false);assert.equal(init?.redirect,'error');return Response.json({data:u.pathname.endsWith('events')?events:props,meta});};
const board=()=>fetchBoard(secret,api,NOW);

test('authenticated REST pages NFL events/props using offsets, prevents redirects, and never stores credential',async()=>{
 const calls:string[]=[];
 const f:typeof fetch=async(input,init)=>{const u=new URL(String(input));calls.push(`${u.pathname}:${u.searchParams.get('offset')}`);if(u.pathname.endsWith('props')&&u.searchParams.get('offset')==='0')return Response.json({data:[props[0]],meta:{...meta,has_more:true}});return api(input,init);};
 const result=await fetchBoard(secret,f,NOW);assert.equal(result.events.length,2);assert.ok(result.props.length>1);assert.ok(calls.includes('/api/v1/props:200'));assert.ok(!JSON.stringify(result).includes(secret));
});

test('missing keys, malformed responses, nonadvancing pagination, and page budget fail without invented rows',async()=>{
 await assert.rejects(()=>fetchBoard('',api,NOW),/missing/);
 for(const response of [{},{data:[],meta:{}},{data:[],meta:{has_more:true}}])await assert.rejects(()=>fetchBoard(secret,async()=>Response.json(response),NOW),FanDuelRestError);
 await assert.rejects(()=>fetchBoard(secret,async()=>new Response('not JSON'),NOW),/invalid JSON/);
 await assert.rejects(()=>fetchBoard(secret,async()=>Response.json({data:[{id:'same'}],meta:{has_more:true}}),NOW),/did not advance/);
 await assert.rejects(()=>fetchBoard(secret,async()=>Response.json({data:[{id:'row'}],meta:{has_more:true}}),NOW,1),/safety budget/);
 await assert.rejects(()=>fetchBoard(secret,async()=>{throw new Error(`URL leaked ${secret}`);},NOW),e=>!String(e).includes(secret));
 await assert.rejects(()=>fetchBoard(secret,async()=>Response.json({data:[{player:secret}],meta}),NOW),/withheld/);
});

test('auth/account/rate/monthly errors are sanitized, durable and isolated from original archives and forecasts',async()=>{
 for(const status of [401,402,403,429,500]){
  const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;
  const f:typeof fetch=async()=>{calls++;return Response.json({error:{code:'QUOTA_EXCEEDED',message:secret,user_message:secret,reset_at:new Date(NOW+3600000).toISOString(),retry_after_seconds:120}},{status,headers:{'Retry-After':'120'}});};
  try{
   await assert.rejects(()=>refreshBoard(db,secret,f,NOW),e=>e instanceof FanDuelRestError&&e.status===status&&!e.message.includes(secret));
   if(status!==500){await assert.rejects(()=>refreshBoard(db,secret,f,NOW+1000),/paused/);assert.equal(calls,1);}
   assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get() as {n:number}).n,0);
   assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cache').all()).includes(secret));
  }finally{db.close();}
 }
});

test('cached on-demand board coalesces concurrent reads, respects five-minute TTL and credential changes',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;const f:typeof fetch=async(...args)=>{calls++;return api(...args);};
 try{
  const [a,b]=await Promise.all([refreshBoard(db,secret,f,NOW),refreshBoard(db,secret,f,NOW)]);assert.deepEqual(a,b);assert.equal(calls,2);
  await refreshBoard(db,secret,f,NOW+299000);assert.equal(calls,2);assert.ok(readBoard(db,secret));assert.equal(readBoard(db,'another-credential'),null);
  await refreshBoard(db,secret,f,NOW+300001);assert.equal(calls,4);
 }finally{db.close();}
});

test('freshness preserves five-minute delay and excludes stale, missing, down, unknown and future source timestamps',()=>{
 const m={asOf:meta.as_of,observedAt:meta.observed_at,delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
 assert.equal(quoteFreshness(m,meta.observed_at,NOW).eligible,true);assert.match(quoteFreshness(m,meta.observed_at,NOW).label,/DELAYED/);
 for(const patch of [{asOf:null},{delaySeconds:null},{sourceStatus:'stale'},{sourceStatus:'down'},{sourceStatus:'unknown'},{sourceAgeSeconds:1801},{asOf:new Date(NOW-1801000).toISOString()},{asOf:new Date(NOW+61000).toISOString()}])assert.equal(quoteFreshness({...m,...patch},meta.observed_at,NOW).eligible,false);
 assert.equal(quoteFreshness(m,undefined,NOW).eligible,false);assert.equal(quoteFreshness(m,new Date(NOW-1801000).toISOString(),NOW).eligible,false);
});

test('strict event/team/kickoff/period/line matching rejects unsupported data and unavailable sides',async()=>{
 const b=await board(),games=await freeSchedule(fetcher,NOW);assert.equal(matchBoard(b,games,NOW).quotes.length,14);
 for(const patch of [{event_id:'invented'},{starts_at:'invalid'},{starts_at:'2026-11-16T18:00:00Z'},{team:'KC'},{period:'q1'},{line:null},{stat:'unknown'},{market_status:'suspended'},{league:'NBA'},{over_american:null,under_american:null}]){
  const bad={...b,props:[{...b.props[0],record:{...b.props[0].record,...patch}}]};assert.equal(matchBoard(bad,games,NOW).quotes.length,0);
 }
 const dup={...b,props:[b.props[0],{...b.props[0],record:{...b.props[0].record,over_american:150}}]};assert.equal(matchBoard(dup,games,NOW).quotes.filter(q=>q.side==='Over').length,0);
 const mismatch={...b,events:b.events.map(e=>({...e,record:{...e.record,starts_at:'2026-11-16T18:00:00Z'}}))};assert.equal(matchBoard(mismatch,games,NOW).quotes.length,0);
 const eventConflict={...b,events:[b.events[0],{...b.events[1],record:{...b.events[1].record,id:'fd1'}},b.events[0]]};assert.equal(matchBoard(eventConflict,games,NOW).quotes.length,0,'Later duplicates cannot restore an ambiguous event ID');
});

test('real pipeline contract generates two distinct aggressive six-leg research options, preserves provenance and saves without calibration promotion',async()=>{
 const b=await board();let paid=0;const free:typeof fetch=async(input,init)=>{if(String(input).includes('the-odds-api.com')){paid++;throw new Error('Forbidden paid access');}return fetcher(input,init);};
 const result=await fanduelResearch(b,free,NOW,true);assert.equal(result.tickets.length,2);assert.equal(paid,0);
 assert.notDeepEqual(result.tickets[0].legs.map(l=>l.id).sort(),result.tickets[1].legs.map(l=>l.id).sort());
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  for(const ticket of result.tickets){assert.deepEqual(validateLegs(ticket.legs),[]);assert.equal(ticket.purpose,'test-research');assert.ok(ticket.legs.every(l=>l.oddsProvider==='fanduelapi'&&l.providerDelaySeconds===300));assert.ok(ticket.warnings.some(w=>w.includes('independent fanduelapi.com')));assert.throws(()=>makeTicket(ticket.legs,'aggr',{now:NOW,modelValidated:true}),/research only/);saveTicket(db,{...ticket,kind:'aggr'},NOW);}
  const saved=listSavedTickets(db);assert.equal(saved.length,2);assert.equal(saved[0].purpose,'test-research');assert.ok(saved[0].legs_json.includes('providerDelaySeconds'));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get() as {n:number}).n,0);
  const l=result.tickets[0].legs[0];assert.ok(eligibilityWarnings('aggr',{...l,providerAsOf:new Date(NOW-1801000).toISOString()},NOW).some(s=>s.includes('provenance')));
 }finally{db.close();}
 const normal=await fanduelResearch(b,free,NOW);assert.equal(normal.tickets[0].purpose,'pregame-research');
 const missingTeams=await fanduelResearch({...b,events:b.events.map(e=>({...e,record:{event_id:e.record.id,event_name:e.record.event_name,starts_at:e.record.starts_at}})),props:b.props.map(p=>({...p,record:{...p.record,team:null}}))},free,NOW);assert.equal(missingTeams.tickets.length,2);assert.ok(missingTeams.quotes.filter(q=>q.freshness.eligible).every(q=>q.teamSource==='verified-roster'&&q.team));
 const stale=await fanduelResearch(b,free,NOW+31*60000);assert.equal(stale.tickets.length,0);assert.ok(stale.quotes.every(q=>!q.freshness.eligible));
 const empty=await fanduelResearch({...b,props:[]},free,NOW);assert.equal(empty.tickets.length,0);assert.ok(empty.missing.length);
 await assert.rejects(()=>fanduelResearch({...b,complete:false},free,NOW),/Incomplete/);
 const absent=await fanduelResearch({...b,props:b.props.filter(p=>p.record.stat!=='passing_yards')},free,NOW);assert.equal(absent.tickets.length,0);
});


test('provider failure preserves previous board but blocks cached generation until successful recovery',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  const b=await refreshBoard(db,secret,api,NOW);assert.doesNotThrow(()=>assertBoardUsable(db,secret,b));
  await assert.rejects(()=>refreshBoard(db,secret,async()=>new Response('failure',{status:503}),NOW+300001));
  assert.deepEqual(readBoard(db,secret),b);assert.throws(()=>assertBoardUsable(db,secret,b),/newer provider failure/);
  const recovered=await refreshBoard(db,secret,api,NOW+301000);assert.doesNotThrow(()=>assertBoardUsable(db,secret,recovered));
 }finally{db.close();}
});

test('automatic selection excludes every adverse status, unknown roster and stale/missing/team-uncovered injury checks',async()=>{
 const b=await board();
 for(const status of ['Questionable','Doubtful','Out','Inactive']){
  const f:typeof fetch=async(input,init)=>{
   const response=await fetcher(input,init);
   if(String(input).endsWith('/nfl/injuries')){const body=await response.json();body.injuries[0].injuries.push({date:new Date(NOW).toISOString(),status,athlete:{displayName:'QB One',team:{id:'1',abbreviation:'BUF'}}});return Response.json(body);}
   return response;
  };
  const r=await fanduelResearch(b,f,NOW);assert.equal(r.tickets.length,0,status);assert.ok(r.pipelineRejections.some(x=>x.player==='QB One'));
 }
 for(const fault of ['missing','stale','partial-team','unknown-roster']){
  const f:typeof fetch=async(input,init)=>{
   const response=await fetcher(input,init),url=String(input);
   if(url.endsWith('/nfl/injuries')){if(fault==='missing')return new Response('{}',{status:503});const body=await response.json();if(fault==='stale')body.timestamp=new Date(NOW-25*3600000).toISOString();if(fault==='partial-team')body.injuries=body.injuries.slice(1);return Response.json(body);}
   if(url.endsWith('/teams/buf/roster')&&fault==='unknown-roster'){const body=await response.json();for(const group of body.athletes)for(const p of group.items)delete p.status;return Response.json(body);}
   return response;
  };
  const r=await fanduelResearch(b,f,NOW);assert.equal(r.tickets.length,0,fault);assert.ok(r.missing.length);
 }
 const r=await fanduelResearch(b,fetcher,NOW),leg=r.tickets[0].legs[0];
 for(const patch of [{injury:'Questionable'},{injury:'Doubtful'},{injury:'Out'},{injury:'Inactive'},{rosterStatus:'Active Questionable'},{rosterStatus:'unknown'},{availability:undefined},{availability:{...leg.availability!,injuryTeamCovered:false}}])assert.ok(eligibilityWarnings('aggr',{...leg,...patch},NOW).length);
 assert.ok(r.tickets.every(t=>t.legs.every(l=>l.availability?.injuryTeamCovered&&l.scored?.estimateBasis==='verified-game-outcomes')));
});

test('quota versus rate limits remain actionable across paused refreshes without retrying or leaking provider text',async()=>{
 const {providerAccessStatus}=await import('../src/server/fanduelRest.ts');
 for(const kind of ['quota','rate-limit'] as const){
  const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;
  try{
   const old=await refreshBoard(db,secret,api,NOW);
   const at=NOW+300001,reset=at+3600000;
   const fail:typeof fetch=async()=>{calls++;return Response.json({error:{code:kind==='quota'?'QUOTA_EXCEEDED':'RATE_LIMITED',message:secret,reset_at:new Date(reset).toISOString()}},{status:429});};
   await assert.rejects(()=>refreshBoard(db,secret,fail,at),e=>e instanceof FanDuelRestError&&e.kind===kind&&e.retryAt===reset);
   const access=providerAccessStatus(db,secret,at+1);assert.equal(access.failureKind,kind);assert.equal(access.retryAt,reset);assert.equal(access.paused,true);assert.equal(access.automaticRetry,false);assert.equal(access.requestBudget.maxRequestsPerRefresh,10);
   await assert.rejects(()=>refreshBoard(db,secret,fail,at+2),e=>e instanceof FanDuelRestError&&e.kind===kind&&/paused/.test(e.message));assert.equal(calls,1);
   assert.deepEqual(readBoard(db,secret),old);assert.throws(()=>assertBoardUsable(db,secret,old));assert.ok(!JSON.stringify(access).includes(secret));assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cache').all()).includes(secret));
   assert.equal(providerAccessStatus(db,secret,reset+1).paused,false,'Expiry permits explicit refresh, never asserts verification');
   const recovered=await refreshBoard(db,secret,api,reset+1);assert.doesNotThrow(()=>assertBoardUsable(db,secret,recovered));assert.equal(providerAccessStatus(db,secret,reset+1).failureKind,null);
  }finally{db.close();}
 }
});

test('Retry-After HTTP date is honored, legacy 429 is not promoted to known quota, provider outage remains visible',async()=>{
 const {providerAccessStatus}=await import('../src/server/fanduelRest.ts');
 const reset=NOW+3600000;
 await assert.rejects(()=>fetchBoard(secret,async()=>Response.json({},{status:429,headers:{'retry-after':new Date(reset).toUTCString()}}),NOW),e=>e instanceof FanDuelRestError&&e.retryAt===reset&&e.kind==='rate-or-quota');
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  await assert.rejects(()=>refreshBoard(db,secret,async()=>new Response('',{status:503}),NOW));
  const access=providerAccessStatus(db,secret,NOW);assert.equal(access.httpStatus,503);assert.equal(access.failureKind,'provider-down');assert.equal(access.paused,false);assert.match(access.nextAction,/explicitly/);
 }finally{db.close();}
});
