import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRosterIdentities} from '../src/lib/providers/espn.ts';
import {checkExplorerRow} from '../src/lib/explorerEligibility.ts';
import {loadCurrentInjuries} from '../src/lib/providers/stats.ts';
import {playerHeading} from '../src/lib/propPresentation.ts';
import {analyzeDiscovery,discoverProps} from '../src/server/marketDiscovery.ts';
import {freeSchedule} from '../src/server/freeResearch.ts';
import {fetcher,players,NOW,kickoff} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
import {toGames,toFirstQuarterStats,statOf,supportsStatMarket} from '../src/lib/providers/stats.ts';
import type {Board} from '../src/server/fanduelRest.ts';
const board=(stale=false):Board=>{
 const at=new Date(NOW-(stale?10800000:300000)).toISOString(),meta={asOf:at,observedAt:at,delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
 return {complete:true,fetchedAt:NOW,events:[{meta,record:{id:'f1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff}},{meta,record:{id:'f2',event_name:'Los Angeles Rams @ Seattle Seahawks',starts_at:kickoff}}],props:players.map((p,i)=>({meta,record:{id:'p'+i,event_id:p[5]==='g1'?'f1':'f2',starts_at:kickoff,sport:'football',league:'NFL',player:p[0],team:p[2],stat:({'player_pass_yds':'passing_yards','player_rush_yds':'rushing_yards','player_reception_yds':'receiving_yards'} as Record<string,string>)[p[4]],period:'game',line:50.5,over_american:p[0]==='RB Aggressive'?190:-110,under_american:-110,market_status:'open',observed_at:at}}))};
};
const free:typeof fetch=async(input,init)=>{assert.ok(!/fanduelapi.com|the-odds-api.com/.test(String(input)));if(String(input).includes('play_by_play_'))return new Response(quarterCsv(String(input).includes('2026')?2026:2025));return fetcher(input,init);};
const request={key:'q',name:'QB One',teams:['BUF','MIN']};
test('verified heading uses current roster identity, never provider-reported team/position or historical eligibility',async()=>{
 const b=board(true);b.props=b.props.slice(0,1).map(p=>({...p,record:{...p.record,team:null,position:'WR',stat:'unsupported_player_market'}}));
 const r=await analyzeDiscovery(b,[],free,NOW),row=r.rows[0];assert.equal(row.analysis,null);assert.equal(row.roster!.verified,true);assert.equal(row.team,'BUF');assert.equal(row.position,'QB');assert.equal(playerHeading(row),'QB One — QB | Team: BUF');assert.equal(row.audit.reportedTeam,null);assert.equal(row.audit.reportedPosition,'WR');assert.equal(row.audit.reportedStat,'unsupported_player_market');assert.equal(r.summary.best.players,0);
});
test('duplicate athlete IDs/names, failed rosters, unknown players and inactive status are handled separately',async()=>{
 const missing=await resolveRosterIdentities([{...request,name:'No Such Player'}],free,NOW);assert.equal(missing.get('q')!.verified,false);
 const failed:typeof fetch=async(input,init)=>String(input).endsWith('/teams/min/roster')?new Response('{}',{status:503}):free(input,init);
 assert.equal((await resolveRosterIdentities([request],failed,NOW)).get('q')!.verified,false);
 for(const mode of ['ambiguous','inactive'] as const){
  const altered:typeof fetch=async(input,init)=>{const response=await free(input,init);if(String(input).endsWith('/teams/buf/roster')){const data=await response.json(),group=data.athletes.find((g:{items:{fullName:string}[]})=>g.items.some(a=>a.fullName==='QB One')),athlete=group.items.find((a:{fullName:string})=>a.fullName==='QB One');if(mode==='ambiguous')group.items.push({...athlete,id:'other-id'});else athlete.status='Inactive';return Response.json(data);}return response;};
  const identity=(await resolveRosterIdentities([request],altered,NOW)).get('q')!;assert.equal(identity.verified,mode==='inactive');
  const result=await analyzeDiscovery(board(),[],altered,NOW);assert.equal(result.summary.best.positions.QB,0);assert.ok(result.rows.filter(r=>r.player==='QB One').every(r=>mode==='inactive'?!r.validation!.checks.active.passed:playerHeading(r)==='QB One — Roster check needed'));
 }
});
test('trade resolves one current active team for the same ESPN ID but preserves and blocks a conflicting provider team',async()=>{
 const buf=await (await free('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/buf/roster')).json();const athlete=buf.athletes.flatMap((g:{items:unknown[]})=>g.items).find((a:{fullName:string})=>a.fullName==='QB One');
 const traded:typeof fetch=async(input,init)=>{const response=await free(input,init);if(/\/teams\/(buf|min)\/roster$/.test(String(input))){const data=await response.json();if(String(input).endsWith('/buf/roster')){for(const group of data.athletes)for(const a of group.items)if(a.fullName==='QB One')a.status='Inactive';}else{data.athletes[0].items.push({...athlete,status:'Active'});}return Response.json(data);}return response;};
 const identity=(await resolveRosterIdentities([request],traded,NOW)).get('q')!;assert.equal(identity.verified,true);assert.equal(identity.team,'MIN');
 const r=await analyzeDiscovery(board(),[],traded,NOW),row=r.rows.find(r=>r.player==='QB One')!;assert.equal(row.team,'MIN');assert.equal(row.audit.reportedTeam,'BUF');assert.match(playerHeading(row),/QB \| Team: MIN/);assert.equal(row.validation!.checks.game.passed,false);assert.equal(r.summary.best.positions.QB,0);
});
test('fresh fixture has supported identities and distinct tickets; each zero-player cause has explicit stage counts',async()=>{
 const good=await analyzeDiscovery(board(),[],free,NOW);assert.equal(good.full.best.options[0].legs.length,6);assert.equal(good.full.aggr.options[0].legs.length,6);assert.equal(good.summary.best.positions.QB,1);assert.ok(good.summary.stages.find(s=>s.stage==='roster')!.passingPlayers>=6);
 const first=good.rows.find(r=>r.analysis&&'name'in r.analysis)!;if(first.analysis&&'name'in first.analysis){const mismatched={...first,analysis:{...first.analysis,pos:'TE' as const}};const check=checkExplorerRow(mismatched,first.roster,await loadCurrentInjuries(2026,free,NOW),NOW,false);assert.equal(check.checks.history.passed,false);assert.match(check.checks.history.reasons.join(' '),/position conflicts/);}
 const stale=await analyzeDiscovery(board(true),[],free,NOW);assert.equal(stale.summary.best.players,0);assert.ok(stale.summary.stages.find(s=>s.stage==='roster')!.passingProps>0);assert.equal(stale.summary.stages.find(s=>s.stage==='freshness')!.passingProps,0);assert.ok(stale.summary.stages.find(s=>s.stage==='history')!.passingProps>0);
 const injuryMissing:typeof fetch=async(input,init)=>String(input).endsWith('/nfl/injuries')?new Response('{}',{status:503}):free(input,init);
 const injured=await analyzeDiscovery(board(),[],injuryMissing,NOW);assert.equal(injured.summary.best.players,0);assert.equal(injured.summary.stages.find(s=>s.stage==='injury')!.passingProps,0);assert.ok(injured.summary.stages.find(s=>s.stage==='roster')!.passingProps>0);
 const blocked=await analyzeDiscovery(board(),[],free,NOW,true);assert.equal(blocked.summary.best.players,0);assert.equal(blocked.summary.stages.find(s=>s.stage==='provider')!.passingProps,0);assert.ok(blocked.fullPreview!.options.length);
});
test('unmatched or ambiguous event/kickoff cannot verify a roster for that contract or qualify for a ticket',async()=>{
 for(const mode of ['missing-id','ambiguous','kickoff'] as const){const b=board();b.props=b.props.slice(0,1);if(mode==='missing-id')b.props[0].record.event_id='absent';if(mode==='ambiguous')b.events.push({...b.events[1],record:{...b.events[1].record,id:'f1'}});if(mode==='kickoff')b.props[0].record.starts_at='2026-11-22T18:00:00Z';const r=await analyzeDiscovery(b,[],free,NOW);assert.equal(r.summary.best.players,0);assert.equal(r.rows[0].validation!.checks.game.passed,false);if(mode!=='kickoff')assert.equal(playerHeading(r.rows[0]),'QB One — Roster check needed');}
});
test('one stale manual quote cannot discard current quotes; exact market and timestamp matching remain separate',async()=>{
 const game=(await freeSchedule(free,NOW))[0],base={player:'QB One',team:'BUF',eventId:game.id,period:'game',side:'Over' as const,line:50.5,odds:-110,confirmed:true as const};
 const r=await analyzeDiscovery(null,[{...base,id:'current',stat:'passing_yards',observedAt:new Date(NOW).toISOString()},{...base,id:'expired',stat:'passing_yards',observedAt:new Date(NOW-3600000).toISOString()},{...base,id:'missing-market',stat:'passing_completions',observedAt:new Date(NOW).toISOString()}],free,NOW);
 assert.ok(r.rows.find(r=>r.id==='current')!.analysis);assert.equal(r.rows.find(r=>r.id==='expired')!.analysis,null);assert.equal(r.rows.find(r=>r.id==='missing-market')!.analysis,null);assert.match(r.notes.join(' '),/excluded individually/);
});
test('passing+rushing and explicit alternate aliases preserve contracts and require both real stat components',async()=>{
 const records=[{player_display_name:'QB One',position:'QB',team:'BUF',opponent_team:'MIN',season:'2026',week:'1',game_id:'g',gsis_id:'p',passing_yards:'100',rushing_yards:'25'}],g=toGames(records)[0];assert.equal(statOf(g,'player_pass_rush_yds'),125);assert.equal(supportsStatMarket(toGames([{...records[0],rushing_yards:''}])[0],'player_pass_rush_yds'),false);
 const b=board();b.props[0].record.stat='passing_plus_rushing_yards_alternate';b.props[0].record.line=150.5;const r=await analyzeDiscovery(b,[],free,NOW);const row=r.rows.find(r=>r.player==='QB One'&&r.side==='Over')!;assert.equal(row.market,'player_pass_rush_yds_alternate');assert.equal(row.audit.reportedStat,'passing_plus_rushing_yards_alternate');assert.ok(row.analysis);assert.equal(row.line,150.5);
 const pbp:Record<string,string>[]=[{season_type:'REG',qtr:'1',game_id:'g',season:'2026',week:'1',home_team:'MIN',away_team:'BUF',pass_attempt:'1',complete_pass:'1',rush_attempt:'0',passer_player_id:'p',yards_gained:'10'},{season_type:'REG',qtr:'1',game_id:'g',season:'2026',week:'1',home_team:'MIN',away_team:'BUF',pass_attempt:'0',complete_pass:'0',rush_attempt:'1',rusher_player_id:'p',yards_gained:'5'}];assert.equal(toFirstQuarterStats(pbp,[g]).playerGames.find(g=>g.market==='player_pass_rush_yds_q1')!.value,15);const unattributed=pbp.map(r=>({...r,passer_player_id:''}));assert.ok(!toFirstQuarterStats(unattributed,[g]).playerGames.some(g=>g.market==='player_pass_rush_yds_q1'));
});

test('a roster response for a different team cannot verify an identity by its endpoint alone',async()=>{
 const wrongTeam:typeof fetch=async(input,init)=>{const response=await free(input,init);if(String(input).endsWith('/teams/buf/roster')){const data=await response.json();data.team={...data.team,abbreviation:'KC'};return Response.json(data);}return response;};
 const identity=(await resolveRosterIdentities([request],wrongTeam,NOW)).get('q')!;assert.equal(identity.verified,false);assert.equal(identity.team,null);assert.match(identity.reason,/Roster provider failed/);
});
