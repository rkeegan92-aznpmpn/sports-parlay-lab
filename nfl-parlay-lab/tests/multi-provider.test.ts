import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {refreshOddsSnapshot,multiResearch,multiProviderStatus,providerCapabilities} from '../src/server/multiProvider.ts';
import {refreshBoard} from '../src/server/fanduelRest.ts';
import {conservativeContracts,type NormalizedQuote} from '../src/lib/normalizedOdds.ts';
import {fourFullOptions,fourQuarterOptions,fullSignature} from '../src/lib/fourOptions.ts';
import {validateLegs} from '../src/lib/optimizer.ts';
import {saveTicket,listSavedTickets} from '../src/server/savedTickets.ts';
import {fetcher,NOW,players,kickoff} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
const key='odds-fixture-never-real',fd='fd-fixture-never-real',keys={'fanduelapi':fd,'odds-api':key};
const meta={has_more:false,as_of:new Date(NOW-300000).toISOString(),observed_at:new Date(NOW-300000).toISOString(),delay_seconds:300,source_status:'delayed',source_age_seconds:300};
const events=[{id:'o1',home_team:'Minnesota Vikings',away_team:'Buffalo Bills',commence_time:kickoff},{id:'o2',home_team:'Seattle Seahawks',away_team:'Los Angeles Rams',commence_time:kickoff}];
const stat:Record<string,string>={player_pass_yds:'passing_yards',player_rush_yds:'rushing_yards',player_reception_yds:'receiving_yards'};
const free:typeof fetch=async(input,init)=>{assert.ok(!/the-odds-api.com|fanduelapi.com/.test(String(input)),'Paid calls forbidden during cached analysis');if(String(input).includes('play_by_play_'))return new Response(quarterCsv(String(input).includes('2026')?2026:2025));return fetcher(input,init);};
const fdApi:typeof fetch=async(input)=>Response.json({data:String(input).endsWith('events?sport=nfl&limit=200&offset=0')?events.map(e=>({...e,event_name:e.away_team+' @ '+e.home_team,starts_at:e.commence_time})):['game','q1'].flatMap(period=>players.map((p,i)=>({id:period+i,sport:'football',league:'NFL',event_id:p[5]==='g1'?'o1':'o2',starts_at:kickoff,player:p[0],team:p[2],stat:stat[p[4]],period,market_status:'open',line:period==='q1'?20.5:50.5,over_american:p[0]==='RB Aggressive'?190:-110,under_american:-110,observed_at:meta.observed_at}))),meta});
function oddsApi(calls:string[]):typeof fetch{return async(input)=>{const u=new URL(String(input));calls.push(u.pathname);assert.equal(u.searchParams.get('apiKey'),key);if(u.pathname.endsWith('/events'))return Response.json(events);const q1=u.searchParams.get('markets')!.includes('_q1'),id=u.pathname.split('/').at(-2);return Response.json({bookmakers:[{key:'fanduel',markets:players.filter(p=>(p[5]==='g1'?'o1':'o2')===id).map(p=>({key:p[4]+(q1?'_q1':''),last_update:meta.observed_at,outcomes:[{name:'Over',description:p[0],point:q1?20.5:50.5,price:-110},{name:'Under',description:p[0],point:q1?20.5:50.5,price:-110}]}))}]});};}
test('independent adapter caches FULL/Q1 separately, authenticates server-side and makes no hidden retry',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshOddsSnapshot(db,key,'FULL','ALL',free,oddsApi(calls),NOW);assert.equal(calls.length,3);
  await refreshOddsSnapshot(db,key,'FULL','ALL',free,oddsApi(calls),NOW+1);assert.equal(calls.length,3);
  await refreshOddsSnapshot(db,key,'Q1','ALL',free,oddsApi(calls),NOW);assert.equal(calls.length,6);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cache').all()).includes(key));
  const full=await multiResearch(db,{'fanduelapi':'','odds-api':key},'FULL','ALL',free,NOW,true);assert.equal(calls.length,6);assert.equal(full.options.length,4);assert.ok(full.quotes.length);assert.ok(full.quotes.every(q=>q.period==='FULL'&&q.provider==='odds-api'&&q.bookmaker==='fanduel'&&q.reportedDelaySeconds===null));
  const ticket=full.options.find(s=>s.ticket)?.ticket;assert.ok(ticket);assert.deepEqual(validateLegs((ticket as any).legs),[]);
  const single=await multiResearch(db,{'fanduelapi':'','odds-api':key},'FULL','2026_10_BUF_MIN',free,NOW);assert.ok(single.options.every(s=>!s.ticket));assert.ok(single.options.some(s=>s.missing.join(' ').includes('maximum')));
  const quarter=await multiResearch(db,{'fanduelapi':'','odds-api':key},'Q1','2026_10_BUF_MIN',free,NOW);assert.ok(quarter.quotes.every(q=>q.period==='Q1'&&q.gameId==='2026_10_BUF_MIN'));assert.ok(quarter.options.some(s=>s.ticket));
 }finally{db.close();}
});
test('a failed FanDuel provider never invalidates cached Odds API quotes; failed Odds API does not block FanDuel',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshBoard(db,fd,fdApi,NOW);await refreshOddsSnapshot(db,key,'FULL','ALL',free,oddsApi(calls),NOW);
  await assert.rejects(()=>refreshBoard(db,fd,async()=>Response.json({error:{code:'QUOTA_EXCEEDED',retry_after_seconds:3600}},{status:429}),NOW+300001));
  const independent=await multiResearch(db,keys,'FULL','ALL',free,NOW+300002);assert.ok(independent.quotes.length);assert.ok(independent.quotes.every(q=>q.provider==='odds-api'));assert.ok(independent.options.some(s=>s.ticket));
  await refreshBoard(db,fd,async(input,init)=>{const body=await (await fdApi(input,init)).json();body.meta.as_of=new Date(NOW+3700000).toISOString();body.meta.observed_at=body.meta.as_of;for(const row of body.data)if(row.observed_at)row.observed_at=body.meta.as_of;return Response.json(body);},NOW+4000000);
  await assert.rejects(()=>refreshOddsSnapshot(db,key,'FULL','ALL',free,async()=>Response.json({error_code:'OUT_OF_USAGE_CREDITS'},{status:401}),NOW+4000000));
  const other=await multiResearch(db,keys,'FULL','ALL',free,NOW+4000001);assert.ok(other.quotes.every(q=>q.provider==='fanduelapi'));assert.ok(other.options.some(s=>s.ticket));assert.equal(multiProviderStatus(db,keys,NOW+4000001).providers[1].paused,true);
  let retryCalls=0;await assert.rejects(()=>refreshOddsSnapshot(db,key,'FULL','ALL',free,async()=>{retryCalls++;throw Error();},NOW+4000002));assert.equal(retryCalls,0);
 }finally{db.close();}
});
test('FD native six-pick history is compatible, stale snapshots cannot form options, and all slots stay explicit',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  await refreshBoard(db,fd,fdApi,NOW);const r=await multiResearch(db,{'fanduelapi':fd,'odds-api':''},'FULL','ALL',free,NOW,true);
  const tickets=r.options.flatMap(s=>s.ticket?[s.ticket as any]:[]);assert.ok(tickets.length);for(const t of tickets){assert.deepEqual(validateLegs(t.legs),[]);assert.equal(t.purpose,'test-research');assert.ok(t.legs.every((l:any)=>l.quoteEvidence?.provider==='fanduelapi'));}
  const first=saveTicket(db,{...tickets[0],kind:'aggr'},NOW);assert.equal(listSavedTickets(db)[0].id,first.id);assert.equal(listSavedTickets(db).length,1);
  const stale=await multiResearch(db,{'fanduelapi':fd,'odds-api':''},'FULL','ALL',free,NOW+31*60000);assert.ok(stale.options.every(s=>!s.ticket));assert.ok(stale.quotes.every(q=>q.status==='stale-or-unverified'));assert.equal(listSavedTickets(db).length,1);
  assert.deepEqual(r.options.map(s=>s.label),['Safer','Balanced','Aggressive','Long Shot']);
 }finally{db.close();}
});
test('mixed-source prices remain distinct in inventory; conflicts, periods and actual alternate contracts are not conflated',()=>{
 const q:NormalizedQuote={id:'a',provider:'fanduelapi',bookmaker:'fanduel',providerEventId:'p',gameId:'g',player:'P',playerId:'1',team:'BUF',opponent:'MIN',kickoff,market:'player_rush_yds',period:'FULL',line:25.5,side:'Over',american:-110,observedAt:meta.observed_at,providerAsOf:meta.as_of,reportedDelaySeconds:300,status:'current-provider-snapshot',provenance:'fixture'};
 const rows=[{quote:q},{quote:{...q,id:'b',provider:'odds-api' as const,american:150}},{quote:{...q,id:'alt',market:'player_rush_yds_alternate',line:10,side:'AtLeast'}},{quote:{...q,id:'quarter',period:'Q1' as const}}];const merged=conservativeContracts(rows);assert.equal(merged.eligible.length,3);assert.ok(merged.eligible.some(x=>x.quote.id==='a'));assert.equal(rows.length,4);
 assert.equal(conservativeContracts([{quote:q},{quote:{...q,id:'bad',team:'SEA'}}]).eligible.length,0);
 assert.equal(conservativeContracts([{quote:{...q,status:'stale-or-unverified'}}]).eligible.length,0);
 assert.ok(providerCapabilities.filter(p=>!p.enabled).every(p=>p.credential===null));
});
test('four-option engines never pad missing/full/Q1 evidence or repeat semantic selections',()=>{
 assert.equal(fourFullOptions([],NOW).length,4);assert.ok(fourFullOptions([],NOW).every(s=>!s.ticket));assert.ok(fourQuarterOptions([],NOW).every(s=>!s.ticket));
});

test('sufficient actual fixture alternatives produce four distinct ranked FULL and Q1 options without duplicate players',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  const alternatives:typeof fetch=async(input,init)=>{const body=await (await fdApi(input,init)).json();if(String(input).includes('/props?')){
   const original=[...body.data];for(const [j,line,odds]of [[0,40.5,-105],[1,45.5,-100],[2,55.5,105]])for(const row of original)body.data.push({...row,id:row.id+'alt'+j,stat:row.stat+'_alternate',line:row.period==='q1'?5.5+j*3:line,over_american:odds,under_american:-110});
  }return Response.json(body);};
  await refreshBoard(db,fd,alternatives,NOW);
  const full=await multiResearch(db,{'fanduelapi':fd,'odds-api':''},'FULL','ALL',free,NOW);const tickets=full.options.flatMap(s=>s.ticket?[s.ticket as any]:[]);assert.equal(tickets.length,4);assert.equal(new Set(tickets.map(fullSignature)).size,4);
  for(const t of tickets){assert.deepEqual(validateLegs(t.legs),[]);assert.ok(t.legs.every((l:any)=>full.quotes.some(q=>q.id===l.quoteEvidence.id&&q.american===l.odds&&q.line===l.line)));}
  assert.ok(tickets.some(t=>t.legs.some((l:any)=>l.market.endsWith('_alternate'))));assert.ok(tickets[3].decimal>tickets[2].decimal);
  const quarter=await multiResearch(db,{'fanduelapi':fd,'odds-api':''},'Q1','2026_10_BUF_MIN',free,NOW);const triples=quarter.options.flatMap(s=>s.ticket?[s.ticket as any]:[]);assert.equal(triples.length,4);assert.equal(new Set(triples.map(t=>t.legs.map((l:any)=>[l.gameId,l.player,l.market,l.side,l.line].join(':')).sort().join('|'))).size,4);
  for(const t of triples){assert.equal(t.legs.length,3);assert.equal(new Set(t.legs.map((l:any)=>l.espnPlayerId)).size,3);assert.ok(t.legs.every((l:any)=>l.gameId==='2026_10_BUF_MIN'&&l.quoteEvidence.period==='Q1'));}
 }finally{db.close();}
});

test('event response contradictions and credentials in payloads are withheld without overwriting a valid snapshot',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshOddsSnapshot(db,key,'FULL','ALL',free,oddsApi(calls),NOW);
  const original=(db.prepare("SELECT value FROM cache WHERE key LIKE 'multi-odds:v1:%'").get() as {value:string}).value;
  for(const patch of [{id:'wrong-event'},{commence_time:'2026-11-15T23:00:00Z'},{home_team:'Kansas City Chiefs'},{player:key}]){
   const paid:typeof fetch=async(input,init)=>{const r=await oddsApi(calls)(input,init);if(new URL(String(input)).pathname.endsWith('/events'))return r;const b=await r.json();if(patch.player)b.bookmakers[0].markets[0].outcomes[0].description=key;else Object.assign(b,patch);return Response.json(b);};
   await assert.rejects(()=>refreshOddsSnapshot(db,key,'FULL','ALL',free,paid,NOW+300001));
   assert.equal((db.prepare("SELECT value FROM cache WHERE key LIKE 'multi-odds:v1:%'").get() as {value:string}).value,original);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cache').all()).includes(key));
  }
 }finally{db.close();}
});

test('unsupported selection spends no credits and does not invalidate valid cache; explicit suspension removes prices',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);const calls:string[]=[];
 try{
  await refreshOddsSnapshot(db,key,'FULL','ALL',free,oddsApi(calls),NOW);
  const before=JSON.stringify(db.prepare('SELECT * FROM cache').all());
  await assert.rejects(()=>refreshOddsSnapshot(db,key,'FULL','2026_99_BUF_MIN',free,oddsApi(calls),NOW+300001));assert.equal(calls.length,3);assert.equal(JSON.stringify(db.prepare('SELECT * FROM cache').all()),before);
  const suspended:typeof fetch=async(input,init)=>{const r=await oddsApi(calls)(input,init);if(new URL(String(input)).pathname.endsWith('/events'))return r;const body=await r.json();for(const b of body.bookmakers)for(const m of b.markets)m.suspended=true;return Response.json(body);};
  await refreshOddsSnapshot(db,key,'FULL','ALL',free,suspended,NOW+300001);
  const r=await multiResearch(db,{'fanduelapi':'','odds-api':key},'FULL','ALL',free,NOW+300002);assert.equal(r.quotes.length,0);assert.ok(r.options.every(s=>!s.ticket));
 }finally{db.close();}
});

test('explicit native provider retry longer than one day is never shortened by the adapter',async()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);let calls=0;
 try{
  const paid:typeof fetch=async()=>{calls++;return Response.json({error_code:'EXCEEDED_FREQ_LIMIT'},{status:429,headers:{'Retry-After':'172800'}});};
  await assert.rejects(()=>refreshOddsSnapshot(db,key,'FULL','ALL',free,paid,NOW));const status=multiProviderStatus(db,keys,NOW);assert.equal(status.providers[1].retryAt,NOW+172800000);
  await assert.rejects(()=>refreshOddsSnapshot(db,key,'FULL','ALL',free,paid,NOW+86400001));assert.equal(calls,1);
 }finally{db.close();}
});
