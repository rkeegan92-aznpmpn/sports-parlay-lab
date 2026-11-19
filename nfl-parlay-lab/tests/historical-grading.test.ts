import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {SCHEMA} from '../src/server/db.ts';
import {gradeArchiveLeg,ticketGrade,finalized,gradeSavedTickets,savedGrades} from '../src/server/savedGrades.ts';
import {simulateHistorical,historicalTraining} from '../src/lib/historical.ts';
import type {StatGame} from '../src/lib/providers/stats.ts';
import type {Candidate} from '../src/lib/types.ts';
import {manualResearch} from '../src/server/freeResearch.ts';
import {fetcher,players,NOW,finishFixtureGames} from './manualFixtures.ts';
import {saveTicket,listSavedTickets} from '../src/server/savedTickets.ts';
import {gunzipSync,gzipSync} from 'node:zlib';
const KO=Date.parse('2026-11-15T18:00:00Z');
const leg={name:'Fixture',pos:'RB',historyPlayerId:'id',team:'BUF',opp:'MIN',kickoff:new Date(KO).toISOString(),market:'player_rush_yds',side:'Over',line:10} as Candidate;
const game={name:'Fixture',pos:'RB',playerId:'id',team:'BUF',opp:'MIN',season:2026,week:10,gameId:'g',kickoffTs:KO,gameDate:'2026-11-15',completed:true,availableMarkets:['player_rush_yds'],v:{rushing_yards:11}} as StatGame;
test('archive market rules cover wins, losses, pushes, explicit DNP voids, zero participation statistics, missing and incomplete results',()=>{
 for(const [value,expected]of [[11,'settled'],[9,'settled'],[10,'push']] as const){const g=gradeArchiveLeg(leg,KO-3600000,'g',[{...game,v:{rushing_yards:value}}],'nflverse');assert.equal(g.status,expected);assert.equal(g.actual,value);assert.equal(g.hit,value===10?null:value>10?1:0);}
 const dnp=gradeArchiveLeg(leg,KO-3600000,'g',[{...game,nonParticipationVerified:true,v:{},availableMarkets:[]}],'espn');
 // The source-specific identity must match; a different provider identity is never guessed.
 assert.equal(dnp.status,'void');
 assert.equal(gradeArchiveLeg(leg,KO-3600000,'g',[],'nflverse').status,'pending');
 assert.equal(gradeArchiveLeg(leg,KO-3600000,'g',[{...game,completed:false}],'nflverse').status,'pending');
 assert.equal(gradeArchiveLeg(leg,KO-3600000,'g',[{...game,availableMarkets:[]}],'nflverse').status,'pending');
 assert.equal(gradeArchiveLeg(leg,KO+1,'g',[game],'nflverse').status,'pending');
 assert.equal(gradeArchiveLeg({...leg,line:.5},KO-3600000,'g',[{...game,v:{rushing_yards:0}}],'nflverse').hit,0);
 const loss={player:'a',status:'settled' as const,hit:0 as const},pending={player:'b',status:'pending' as const,hit:null};
 assert.equal(ticketGrade([loss,...Array(5).fill(pending)]),'loss');assert.equal(finalized([loss,...Array(5).fill(pending)]),false);
 assert.equal(ticketGrade(Array(6).fill({player:'a',status:'void',hit:null})),'void');
});
function historicalFixture(){
 const schedule:Record<string,string>[]=[],games:StatGame[]=[];
 for(let week=1;week<=8;week++)for(const [away,home]of [['BUF','MIN'],['LA','SEA']]){
  const date=new Date(Date.UTC(2026,8,6+(week-1)*7)),day=date.toISOString().slice(0,10),id=`2026_${String(week).padStart(2,'0')}_${away}_${home}`;
  schedule.push({game_id:id,season:'2026',week:String(week),game_type:'REG',gameday:day,gametime:'13:00',away_team:away,home_team:home,home_score:'21',away_score:'20'});
  for(const [index,pos]of ['QB','RB','RB','WR','WR','TE'].entries()){
   const value=50+week*7+index*3,team=index%2?home:away;
   games.push({name:`${away}-${pos}-${index}`,playerId:`${away}-${pos}-${index}`,pos,team,opp:team===away?home:away,season:2026,week,gameId:id,kickoffTs:Date.parse(day+'T17:00:00Z'),gameDate:day,completed:true,availableMarkets:['player_pass_yds','player_rush_yds','player_reception_yds'],v:{passing_yards:value,rushing_yards:value,receiving_yards:value}});
  }
 }
 return {schedule,games};
}
test('walk-forward backtests freeze features before kickoff and never invent historical odds',()=>{
 const {schedule,games}=historicalFixture();const r=simulateHistorical(games,schedule,2026);
 assert.ok(r.tickets.length>=4);
 for(const t of r.tickets){assert.equal(t.label,'BACKTEST');assert.equal(t.legs.length,6);assert.deepEqual(['QB','RB','WR','TE'].map(p=>t.legs.filter(l=>l.pos===p).length),[1,2,2,1]);assert.ok(t.legs.every(l=>l.latestTrainingAvailableAt<t.capturedAt&&l.odds===null));assert.equal(t.ev,null);assert.ok(Math.max(...Object.values(t.legs.reduce((a,l)=>(a[l.gameId]=(a[l.gameId]??0)+1,a),{} as Record<string,number>)))<=3);}
 const changed=games.map(g=>g.week>=6?{...g,v:{passing_yards:9999,rushing_yards:9999,receiving_yards:9999}}:g);
 const later=simulateHistorical(changed,schedule,2026);
 const features=(ts:typeof r.tickets)=>ts.filter(t=>t.week===6).map(t=>t.legs.map(({grade,...l})=>l));
 assert.deepEqual(features(r.tickets),features(later.tickets),'target and future boxscores cannot influence prediction features');
 const poison={...games.at(-1)!,get v():Record<string,number>{throw new Error('Future statistics read during prediction');}};
 assert.doesNotThrow(()=>historicalTraining([games[0],poison],games[5].kickoffTs!));
 assert.equal(r.oddsDependentMetrics.ticketROI,null);
 assert.equal(simulateHistorical(games,schedule,2026,[],Date.parse('2026-09-10T00:00:00Z')).tickets.length,0,'future slates cannot be emitted as historical results');
});

test('multi-game saved tickets start pending, show an early loss, finish later, and never duplicate archives',async()=>{
 const f:typeof fetch=async(input,init)=>{const response=await fetcher(input,init);if(String(input).includes('games.csv')){const bytes=Buffer.from(await response.arrayBuffer());return new Response(gzipSync(gunzipSync(bytes).toString().replace('2026_10_LA_SEA,2026,10,REG,2026-11-15','2026_10_LA_SEA,2026,10,REG,2026-11-22')));}return response;};
 const q=players.map(p=>({eventId:p[5]==='g1'?'2026_10_BUF_MIN':'2026_10_LA_SEA',player:p[0],market:p[4],side:'Over',line:50.5,odds:p[0]==='RB Aggressive'?190:-110,observedAt:new Date(NOW).toISOString(),confirmed:true}));
 const research=await manualResearch(q,f,NOW);const t=research.best.options[0];assert.ok(t);
 const legs=t.legs.map(l=>l.gameId==='2026_10_BUF_MIN'?{...l,line:999}:l);
 const db=new Database(':memory:');db.exec(SCHEMA);
 try{
  const saved=saveTicket(db,{...t,kind:'best',legs},NOW);const snapshot=listSavedTickets(db)[0].legs_json;
  assert.equal(savedGrades(db)[saved.id].status,'pending');
  finishFixtureGames();await gradeSavedTickets(db,f,Date.parse('2026-11-15T19:00:00Z'));
  assert.equal(savedGrades(db)[saved.id].status,'pending','NFL score-only records cannot grade an in-progress check window');
  await gradeSavedTickets(db,f,Date.parse('2026-11-16T18:00:00Z'));
  const partial=savedGrades(db)[saved.id];assert.equal(partial.status,'loss');assert.equal(partial.finalized,false);assert.ok(partial.legs.some(l=>l.reason==='awaiting-kickoff'));assert.ok(partial.legs.some(l=>l.actual===100));
  const outage=await gradeSavedTickets(db,async()=>new Response('',{status:503}),Date.parse('2026-11-17T18:00:00Z'));assert.ok(outage.providerErrors.length);assert.equal(savedGrades(db)[saved.id].status,'loss','a source outage must not erase a verified early loss');
  await gradeSavedTickets(db,f,Date.parse('2026-11-23T18:00:00Z'));assert.equal(savedGrades(db)[saved.id].finalized,true);
  await gradeSavedTickets(db,f,Date.parse('2026-11-24T18:00:00Z'));
  const legacyLegs=legs.map(({historyPlayerId,...l})=>l);const legacy=saveTicket(db,{...t,kind:'best',legs:legacyLegs},NOW);const legacyBefore=listSavedTickets(db)[0].legs_json;await gradeSavedTickets(db,f,Date.parse('2026-11-24T18:00:00Z'));assert.equal(savedGrades(db)[legacy.id].finalized,true);assert.ok(savedGrades(db)[legacy.id].legs.every(l=>l.resolvedPlayerId&&l.identityMethod));assert.equal(listSavedTickets(db)[0].legs_json,legacyBefore);
  const ambiguous=saveTicket(db,{...t,kind:'best',legs:legacyLegs},NOW);
  const ambiguousFetch:typeof fetch=async(input,init)=>{const response=await f(input,init);if(String(input).endsWith('/assets/2026')){const lines=gunzipSync(Buffer.from(await response.arrayBuffer())).toString().trim().split('\n');const row=lines.find(l=>l.startsWith('QB One,')&&l.includes(',2026,10,'));if(row)lines.push(row.replace('id-QB One','another-id-QB One'));return new Response(gzipSync(lines.join('\n')));}return response;};
  await gradeSavedTickets(db,ambiguousFetch,Date.parse('2026-11-24T18:00:00Z'));assert.ok(savedGrades(db)[ambiguous.id].legs.some(l=>l.reason==='missing-or-ambiguous-final-player-identity'));
  assert.equal(listSavedTickets(db).length,3);assert.equal(listSavedTickets(db).find(r=>r.id===saved.id)!.legs_json,snapshot);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM historical_backtests').get() as {n:number}).n,0);
 }finally{db.close();}
});

test('only verified recorded contracts available before the prediction cutoff can supply historical prices',()=>{
 const {games,schedule}=historicalFixture();const base=simulateHistorical(games,schedule,2026);
 const t=base.tickets.find(t=>t.week===6)!,l=t.legs[0];
 const quote={playerId:l.playerId,gameId:l.gameId,market:l.market,side:'Over' as const,line:25.5,odds:-110,capturedAt:t.capturedAt-1000,oddsAt:t.capturedAt-2000,captureId:123};
 const r=simulateHistorical(games,schedule,2026,[quote]);const recorded=r.tickets.flatMap(t=>t.legs).filter(l=>l.quoteCaptureId===123);
 assert.ok(recorded.length);assert.ok(recorded.every(l=>l.odds===-110&&l.lineSource==='recorded-pregame-quote'));
 const late=simulateHistorical(games,schedule,2026,[{...quote,capturedAt:t.capturedAt+1}]);assert.ok(late.tickets.flatMap(t=>t.legs).every(l=>l.odds===null));
 assert.equal(r.oddsDependentMetrics.payout,null,'individual prices do not manufacture a combined FanDuel quote');
});

test('explicit ESPN final DNP evidence is voidable; postponed or wrong-season evidence is not',async()=>{
 const {loadEspnSettlementStats}=await import('../src/lib/providers/espn.ts');
 let completed=true,year=2026,actualStat='--';
 const f:typeof fetch=async()=>Response.json({header:{id:'401',season:{year,type:2},week:{number:10},competitions:[{date:'2026-11-15T18:00:00Z',status:{type:{completed,name:completed?'STATUS_FINAL':'STATUS_POSTPONED'}},competitors:[{homeAway:'home',team:{abbreviation:'MIN'}},{homeAway:'away',team:{abbreviation:'BUF'}}]}]},boxscore:{players:[{team:{abbreviation:'BUF'},statistics:[{name:'rushing',keys:['rushingYards'],athletes:[{athlete:{id:'100',displayName:'Fixture'},didNotPlay:true,stats:[actualStat]}]}]}]}});
 const selections=[{playerId:'espn:100',eventId:'401',season:2026,kickoffTs:KO}];
 const final=await loadEspnSettlementStats(selections,f);assert.equal(final.games[0].nonParticipationVerified,true);
 assert.equal(gradeArchiveLeg({...leg,espnPlayerId:'espn:100'},KO-1000,'401',final.games,'espn').status,'void');
 actualStat='9';const conflict=await loadEspnSettlementStats(selections,f);assert.equal(gradeArchiveLeg({...leg,espnPlayerId:'espn:100'},KO-1000,'401',conflict.games,'espn').status,'pending');actualStat='--';
 completed=false;assert.equal((await loadEspnSettlementStats(selections,f)).games.length,0);
 completed=true;year=2025;assert.equal((await loadEspnSettlementStats(selections,f)).games.length,0);
});

test('explicit nonparticipation cannot become a calibration loss even when a provider lists zero statistics',async()=>{
 const {settlementOutcome}=await import('../src/lib/settle.ts');
 const r=settlementOutcome({player:leg.name,playerId:leg.historyPlayerId,team:leg.team,opp:leg.opp,market:leg.market,side:leg.side,line:leg.line,season:2026,requireFinal:true,snapshotTs:KO-1000,gameId:'g'},[{...game,nonParticipationVerified:true,v:{rushing_yards:0}}]);
 assert.equal(r.status,'pending');assert.equal(r.hit,null);
});

test('saving pending grades is atomic and does not leave a duplicate archive when grading storage fails',()=>{
 const db=new Database(':memory:');db.exec(SCHEMA);
 const legs=['QB','RB','RB','WR','WR','TE'].map((pos,i)=>({id:`fixture-${i}`,name:`Fixture ${i}`,pos,team:i<3?'BUF':'SEA',opp:i<3?'MIN':'LA',gameId:i<3?'a':'b',kickoff:'2026-11-15T18:00:00Z',market:pos==='QB'?'player_pass_yds':pos==='RB'?'player_rush_yds':'player_reception_yds',side:'Over',line:50.5,odds:-110,oddsAt:'2026-11-10T18:00:00Z',source:'manual'}));
 try{db.exec('DROP TABLE saved_ticket_grades');assert.throws(()=>saveTicket(db,{kind:'best',legs,jointP:.1,decimal:40}));assert.equal(listSavedTickets(db).length,0);}finally{db.close();}
});
