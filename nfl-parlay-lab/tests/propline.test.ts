import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {parsePropLineEvent,refreshPropLine,cachedPropLine,propLineStatus,PropLineError} from '../src/server/propline.ts';
import {multiResearch,refreshOddsSnapshot} from '../src/server/multiProvider.ts';
import {validateLegs} from '../src/lib/optimizer.ts';
import {saveTicket,listSavedTickets} from '../src/server/savedTickets.ts';
import {KEY,NOW,OBSERVED,events,eventBody,api,free} from './proplineFixtures.ts';
const keys={fanduelapi:'','odds-api':'',propline:KEY};
test('documented header authentication, one-call ALL bulk, selected-game two-call budget and cache reuse',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  const bulk=await refreshPropLine(db,KEY,'FULL','ALL',free,api(calls),NOW);assert.equal(calls.length,1);assert.equal(bulk.events.length,2);assert.ok(Object.values(bulk.rows).flat().length);assert.ok(calls[0].includes('bookmakers=fanduel'));assert.ok(!calls[0].includes('period='));
  await refreshPropLine(db,KEY,'FULL','2026_10_BUF_MIN',free,api(calls),NOW+1);assert.equal(calls.length,1,'ALL cache reused for selected matchup');
  assert.equal(propLineStatus(db,KEY,NOW).usage?.remaining,999);assert.equal(propLineStatus(db,'changed-key',NOW).configured,true);assert.throws(()=>cachedPropLine(db,'changed-key','FULL','ALL',NOW));
  await refreshPropLine(db,KEY,'Q1','2026_10_BUF_MIN',free,api(calls),NOW);assert.equal(calls.length,3);assert.ok(calls[2].includes('/101/odds'));assert.ok(calls[2].includes('period=q1'));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cache').all()).includes(KEY));
 }finally{db.close();}
});
test('explicit FULL/Q1 fields isolate periods; stale/withdrawn/redacted/suspended/missing prices never become current',()=>{
 const body=eventBody();assert.ok(parsePropLineEvent(body,'FULL',NOW).rows.length);assert.equal(parsePropLineEvent(body,'Q1',NOW).rows.length,0);
 for(const fault of ['period','missing-seen','withdrawn','old','future','redacted','suspended','missing-price','foreign-book','past-game','missing-zone']){
  const b:any=structuredClone(body),m=b.bookmakers[0].markets[0];b.bookmakers[0].markets=[m];
  if(fault==='period')delete m.period;if(fault==='missing-seen')for(const o of m.outcomes)delete o.last_seen_at;if(fault==='withdrawn')for(const o of m.outcomes)o.last_seen_at=new Date(NOW-400000).toISOString();
  if(fault==='old'||fault==='future'||fault==='missing-zone'){const at=fault==='old'?new Date(NOW-1800001).toISOString():fault==='future'?new Date(NOW+60001).toISOString():'2026-11-09T11:55:00';m.last_update=at;for(const o of m.outcomes)o.last_seen_at=at;}
  if(fault==='redacted')b.redacted=true;if(fault==='suspended')m.suspended_at=OBSERVED;if(fault==='missing-price')for(const o of m.outcomes)o.price=null;if(fault==='foreign-book')b.bookmakers[0].key='draftkings';if(fault==='past-game')b.commence_time=new Date(NOW-1).toISOString();
  assert.equal(parsePropLineEvent(b,'FULL',NOW).rows.length,0,fault);
 }
});
test('actual milestone ladders preserve >= versus Over, alternate lines, source IDs and exact timestamps',()=>{
 const b:any=eventBody();const m=b.bookmakers[0].markets[0];b.bookmakers[0].markets=[m];m.line_type='milestone';m.outcomes=[{name:'25+ Passing Yards',description:'QB One',point:null,price:-110,last_seen_at:OBSERVED,last_change_at:OBSERVED,player_id:'espn:101',player_team:'Buffalo Bills'}];
 const r=parsePropLineEvent(b,'FULL',NOW).rows[0];assert.equal(r.side,'AtLeast');assert.equal(r.line,25);assert.equal(r.market,'player_pass_yds_alternate');assert.equal(r.providerMarket,'player_pass_yds');assert.equal(r.providerPeriod,null);assert.equal(r.providerPlayerId,'espn:101');assert.equal(r.lastSeenAt,OBSERVED);
 m.outcomes[0].name='Over';m.outcomes[0].point=25;assert.equal(parsePropLineEvent(b,'FULL',NOW).rows.length,0,'Ambiguous milestone Over is never silently graded as >=N');
 m.outcomes[0].name='Yes';assert.equal(parsePropLineEvent(b,'FULL',NOW).rows.length,0,'No unprovided threshold inferred');
});
test('provider failures persist independently, preserve prior cache and respect daily vs burst reset without retry',async()=>{
 for(const [status,code]of [[401,'invalid_api_key'],[403,'upgrade_required'],[429,'daily_limit_exceeded'],[429,'burst_limit_exceeded'],[503,'']] as const){
  const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;
  try{
   const before=await refreshPropLine(db,KEY,'FULL','ALL',free,api([]),NOW);const at=NOW+300001,reset=Math.floor((at+86400000)/1000);
   const f:typeof fetch=async()=>{calls++;return Response.json({detail:{error:code,message:KEY,retry_after_seconds:5,upgrade_url:KEY}},{status,headers:{'Retry-After':'5','X-Daily-Reset':String(reset)}});};
   await assert.rejects(()=>refreshPropLine(db,KEY,'FULL','ALL',free,f,at),PropLineError);const health=propLineStatus(db,KEY,at);assert.equal(health.httpStatus,status);assert.equal(health.paused,true);assert.equal(health.retryAt,code==='daily_limit_exceeded'?reset*1000:[401,403].includes(status)?at+60000:at+5000);
   await assert.rejects(()=>refreshPropLine(db,KEY,'FULL','ALL',free,f,at+1),/paused/);assert.equal(calls,1);assert.throws(()=>cachedPropLine(db,KEY,'FULL','ALL',at+1));assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cache').all()).includes(KEY));
   const raw=db.prepare("SELECT value FROM cache WHERE key LIKE 'propline:v1:snapshot:%'").get() as {value:string};assert.deepEqual(JSON.parse(raw.value),JSON.parse(JSON.stringify(before)));
  }finally{db.close();}
 }
});
test('all four FULL/Q1 options use real fixture rows and save via existing history without calibration promotion',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshPropLine(db,KEY,'FULL','ALL',free,api(calls),NOW);await refreshPropLine(db,KEY,'Q1','2026_10_BUF_MIN',free,api(calls),NOW);
  const full=await multiResearch(db,keys,'FULL','ALL',free,NOW,true);assert.equal(full.options.filter(o=>o.ticket).length,4);assert.ok(full.quotes.every(q=>q.provider==='propline'&&q.bookmaker==='fanduel'&&q.reportedDelaySeconds===null));
  for(const o of full.options){const t:any=o.ticket;assert.deepEqual(validateLegs(t.legs),[]);assert.equal(t.purpose,'test-research');assert.ok(t.legs.every((l:any)=>l.quoteEvidence.provider==='propline'));}
  saveTicket(db,{...full.options[0].ticket,kind:'best'},NOW);const saved=listSavedTickets(db);assert.equal(saved.length,1);assert.ok(saved[0].legs_json.includes('propline'));
  const q1=await multiResearch(db,keys,'Q1','2026_10_BUF_MIN',free,NOW);assert.equal(q1.options.filter(o=>o.ticket).length,4);assert.ok(q1.quotes.every(q=>q.period==='Q1'&&q.market.endsWith('_q1')));assert.ok(q1.options.every(o=>o.ticket?.legs.length===3));
  const single=await multiResearch(db,keys,'FULL','2026_10_BUF_MIN',free,NOW);assert.ok(single.options.every(o=>!o.ticket));assert.equal(calls.length,3);assert.equal(listSavedTickets(db)[0].legs_json,saved[0].legs_json);
 }finally{db.close();}
});

test('third-provider failure independence in both directions and stale research remains non-actionable',async()=>{
 const nativeKey='native_other_fixture',native:typeof fetch=async(input)=>{const u=new URL(String(input));if(u.pathname.endsWith('/events'))return Response.json(events);const body=eventBody(u.pathname.includes('/102/')?1:0);for(const b of body.bookmakers)for(const m of b.markets)if(m.line_type==='alternate')m.key+='_alternate';return Response.json(body);};
 for(const failed of ['native','propline']){
  const db=new Database(':memory:');db.exec(SCHEMA);
  try{
   await refreshPropLine(db,KEY,'FULL','ALL',free,api([]),NOW);
   if(failed==='native')await assert.rejects(()=>refreshOddsSnapshot(db,nativeKey,'FULL','ALL',free,async()=>Response.json({error_code:'OUT_OF_USAGE_CREDITS'},{status:401}),NOW));
   else{await refreshOddsSnapshot(db,nativeKey,'FULL','ALL',free,native,NOW);await assert.rejects(()=>refreshPropLine(db,KEY,'FULL','ALL',free,async()=>Response.json({detail:{error:'daily_limit_exceeded'}},{status:429,headers:{'Retry-After':'3600'}}),NOW+300001));}
   const result=await multiResearch(db,{...keys,'odds-api':nativeKey},'FULL','ALL',free,NOW+300002);
   assert.ok(result.options.some(o=>o.ticket));assert.ok(result.quotes.length);assert.ok(result.quotes.every(q=>q.provider===(failed==='native'?'propline':'odds-api')));
   const stale=await multiResearch(db,{...keys,'odds-api':nativeKey},'FULL','ALL',free,NOW+31*60000);assert.ok(stale.options.every(o=>!o.ticket));
  }finally{db.close();}
 }
});
test('mismatched events, redirection, malformed payload and conflicting contracts cannot generate invented joins or erase archives',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;
 try{
  await refreshPropLine(db,KEY,'FULL','ALL',free,api([]),NOW);
  const before=(db.prepare("SELECT value FROM cache WHERE key LIKE 'propline:v1:snapshot:%'").get() as {value:string}).value;
  await assert.rejects(()=>refreshPropLine(db,KEY,'FULL','ALL',free,async()=>{throw new Error('URL '+KEY);},NOW+300001),e=>e instanceof PropLineError&&!e.message.includes(KEY));
  assert.equal((db.prepare("SELECT value FROM cache WHERE key LIKE 'propline:v1:snapshot:%'").get() as {value:string}).value,before);
  await assert.rejects(()=>refreshPropLine(db,KEY,'Q1','2026_99_BUF_MIN',free,async()=>{calls++;return Response.json([]);},NOW));assert.equal(calls,0);
  const b=eventBody();b.home_team='Kansas City Chiefs';await refreshPropLine(db,KEY,'Q1','ALL',free,async()=>Response.json([b]),NOW);assert.equal(cachedPropLine(db,KEY,'Q1','ALL',NOW).events.length,0);
  const conflicting:any=eventBody();conflicting.bookmakers[0].markets.push(structuredClone(conflicting.bookmakers[0].markets[0]));conflicting.bookmakers[0].markets.at(-1).outcomes[0].price=150;
  const parsed=parsePropLineEvent(conflicting,'FULL',NOW);assert.ok(parsed.rejections.some(r=>r.includes('Conflicting')));assert.ok(!parsed.rows.some(r=>'player'in r&&r.player==='QB One'&&r.side==='Over'&&r.line===50.5));
  await assert.rejects(()=>refreshPropLine(db,KEY,'Q1','ALL',free,async()=>Response.json({data:[],next:'untrusted'}),NOW+300001));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM saved_tickets').get() as {n:number}).n,0);
 }finally{db.close();}
});
test('provider player IDs and teams must corroborate independent roster evidence, not override it',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  const request:typeof fetch=async(input,init)=>{const r=await api([])(input,init),data:any=await r.json();if(Array.isArray(data)&&data[0]?.bookmakers)for(const e of data)for(const b of e.bookmakers)for(const m of b.markets)for(const o of m.outcomes)if(o.description==='QB One')o.player_id='espn:999999';return Response.json(data);};
  await refreshPropLine(db,KEY,'FULL','ALL',free,request,NOW);const result=await multiResearch(db,keys,'FULL','ALL',free,NOW);assert.ok(result.options.every(o=>!o.ticket));assert.ok(result.eligibility.some(e=>e.reasons.some(r=>r.includes('contradicts'))));assert.ok(result.quotes.filter(q=>q.player==='QB One').every(q=>q.status==='stale-or-unverified'));
 }finally{db.close();}
});

test('equivalent timezone instants pass, unchanged offered prices stay valid, and duplicate contradictory event IDs stay blocked',async()=>{
 const b:any=eventBody();for(const m of b.bookmakers[0].markets)for(const o of m.outcomes){o.last_seen_at='2026-11-09T06:55:00-05:00';o.last_change_at='2025-01-01T00:00:00Z';}
 assert.ok(parsePropLineEvent(b,'FULL',NOW).rows.length,'Last offered is fresh even though the price did not change');
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{const wrong={...eventBody(),home_team:'Kansas City Chiefs'};const s=await refreshPropLine(db,KEY,'FULL','ALL',free,async()=>Response.json([eventBody(),wrong]),NOW);assert.equal(s.events.length,0);assert.ok(s.rejections.some(r=>r.includes('Conflicting duplicate provider event')));}finally{db.close();}
});

test('realistic namespaced source player IDs corroborate numeric ESPN roster IDs for eligible tickets',async()=>{
 const {players}=await import('./proplineFixtures.ts');const db=new Database(':memory:');db.exec(SCHEMA);
 const numericFree:typeof fetch=async(input,init)=>{const r=await free(input,init);if(!String(input).endsWith('/roster'))return r;const body=await r.json();for(const group of body.athletes)for(const player of group.items)player.id=String(100+players.findIndex(p=>p[0]===player.fullName));return Response.json(body);};
 const request:typeof fetch=async(input,init)=>{const r=await api([])(input,init),body:any=await r.json();if(Array.isArray(body)&&body[0]?.bookmakers)for(const e of body)for(const b of e.bookmakers)for(const m of b.markets)for(const o of m.outcomes){const i=players.findIndex(p=>p[0]===o.description);o.player_id='espn:'+String(100+i);o.player_team=players[i][2];}return Response.json(body);};
 try{await refreshPropLine(db,KEY,'FULL','ALL',numericFree,request,NOW);const result=await multiResearch(db,keys,'FULL','ALL',numericFree,NOW);assert.ok(result.options.some(o=>o.ticket));assert.ok(result.quotes.every(q=>q.providerPlayerId==='espn:'+q.playerId?.replace(/^espn:/,'')));assert.ok(result.quotes.every(q=>q.team&&q.status==='current-provider-snapshot'));}finally{db.close();}
});
test('live verification is opt-in, selected-game bounded and dry-run never creates a database or exposes key',async()=>{
 const {spawnSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url'),{existsSync}=await import('node:fs'),{randomUUID}=await import('node:crypto');
 const file='/tmp/propline-audit-'+randomUUID()+'/never-created.db',cwd=fileURLToPath(new URL('../',import.meta.url));
 for(const args of [[],['--live','--game=ALL','--period=FULL']]){
  const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/verify-propline.ts',...args],{cwd,encoding:'utf8',env:{...process.env,PROPLINE_API_KEY:KEY,DB_PATH:file}});
  const output=JSON.parse(result.stdout);assert.equal(output.providerRequests,0);assert.ok(!result.stdout.includes(KEY));assert.equal(existsSync(file),false);assert.equal(result.status,args.length?2:0);
 }
});
