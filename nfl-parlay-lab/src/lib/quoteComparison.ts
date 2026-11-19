import type {ComparisonTarget} from './researchPreview.ts';
export type ManualObservation={player:string;gameId:string;market:string;side:string;line:number;odds:number;observedAt:string;available:boolean;comparedInFanDuel:boolean;provenance:'manual-fanduel-app'};
export type ManualComparison={expected:ComparisonTarget;observation:ManualObservation;recordedAt:string;status:string;label:string;reasons:string[]};
export function comparisonKey(t:ComparisonTarget){return JSON.stringify([t.quoteId,t.gameId,t.providerEventId,t.player,t.market,t.side,t.line,t.odds,t.kickoff,t.period]);}
export function compareObservation(expected:ComparisonTarget,o:ManualObservation,now=Date.now()):Omit<ManualComparison,'expected'|'observation'|'recordedAt'>{
 const reasons:string[]=[];
 if(!o.available)return {status:'unavailable',label:'MANUAL CHECK — UNAVAILABLE',reasons:['User reports this prop unavailable in FanDuel.']};
 if(o.provenance!=='manual-fanduel-app'||o.comparedInFanDuel!==true)reasons.push('Explicit FanDuel app comparison is required.');
 for(const field of ['player','gameId','market','side','line','odds'] as const)if(o[field]!==expected[field])reasons.push(`Observed ${field} differs from the captured selection.`);
 if(reasons.length)return {status:'changed',label:'MANUAL CHECK — CHANGED / UNVERIFIED',reasons};
 const age=now-Date.parse(o.observedAt);
 if(!(age>=-60000&&age<=30*60000))return {status:'stale',label:'MANUAL CHECK — STALE / INVALID TIME',reasons:['Recheck in the FanDuel app; manual observations expire after 30 minutes.']};
 if(!(Date.parse(expected.kickoff)>now))return {status:'kickoff-reached',label:'MANUAL CHECK — KICKOFF REACHED',reasons:['This pregame selection is no longer eligible.']};
 return {status:'matched',label:'MANUALLY VERIFIED BY USER',reasons:['Exact captured player/game/market/side/line/price matched a user observation. Not API VERIFIED, not a validated recommendation; sportsbook acceptance is unverified. Recheck immediately before any wager.']};
}
