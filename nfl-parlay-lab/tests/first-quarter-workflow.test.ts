import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {fanduelQuarterResearch,pregameQuarterHistory} from '../src/server/firstQuarterResearch.ts';
import {matchBoard} from '../src/server/fanduelResearch.ts';
import {freeSchedule} from '../src/server/freeResearch.ts';
import {cachedProviderFetch} from '../src/server/load.ts';
import {SCHEMA} from '../src/server/db.ts';
import {fetcher,NOW,kickoff} from './manualFixtures.ts';
import type {Board} from '../src/server/fanduelRest.ts';
import {quarterCsv} from './quarterFixtures.ts';
const f:typeof fetch=async(input,init)=>{
 const url=String(input);if(url.includes('fanduelapi.com')||url.includes('the-odds-api.com'))throw new Error('No odds-provider requests allowed');
 if(url.includes('play_by_play_'))return new Response(quarterCsv(url.includes('2026')?2026:2025));
 return fetcher(input,init);
};
const meta={asOf:new Date(NOW-300000).toISOString(),observedAt:new Date(NOW-300000).toISOString(),delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
const board=():Board=>({complete:true,fetchedAt:NOW,events:[{record:{id:'fd-q1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff},meta}],props:[['QB One','BUF','passing_yards'],['RB One','BUF','rushing_yards'],['WR One','MIN','receiving_yards']].map(([player,team,stat],i)=>({meta,record:{id:`q${i}`,event_id:'fd-q1',sport:'football',league:'NFL',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff,player,team,stat,period:'q1',market_status:'open',line:20.5,over_american:-110,under_american:110,observed_at:meta.observedAt}}))});

test('shared cached Q1 rows produce two distinct single-game research triples with actual Q1 lines and history',async()=>{
 const result=await fanduelQuarterResearch(board(),f,NOW,'ALL','2026_10_BUF_MIN');
 assert.equal(result.best.options[0].legs.length,3);assert.equal(result.aggressive.options[0].legs.length,3);
 assert.notDeepEqual(result.best.options[0].legs.map(l=>l.id).sort(),result.aggressive.options[0].legs.map(l=>l.id).sort());
 for(const t of [result.best.options[0],result.aggressive.options[0]]){
  assert.equal(new Set(t.legs.map(l=>l.gameId)).size,1);assert.equal(new Set(t.legs.map(l=>l.espnPlayerId)).size,3);
  assert.ok(t.legs.every(l=>l.market.startsWith('1Q ')&&l.line===20.5&&l.mean===20&&l.sample===6&&l.rosterVerified&&l.providerDelaySeconds===300));
  assert.ok(t.warnings.some(w=>w.includes('RESEARCH ONLY')));
 }
 const gameRows={...board(),props:board().props.map(p=>({...p,record:{...p.record,period:'game',line:999}}))};
 const unsupported=await fanduelQuarterResearch(gameRows,f,NOW);assert.equal(unsupported.status,'unsupported');assert.equal(unsupported.best.options.length,0);assert.equal(unsupported.aggressive.options.length,0);assert.match(unsupported.missing.join(' '),/never substituted/);
 const games=await freeSchedule(f,NOW);assert.equal(matchBoard(board(),games,NOW).quotes.length,0,'Full-game pipeline must continue ignoring quarter prices');
});
test('stale, wrong-period, suspended and in-progress Q1 markets cannot produce tickets',async()=>{
 for(const patch of [{period:'game'},{period:'q2'},{market_status:'suspended'},{observed_at:new Date(NOW-31*60000).toISOString()},{starts_at:'2026-11-16T18:00:00Z'},{team:'KC'}]){
  const b=board();b.props=b.props.map(p=>({...p,record:{...p.record,...patch}}));const r=await fanduelQuarterResearch(b,f,NOW);assert.equal(r.best.options.length,0);assert.equal(r.aggressive.options.length,0);
 }
 const past=await fanduelQuarterResearch(board(),f,Date.parse(kickoff)+1000);assert.equal(past.candidates.length,0);
});
test('Q1 availability blocks questionable players, unknown active status and missing current injury coverage',async()=>{
 for(const mode of ['questionable','unknown-roster','missing-injuries']){
  const source:typeof fetch=async(input,init)=>{
   const url=String(input),r=await f(input,init);
   if(mode==='missing-injuries'&&url.endsWith('/nfl/injuries'))return new Response('{}',{status:503});
   if(url.endsWith('/teams/buf/roster')){const body=await r.json();for(const group of body.athletes)for(const a of group.items){if(mode==='unknown-roster')delete a.status;if(mode==='questionable'&&a.fullName==='QB One')a.injuries=[{status:'Questionable'}];}return Response.json(body);}
   return r;
  };
  const r=await fanduelQuarterResearch(board(),source,NOW);assert.equal(r.best.options.length,0,mode);assert.equal(r.aggressive.options.length,0,mode);
 }
});
test('unavailable Q1 history stays unavailable instead of using full-game stats; best may disclose Q1 price-implied estimate',async()=>{
 const noPbp:typeof fetch=async(input,init)=>String(input).includes('play_by_play_')?new Response(quarterCsv(2025)):f(input,init);
 const r=await fanduelQuarterResearch(board(),noPbp,NOW);assert.ok(r.best.options.length);assert.equal(r.aggressive.options.length,0);assert.ok(r.candidates.every(c=>c.sample===0&&c.mean===null));assert.match(r.missing.join(' '),/No dated verified Q1/);
});
test('future and unidentified PBP games are excluded, and quarter downloads reuse the existing free cache',async()=>{
 const raw={playerGames:[{playerId:'id',gameId:'future',market:'player_pass_yds_q1' as const,value:50,opportunities:4,season:2026,week:1,position:'QB',team:'BUF',opponent:'MIN'}],teamGames:[],gameTotals:[]};
 assert.equal(pregameQuarterHistory(raw,[{name:'A',pos:'QB',team:'BUF',opp:'MIN',season:2026,week:1,gameId:'future',playerId:'id',gameDate:new Date(NOW+1000).toISOString(),v:{}}],NOW).playerGames.length,0);
 const db=new Database(':memory:');db.exec(SCHEMA);let reads=0;
 try{const cached=cachedProviderFetch(db,async(...args)=>{reads++;return new Response('quarter fixture');});const url='https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv';await cached(url);await cached(url);assert.equal(reads,1);}finally{db.close();}
});
