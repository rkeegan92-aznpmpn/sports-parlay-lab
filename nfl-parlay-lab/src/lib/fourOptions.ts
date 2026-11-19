import type {Candidate,Ticket,FirstQuarterCandidate,FirstQuarterTicket} from './types.ts';
import {build,validateLegs} from './optimizer.ts';
import {firstQuarterRejectionReasons,invalidQuarterPair} from './firstQuarter.ts';
import {americanToDecimal,decimalToAmerican} from './odds.ts';
export const RISK_OPTIONS=['Safer','Balanced','Aggressive','Long Shot'] as const;
export type RiskOption=typeof RISK_OPTIONS[number];
export type ResearchSlot<T>={label:RiskOption;ticket:T|null;missing:string[];ranking:string};
const name=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export const fullSignature=(t:Ticket)=>t.legs.map(c=>JSON.stringify([c.gameId,c.espnPlayerId??name(c.name),c.market.replace(/_alternate$/,''),c.side,c.line])).sort().join('|');
const qSignature=(t:FirstQuarterTicket)=>t.legs.map(c=>JSON.stringify([c.gameId,c.espnPlayerId??name(c.player),c.market,c.side,c.line])).sort().join('|');
const rankings=['Highest estimated joint probability among eligible combinations.','Probability and theoretical payout balance; distinct selections.','Higher theoretical payout with existing aggressive eligibility.','Highest available theoretical payout; greatest loss risk.'];
export function fourFullOptions(pool:Candidate[],now=Date.now(),testMode=false):ResearchSlot<Ticket>[] {
 const safer=build('best',pool,{now,pregameResearch:true,testMode,top:60}),aggressive=build('aggr',pool,{now,pregameResearch:true,testMode,top:60});
 // Explore a small number of real quote variants so alternate lines are not lost to per-player ranking.
 const variants:Ticket[]=[];for(const ticket of [safer.options[0],aggressive.options[0]])if(ticket)for(const leg of ticket.legs.slice(0,3)){variants.push(...build('aggr',pool.filter(c=>c.id!==leg.id),{now,pregameResearch:true,testMode,top:15}).options);}
 const unique=new Map<string,Ticket>();for(const t of [...safer.options,...aggressive.options,...variants])if(!validateLegs(t.legs).length)unique.set(fullSignature(t),t);
 const used=new Set<string>();let lastPrice=0;
 return RISK_OPTIONS.map((label,i)=>{
  const source=i===0?safer.options:i===1?[...unique.values()]:[...aggressive.options,...variants];
  const available=source.filter(t=>!used.has(fullSignature(t))&&(i<2||t.decimal>lastPrice));
  const score=(t:Ticket)=>i===0?t.jointP:i===1?t.jointP*Math.log1p(t.decimal):t.decimal;
  // Aggressive leaves room for a higher-priced Long Shot when possible.
  available.sort((a,b)=>i===2?a.decimal-b.decimal:score(b)-score(a));
  const ticket=available[0]??null;if(ticket){used.add(fullSignature(ticket));lastPrice=ticket.decimal;}
  return {label,ticket,ranking:rankings[i],missing:ticket?[]:[...new Set([...(i===0?safer.missing:aggressive.missing),i>=2?'No distinct higher-priced eligible combination.':'No additional distinct eligible combination.','Six-pick tickets require 1 QB, 2 RB, 2 WR, 1 TE and at least two games (maximum three picks per game).'])]};
 });
}
export function fourQuarterOptions(pool:FirstQuarterCandidate[],now=Date.now()):ResearchSlot<FirstQuarterTicket>[] {
 // Bounded search; prioritize supported probabilities, keep alternatives rather than inventing thresholds.
 const eligible=pool.filter(c=>!firstQuarterRejectionReasons(c,false,now).length).sort((a,b)=>b.probability-a.probability).slice(0,70),combos:FirstQuarterTicket[]=[];
 for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++)for(let k=j+1;k<eligible.length;k++){
  const legs=[eligible[i],eligible[j],eligible[k]];if(new Set(legs.map(l=>l.espnPlayerId??l.historyPlayerId??name(l.player)+'|'+l.team)).size!==3||invalidQuarterPair(legs[0],legs[1])||invalidQuarterPair(legs[0],legs[2])||invalidQuarterPair(legs[1],legs[2]))continue;
  const decimal=legs.reduce((v,l)=>v*americanToDecimal(l.odds),1);
  combos.push({legs,decimal,american:decimalToAmerican(decimal),probability:legs.reduce((v,l)=>v*l.probability,1),warnings:['Q1 RESEARCH ONLY — uncalibrated estimates; combined price is theoretical, not an accepted sportsbook quote.',...(new Set(legs.map(l=>l.gameId)).size<3?['Same-game acceptance/correlation/pricing are unverified; do not assume these legs can be combined.']:[])]});
 }
 const unique=[...new Map(combos.map(t=>[qSignature(t),t])).values()],used=new Set<string>();let lastPrice=0;
 return RISK_OPTIONS.map((label,i)=>{
  const available=unique.filter(t=>!used.has(qSignature(t))&&(i<2||t.decimal>lastPrice)&&t.legs.every(c=>!firstQuarterRejectionReasons(c,i>=2,now).length));
  const score=(t:FirstQuarterTicket)=>i===0?t.probability:i===1?t.probability*Math.log1p(t.decimal):t.decimal;
  available.sort((a,b)=>i===2?a.decimal-b.decimal:score(b)-score(a));const ticket=available[0]??null;if(ticket){used.add(qSignature(ticket));lastPrice=ticket.decimal;}
  return {label,ticket,ranking:rankings[i],missing:ticket?[]:['No additional distinct three-player Q1 combination satisfies freshness, availability and risk/history requirements. No full-game prices or invented legs substituted.']};
 });
}
