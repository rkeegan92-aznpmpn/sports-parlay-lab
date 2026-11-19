import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreVerifiedHistory} from '../src/lib/model.ts';
import {manualResearch} from '../src/server/freeResearch.ts';
import {fetcher,players,NOW} from './manualFixtures.ts';
const leg=async()=>{
 const quotes=players.map(p=>({eventId:p[5]==='g1'?'2026_10_BUF_MIN':'2026_10_LA_SEA',player:p[0],market:p[4],side:'Over',line:50.5,odds:p[0]==='RB Aggressive'?190:-110,observedAt:new Date(NOW).toISOString(),confirmed:true}));
 return (await manualResearch(quotes,fetcher,NOW)).best.options[0].legs[0];
};
test('verified game values drive smoothed probability and uncertainty rather than odds or untrusted aggregate counts',async()=>{
 const c=await leg(),history={...c.history!,last10:{...c.history!.last10!,hits:0,hitGames:999}};
 const one=scoreVerifiedHistory({...c,history},NOW)!,two=scoreVerifiedHistory({...c,history,odds:300},NOW)!;
 assert.ok(one);assert.equal(one.scored!.p,two.scored!.p);assert.equal(one.scored!.p,8/10);
 assert.equal(one.history!.last10!.hits,6);assert.equal(one.scored!.historicalHitGames,6);
 assert.equal(one.scored!.confidence,'Unvalidated');assert.equal(one.scored!.estimateBasis,'verified-game-outcomes');
 assert.ok(one.scored!.historicalInterval!.lower<one.scored!.historicalInterval!.upper);assert.ok(one.scored!.historicalInterval!.upper<=1);
});
test('future, missing, duplicate, wrong-player and unproved games cannot support an automatic probability',async()=>{
 const c=await leg(),w=c.history!.last10!,first=w.results[0];
 for(const changed of [{...first,date:new Date(NOW+1000).toISOString()},{...first,date:undefined},{...first,value:NaN},{...first,playerId:'wrong'},{...first,gameId:'unproved'},w.results[1]]){
  const bad={...c,history:{...c.history!,last10:{...w,results:[changed,...w.results.slice(1)]}}};assert.equal(scoreVerifiedHistory(bad,NOW),null);
 }
 assert.equal(scoreVerifiedHistory({...c,historyVerified:false},NOW),null);
});
test('integer yardage pushes are neutral and are not counted as historical losses',async()=>{
 const c=await leg(),w=c.history!.last10!,value=w.results[0].value;
 const x={...c,line:value,verification:{...c.verification!,history:{...c.verification!.history,line:value}}};
 assert.equal(scoreVerifiedHistory(x,NOW),null,'All-push history cannot invent decisive outcomes');
 const history={...c.history!,last10:{...w,results:w.results.map((r,i)=>({...r,value:i===0?value:value+10}))}};
 const s=scoreVerifiedHistory({...x,history},NOW)!;assert.equal(s.scored!.historicalHitGames,5);assert.equal(s.history!.last10!.hits,5);assert.equal(s.scored!.conditionalOnNoPush,true);
});
