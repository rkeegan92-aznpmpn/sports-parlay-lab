import test from 'node:test';
import assert from 'node:assert/strict';
import {PROP_STATS,propSides,contractHit} from '../src/lib/propMarkets.ts';
import {discoverProps,analyzeDiscovery} from '../src/server/marketDiscovery.ts';
import {matchBoard,fanduelResearch} from '../src/server/fanduelResearch.ts';
import {toGames,statOf,supportsStatMarket,toFirstQuarterStats} from '../src/lib/providers/stats.ts';
import {settlementOutcome} from '../src/lib/settle.ts';
import {freeSchedule} from '../src/server/freeResearch.ts';
import {fetcher,players,NOW,kickoff} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
import type {Board} from '../src/server/fanduelRest.ts';
const meta={asOf:new Date(NOW-300000).toISOString(),observedAt:new Date(NOW-300000).toISOString(),delaySeconds:300,sourceStatus:'delayed',sourceAgeSeconds:300};
const board=():Board=>({complete:true,fetchedAt:NOW,events:[{meta,record:{id:'f1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at:kickoff}},{meta,record:{id:'f2',event_name:'Los Angeles Rams @ Seattle Seahawks',starts_at:kickoff}}],props:players.map((p,i)=>({meta,record:{id:'p'+i,event_id:p[5]==='g1'?'f1':'f2',sport:'football',league:'NFL',starts_at:kickoff,player:p[0],team:p[2],stat:({'player_pass_yds':'passing_yards','player_rush_yds':'rushing_yards','player_reception_yds':'receiving_yards'} as Record<string,string>)[p[4]],period:'game',line:50.5,over_american:p[0]==='RB Aggressive'?190:-110,under_american:-110,market_status:'open',observed_at:meta.observedAt}}))});
const free:typeof fetch=async(input,init)=>{assert.ok(!/fanduelapi.com|the-odds-api.com/.test(String(input)),'No paid calls allowed');if(String(input).includes('play_by_play_'))return new Response(quarterCsv(String(input).includes('2026')?2026:2025));return fetcher(input,init);};
test('inventory retains every offered line/period/stat and missing price, not a fixed ladder or full-game substitution',async()=>{
 const b=board(),p=b.props[0];b.props=[...b.props,...[5,10,15,25,50,75,100,137].map(n=>({...p,record:{...p.record,id:'alt'+n,line:n+'+',american_odds:150}})),{...p,record:{...p.record,id:'unknown',period:'h1',stat:'provider_special',over_american:null,under_american:null}},{...p,record:{...p.record,id:'no-line',line:null}}];
 const rows=discoverProps(b,await freeSchedule(free,NOW),NOW);assert.deepEqual(rows.filter(r=>r.side==='AtLeast').map(r=>r.line),[5,10,15,25,50,75,100,137]);assert.ok(rows.some(r=>r.period==='h1'&&r.stat==='provider_special'&&r.odds===null&&r.limitations.some(s=>s.includes('period-specific'))));assert.ok(rows.some(r=>r.side==='unavailable'&&r.line===null));
 const mapped=matchBoard(b,await freeSchedule(free,NOW),NOW);assert.ok(mapped.quotes.some(q=>q.side==='AtLeast'&&q.line===137&&q.odds===150));assert.ok(!mapped.quotes.some(q=>q.market==='provider_special'));
 const stale=discoverProps(b,await freeSchedule(free,NOW),NOW+1801000);assert.ok(stale.every(r=>!r.fresh));
});
test('AtLeast exact equality wins while integer Over pushes; normalization never shifts saved lines',()=>{
 assert.equal(contractHit(25,'AtLeast',25),true);assert.equal(contractHit(25,'Over',25),false);assert.equal(propSides({line:25,over_american:-110})[0].side,'Over');assert.equal(propSides({line:'25+',american_odds:120})[0].line,25);
 const game=toGames([{player_display_name:'A',position:'QB',team:'BUF',opponent_team:'MIN',season:'2026',week:'1',game_id:'g',gsis_id:'p',passing_yards:'25'}])[0];
 const selection={player:'A',playerId:'p',opp:'MIN',market:'player_pass_yds_alternate',line:25,gameId:'g'};
 assert.equal(settlementOutcome({...selection,side:'AtLeast'},[game]).hit,1);assert.equal(settlementOutcome({...selection,side:'Over'},[game]).status,'push');
});
test('new statistics are supported only with real columns; missing interceptions/completions cannot become zero observations',()=>{
 const base={player_display_name:'A',position:'QB',team:'BUF',opponent_team:'MIN',season:'2026',week:'1',game_id:'g',gsis_id:'p'},g=toGames([{...base,passing_attempts:'31',completions:'22',interceptions:'1',rushing_tds:'0',receiving_tds:'0'}])[0];
 assert.equal(statOf(g,'player_pass_attempts'),31);assert.equal(statOf(g,'player_pass_completions'),22);assert.equal(statOf(g,'player_pass_interceptions'),1);assert.equal(supportsStatMarket(toGames([base])[0],'player_pass_interceptions'),false);
});
test('Q1 counts use actual Q1 flags; absent flags do not invent touchdown or interception history',()=>{
 const player=toGames([{player_display_name:'A',position:'QB',team:'BUF',opponent_team:'MIN',season:'2026',week:'1',game_id:'g',gsis_id:'p'}])[0];
 const row={season_type:'REG',qtr:'1',game_id:'g',season:'2026',week:'1',home_team:'MIN',away_team:'BUF',pass_attempt:'1',complete_pass:'1',passer_player_id:'p',yards_gained:'10'};
 const data=toFirstQuarterStats([row,{...row,qtr:'2',yards_gained:'200'}],[player]);assert.equal(data.playerGames.find(g=>g.market==='player_pass_completions_q1')?.value,1);assert.ok(!data.playerGames.some(g=>g.market==='player_pass_interceptions_q1'));
});
test('expanded discovery preserves distinct six-leg tickets, provenance, missing Q1 reasons and source guards',async()=>{
 const result=await analyzeDiscovery(board(),[],free,NOW);assert.equal(result.full.best.options[0].legs.length,6);assert.equal(result.full.aggr.options[0].legs.length,6);assert.notDeepEqual(result.full.best.options[0].legs.map(l=>l.id).sort(),result.full.aggr.options[0].legs.map(l=>l.id).sort());assert.equal(result.quarter.best.options.length,0);assert.match(result.coverage,/PARTIAL/);
 const blocked=await analyzeDiscovery(board(),[],free,NOW,true);assert.equal(blocked.full.best.options.length,0);assert.ok(blocked.fullPreview!.options.length);
 const b=board();b.props.push({...b.props[0],record:{...b.props[0].record,over_american:999}});assert.ok(discoverProps(b,await freeSchedule(free,NOW),NOW).filter(r=>r.id==='p0:Over').every(r=>r.limitations.some(s=>s.includes('Conflicting'))));
});

test('new passing counts enter the verified full-game pipeline only when genuine columns exist',async()=>{
 const {gunzipSync,gzipSync}=await import('node:zlib');
 const f:typeof fetch=async(input,init)=>{
  const r=await free(input,init);
  if(String(input).endsWith('/assets/2026')){const text=gunzipSync(Buffer.from(await r.arrayBuffer())).toString().trim().split('\n');return new Response(gzipSync(text.map((line,i)=>line+(i?',24,1':',completions,interceptions')).join('\n')));}
  return r;
 };
 const b=board();b.props[0].record={...b.props[0].record,stat:'passing_completions',line:18.5};
 const analyzed=await fanduelResearch(b,f,NOW);assert.ok(analyzed.analysisCandidates.some(c=>c.market==='player_pass_completions'&&c.sample>=6&&c.mean===24));assert.equal(analyzed.tickets.length,2);
 const missing=await fanduelResearch(b,free,NOW);assert.ok(!missing.analysisCandidates.some(c=>c.market==='player_pass_completions'));assert.equal(missing.tickets.length,0);
});
test('threshold analysis preserves exact quote and injury exclusions still block automatic tickets',async()=>{
 const b=board(),p=b.props[1];b.props.push({...p,record:{...p.record,id:'actual25',line:'25+',american_odds:-110}});
 const r=await fanduelResearch(b,free,NOW);const alt=r.analysisCandidates.find(c=>c.side==='AtLeast');assert.ok(alt);assert.equal(alt.line,25);assert.equal(alt.market,'player_rush_yds_alternate');assert.equal(alt.odds,-110);assert.equal(alt.scored!.conditionalOnNoPush,false);
 const injured:typeof fetch=async(input,init)=>{const response=await free(input,init);if(String(input).endsWith('/teams/buf/roster')){const data=await response.json();for(const group of data.athletes)for(const athlete of group.items)if(athlete.fullName==='QB One')athlete.injuries=[{status:'Questionable'}];return Response.json(data);}return response;};
 assert.equal((await fanduelResearch(b,injured,NOW)).tickets.length,0);
});

test('manual AtLeast observations use the manual pipeline without being promoted to independent API quotes',async()=>{
 const g=(await freeSchedule(free,NOW))[0];const manual={id:'manual:1',player:'RB One',team:'BUF',eventId:g.id,period:'game',stat:'rushing_yards',side:'AtLeast' as const,line:25,odds:-110,observedAt:new Date(NOW).toISOString(),confirmed:true as const};
 const r=await analyzeDiscovery(null,[manual],free,NOW);assert.equal(r.rows[0].source,'manual');assert.equal(r.rows[0].side,'AtLeast');assert.ok(r.rows[0].analysis);assert.match(r.rows[0].freshness,/NOT API VERIFIED/);
 const mismatch=await analyzeDiscovery(null,[{...manual,team:'MIN'}],free,NOW);assert.equal(mismatch.rows[0].analysis,null);
});

test('other periods use their own PBP quarters and cannot leak into Q1 analysis or tickets',async()=>{
 const {loadStatsHistory,loadFirstQuarterHistory,parseCsv}=await import('../src/lib/providers/stats.ts');
 const shifted:typeof fetch=async(input,init)=>{
  if(String(input).includes('play_by_play_')){
   const text=quarterCsv(String(input).includes('2026')?2026:2025).trim().split('\n'),columns=text[0].split(','),q=columns.indexOf('qtr');
   return new Response(text.map((r,i)=>{if(!i)return r;const fields=r.split(',');fields[q]='2';return fields.join(',');}).join('\n'));
  }return free(input,init);
 };
 const stats=await loadStatsHistory(2026,shifted),q2=await loadFirstQuarterHistory(2026,shifted,stats.games,'q2'),q1=await loadFirstQuarterHistory(2026,shifted,stats.games);
 assert.ok(q2.playerGames.length);assert.ok(q2.playerGames.every(g=>g.market.endsWith('_q2')));assert.equal(q1.playerGames.length,0);assert.equal(q2.teamGames.length,0,'Do not infer second-quarter team totals from cumulative scores');
 const b=board();b.props=[{...b.props[0],record:{...b.props[0].record,period:'q2',line:20.5}}];
 const result=await analyzeDiscovery(b,[],shifted,NOW);assert.ok(result.rows.some(r=>r.period==='q2'&&r.analysis&&r.analysis.sample>=4));assert.equal(result.quarter.best.options.length,0);assert.equal(result.full.best.options.length,0);
});

test('free schedule outage keeps the cached inventory visible without inventing matches or tickets',async()=>{
 const failed:typeof fetch=async(input,init)=>String(input).includes('games.csv')?new Response('unavailable',{status:503}):free(input,init);
 const r=await analyzeDiscovery(board(),[],failed,NOW);assert.ok(r.rows.length);assert.ok(r.rows.every(r=>r.analysis===null&&r.limitations.some(s=>s.includes('Unmatched'))));assert.equal(r.full.best.options.length,0);assert.equal(r.quarter.best.options.length,0);assert.match(r.notes.join(' '),/schedule unavailable/);
});
