import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {matchNflEvents,nflTeam} from '../src/server/nflEventMatching.ts';
import {quarterGameCatalog} from '../src/server/quarterGameCatalog.ts';
import {inspectQuarterBoard,quarterDate} from '../src/server/quarterDiagnostics.ts';
import {fanduelQuarterResearch} from '../src/server/firstQuarterResearch.ts';
import {fetcher,NOW,players} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
import type {Board} from '../src/server/fanduelRest.ts';
const games=[
 {id:'2026_10_BUF_MIN',away_team:'Buffalo Bills',home_team:'Minnesota Vikings',commence_time:'2026-11-13T01:15:00.000Z',label:'BUF @ MIN',espnEventId:'99901'},
 {id:'2026_10_LA_SEA',away_team:'Los Angeles Rams',home_team:'Seattle Seahawks',commence_time:'2026-11-14T21:30:00.000Z',label:'LA @ SEA',espnEventId:'99902'},
 {id:'2026_10_KC_BAL',away_team:'Kansas City Chiefs',home_team:'Baltimore Ravens',commence_time:'2026-11-15T18:00:00.000Z',label:'KC @ BAL',espnEventId:'99903'},
 {id:'2026_10_TB_PHI',away_team:'Tampa Bay Buccaneers',home_team:'Philadelphia Eagles',commence_time:'2026-11-17T01:15:00.000Z',label:'TB @ PHI',espnEventId:'99904'},
 {id:'2026_10_DEN_NYJ',away_team:'Denver Broncos',home_team:'New York Jets',commence_time:'2026-11-16T01:20:00.000Z',label:'DEN @ NYJ',espnEventId:'99905'},
].map(g=>({...g,week:10}));
const meta={asOf:new Date(NOW-300000).toISOString(),observedAt:new Date(NOW-300000).toISOString(),delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
const records=[
 {id:101,event_name:'  BUF@minnesota vikings  ',starts_at:'2026-11-12T18:15:00-07:00'},
 {id:'sat',away_team:' L.A. Rams ',home_team:'SEATTLE SEAHAWKS',starts_at:games[1].commence_time},
 {id:'opaque-sun',nfl_game_id:games[2].id,starts_at:games[2].commence_time},
 {id:104,espn_event_id:'99904',event_name:'TB at PHI',starts_at:'2026-11-16T20:15:00-05'},
 {id:'night',event_name:'Broncos @ NY Jets',starts_at:games[4].commence_time},
];
const board=():Board=>({complete:true,fetchedAt:NOW,events:records.map(record=>({record,meta})),props:players.slice(0,6).map((p,i)=>({meta,record:{id:'p'+i,event_id:i<3?101:'sat',starts_at:games[i<3?0:1].commence_time,sport:'football',league:'NFL',player:p[0],team:p[2],stat:({'player_pass_yds':'passing_yards','player_rush_yds':'rushing_yards','player_reception_yds':'receiving_yards'} as Record<string,string>)[p[4]],period:'q1',market_status:'open',line:20.5,over_american:-110,under_american:110,observed_at:meta.observedAt}}))});
const f:typeof fetch=async(input,init)=>{
 const url=String(input);assert.ok(!/fanduelapi.com|the-odds-api.com/.test(url),'No paid API requests');
 if(url.includes('games.csv')){
  const abbreviations=[['BUF','MIN'],['LA','SEA'],['KC','BAL'],['TB','PHI'],['DEN','NYJ']];
  return new Response(gzipSync('game_id,season,week,game_type,gameday,home_team,away_team,home_score,away_score,espn,gametime\n'+games.map((g,i)=>`${g.id},2026,10,REG,${quarterDate(g.commence_time)},${abbreviations[i][1]},${abbreviations[i][0]},,,${g.espnEventId},${new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(g.commence_time))}`).join('\n')));
 }
 if(url.includes('play_by_play_'))return new Response(quarterCsv(url.includes('2026')?2026:2025));return fetcher(input,init);
};
test('catalog lists Thursday, Saturday, Sunday and Monday independently of odds, player stats or provider failure',async()=>{
 const empty=await quarterGameCatalog(null,f,NOW);assert.equal(empty.games.length,5);assert.deepEqual(empty.games.map(g=>g.nflDate),['2026-11-12','2026-11-14','2026-11-15','2026-11-15','2026-11-16']);assert.ok(empty.games.every(g=>g.cachedQ1Rows===null));
 const broken=await quarterGameCatalog({...board(),events:undefined} as unknown as Board,f,NOW);assert.equal(broken.games.length,5);assert.ok(broken.games.every(g=>g.cachedQ1Rows===null));
 const cached=await quarterGameCatalog(board(),f,NOW);assert.equal(cached.games.length,5);assert.equal(cached.games.find(g=>g.id===games[0].id)!.cachedQ1Rows,3);
});
test('normalized names, numeric provider IDs and explicit namespaced IDs match with UTC offsets',()=>{
 const result=matchNflEvents(records,games);assert.equal(result.events.size,5);assert.equal(result.events.get('101')!.id,games[0].id);assert.equal(result.events.get('104')!.id,games[3].id);assert.equal(result.checks[2].method,'explicit-nfl-id');assert.equal(result.checks[3].method,'explicit-espn-id');
 const numericProp=board();numericProp.props[0].record.id=700;assert.ok(inspectQuarterBoard(numericProp,games,NOW).quotes.some(q=>q.id==='700:Over'));
 for(const [name,expected] of [['Washington Commanders','WAS'],['wsh','WAS'],['L.A. Rams','LA'],['kc chiefs','KC'],['NY Jets','NYJ'],['Minnesota','MIN']])assert.equal(nflTeam(name),expected);assert.equal(nflTeam('Los Angeles'),null);assert.equal(nflTeam('New York'),null);
 const numericOnly=matchNflEvents([{id:99904,starts_at:games[3].commence_time}],games);assert.equal(numericOnly.events.size,0,'Independent numeric IDs are not guessed to be ESPN IDs');
});
test('conflicting IDs, teams, kickoffs and ambiguous schedule candidates remain excluded without widening tolerance',()=>{
 for(const patch of [{espn_event_id:'99904',nfl_game_id:games[0].id},{away_team:'KC',home_team:'BAL'},{starts_at:'2026-11-13T01:16:00.001Z'},{starts_at:'2026-11-12T20:15:00'}])assert.equal(matchNflEvents([{...records[0],...patch}],games).events.size,0);
 assert.equal(matchNflEvents([{...records[0],starts_at:'2026-11-13T01:16:00Z'}],games).events.size,1);
 const duplicate=matchNflEvents([records[0],{...records[0],starts_at:'2026-11-13T01:15:01Z'},records[0]],games);assert.equal(duplicate.events.size,0);assert.ok(duplicate.checks.every(c=>c.matchedGameId===null));
 const ambiguous=[games[0],{...games[0],id:'different-id'}];assert.equal(matchNflEvents([records[0]],ambiguous).events.size,0);
 assert.equal(matchNflEvents([{...records[0],nfl_game_id:games[0].id}],ambiguous).events.size,1);
});
test('selected canonical or verified provider game controls Q1 candidates/tickets even after a stale Sunday scope',async()=>{
 const r=await fanduelQuarterResearch(board(),f,NOW,'2026-11-15',games[0].id);assert.equal(r.best.options[0].legs.length,3);assert.equal(r.aggressive.options[0].legs.length,3);assert.ok(r.candidates.every(c=>c.gameId===games[0].id));assert.equal(r.diagnostics.effectiveDate,'2026-11-12');assert.equal(r.games.length,5,'Individual analysis does not erase catalog choices');
 const alias=await fanduelQuarterResearch(board(),f,NOW,'ALL','101');assert.ok(alias.candidates.every(c=>c.gameId===games[0].id));assert.equal(alias.diagnostics.selectedGameId,games[0].id);
 const sat=await fanduelQuarterResearch(board(),f,NOW,'ALL',games[1].id);assert.ok(sat.candidates.length);assert.ok(sat.candidates.every(c=>c.gameId===games[1].id));assert.ok(sat.best.options[0].legs.every(c=>c.gameId===games[1].id));
 const unknown=await fanduelQuarterResearch(board(),f,NOW,'ALL','not-a-game');assert.equal(unknown.candidates.length,0);
});
test('All upcoming has no Sunday filter; Sunday-only uses Eastern date including UTC-Monday night game',()=>{
 const all=inspectQuarterBoard(board(),games,NOW);assert.equal(all.selected.length,5);
 const sunday=inspectQuarterBoard(board(),games,NOW,'2026-11-15');assert.deepEqual(sunday.selected.map(g=>g.id).sort(),[games[2].id,games[4].id].sort());
});
test('140 reached cached games and 8 future-unmatched rows get truthful, independent rejection counts',()=>{
 const b=board(),base=b.props[0];b.props=[...Array.from({length:140},(_,i)=>({...base,record:{...base.record,id:'past'+i,event_id:'past',starts_at:'2026-11-08T18:00:00Z'}})),...Array.from({length:8},(_,i)=>({...base,record:{...base.record,id:'unmatched'+i,event_id:'unknown',starts_at:games[0].commence_time}}))];
 const d=inspectQuarterBoard(b,games,NOW).diagnostics;assert.equal(d.supportedQ1Rows,148);assert.deepEqual(d.kickoffCounts,{past:140,invalid:0,future:8});assert.equal(d.rejections.filter(r=>r.stage==='kickoff').length,140);assert.equal(d.rejections.filter(r=>r.stage==='event-match').length,8);assert.equal(d.matchedGames,0);
 const missing=board();missing.props=missing.props.map(p=>({...p,record:{...p.record,over_american:null,under_american:null}}));const counts=inspectQuarterBoard(missing,games,NOW).diagnostics;assert.equal(counts.matchedGames,2,'Event identity counts do not depend on prices');assert.equal(counts.matchedSidePrices,0);
});
test('provider failures and stale prices remain non-actionable while selected cached preview is available',async()=>{
 const result=await fanduelQuarterResearch(board(),f,NOW,'ALL',games[0].id,true,true);assert.equal(result.preview!.options.length,2);assert.equal(result.best.options.length,0);assert.equal(result.diagnostics.freshSidePrices,0);assert.equal(result.diagnostics.eligiblePlayers,0);assert.equal(result.diagnostics.providerVerificationBlocked,true);
 const b=board();b.props=b.props.map(p=>({...p,meta:{...p.meta,asOf:new Date(NOW-10800000).toISOString()},record:{...p.record,observed_at:new Date(NOW-10800000).toISOString()}}));const stale=await fanduelQuarterResearch(b,f,NOW,'ALL',games[0].id);assert.equal(stale.best.options.length,0);assert.equal(stale.diagnostics.matchedGames,2);
 const past=inspectQuarterBoard(board(),games,Date.parse(games[0].commence_time));assert.ok(!past.selected.some(g=>g.id===games[0].id));
});

test('selected upcoming game has explicit missing coverage rather than treating past-week inventory as usable',()=>{
 const b=board();
 const absent=inspectQuarterBoard(b,games,NOW,'ALL',games[3].id);
 assert.equal(absent.diagnostics.priceAvailability,'no-q1-coverage-for-selected-games');assert.equal(absent.diagnostics.selectedQ1Rows,0);assert.equal(absent.active.length,0);
 const fresh=inspectQuarterBoard(b,games,NOW,'ALL',games[0].id);assert.equal(fresh.diagnostics.priceAvailability,'fresh-prices-present');assert.ok(fresh.active.length);
 const stale=inspectQuarterBoard(b,games,NOW+31*60000,'ALL',games[0].id);assert.equal(stale.diagnostics.priceAvailability,'stale-or-non-pregame-prices');assert.equal(stale.active.length,0);
 const expired=inspectQuarterBoard(b,games,Date.parse(games[1].commence_time)+1);assert.equal(expired.active.length,0);assert.equal(expired.diagnostics.kickoffCounts.past,b.props.length);
});
