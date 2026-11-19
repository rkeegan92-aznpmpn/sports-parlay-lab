import type {Candidate,FirstQuarterCandidate} from './types.ts';
import {eligibilityWarnings,validateLegs} from './optimizer.ts';
import {firstQuarterRejectionReasons,invalidQuarterPair} from './firstQuarter.ts';
import {americanToDecimal} from './odds.ts';
export const PREVIEW_LABEL='STALE — RESEARCH PREVIEW ONLY';
export type ComparisonTarget={quoteId:string;gameId:string;providerEventId:string;player:string;market:string;side:string;line:number;odds:number;kickoff:string;period:'game'|'q1'};
export type PreviewLeg=ComparisonTarget&{team:string;opponent:string;position?:string;capturedAt:string;checkedAt:string;asOf:string|null;ageSeconds:number;source:string;reasons:string[];probability:number|null;sample:number};
export type PreviewOption={label:typeof PREVIEW_LABEL;actionable:false;kind:string;legs:PreviewLeg[];limitations:string[]};
export type PreviewResult={label:typeof PREVIEW_LABEL;actionable:false;options:PreviewOption[];missing:string[]};
export const previewLimitations=['Cached prices are not live, API-actionable, or bet-ready. Availability and combined pricing are unverified.','Probabilities, if shown, are uncalibrated estimates conditional on the captured line; current-price EV is unavailable.','Manual comparisons are user observations only; they never upgrade a preview to an API-verified or validated recommendation.'];
const ignoredFull=new Set(['FanDuel odds are stale, future-dated, or have an invalid timestamp.','Independent FanDuel feed provenance is stale, delayed beyond the freshness limit, or unverified.']);
/** Caller must independently establish valid original timestamps and pregame quote identity. Never change evidence. */
export function fullGamePreviews(pool:Candidate[],toLeg:(c:Candidate)=>PreviewLeg,now:number):PreviewResult{
 const options:PreviewOption[]=[],missing:string[]=[];
 for(const kind of ['best','aggr'] as const){
  const rank=(c:Candidate)=>kind==='best'?c.scored!.p:americanToDecimal(c.odds);
  const eligible=pool.filter(c=>!eligibilityWarnings(kind,c,now).some(r=>!ignoredFull.has(r)));
  const by=(p:string,n:number)=>eligible.filter(c=>c.pos===p).sort((a,b)=>rank(b)-rank(a)).slice(0,n);
  const Q=by('QB',4),R=by('RB',8),W=by('WR',8),T=by('TE',4);
  let selected:Candidate[]|undefined,score=-Infinity;
  const first=options[0]?.legs.map(l=>l.quoteId).sort().join('|');
  for(const q of Q)for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++)for(let a=0;a<W.length;a++)for(let b=a+1;b<W.length;b++)for(const t of T){
   const legs=[q,R[i],R[j],W[a],W[b],t];if(validateLegs(legs).length)continue;
   if(legs.map(c=>toLeg(c).quoteId).sort().join('|')===first)continue;
   const value=kind==='best'?legs.reduce((s,c)=>s+Math.log(c.scored!.p),0):legs.reduce((s,c)=>s+Math.log(americanToDecimal(c.odds)),0);
   if(value>score){selected=legs;score=value;}
  }
  if(selected)options.push({label:PREVIEW_LABEL,actionable:false,kind:kind==='best'?'Best Six':'Aggressive Six',legs:selected.map(toLeg),limitations:previewLimitations});
  else missing.push(`${kind==='best'?'Best Six':'Aggressive Six'} preview unavailable: need distinct verified 1 QB, 2 RB, 2 WR, 1 TE with current eligibility/history and at most 3 legs per game. Eligible QB ${Q.length}, RB ${R.length}, WR ${W.length}, TE ${T.length}.`);
 }
 return {label:PREVIEW_LABEL,actionable:false,options,missing};
}
export function quarterPreviews(pool:FirstQuarterCandidate[],toLeg:(c:FirstQuarterCandidate)=>PreviewLeg,now:number):PreviewResult{
 const options:PreviewOption[]=[],missing:string[]=[];
 for(const aggressive of [false,true]){
  const candidates=pool.filter(c=>!firstQuarterRejectionReasons(c,aggressive,now).some(r=>r!=='Q1 odds are stale or future-dated.'));
  // Bound enumeration; keep both sides so distinct valid triples remain possible.
  const rank=(c:FirstQuarterCandidate)=>aggressive?americanToDecimal(c.odds):c.probability;
  const eligible=candidates.sort((a,b)=>rank(b)-rank(a)).slice(0,60);
  let selected:FirstQuarterCandidate[]|undefined,score=-Infinity;
  const first=options[0]?.legs.map(l=>l.quoteId).sort().join('|');
  for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++)for(let k=j+1;k<eligible.length;k++){
   const legs=[eligible[i],eligible[j],eligible[k]];
   if(invalidQuarterPair(legs[0],legs[1])||invalidQuarterPair(legs[0],legs[2])||invalidQuarterPair(legs[1],legs[2]))continue;
   if(legs.map(c=>toLeg(c).quoteId).sort().join('|')===first)continue;
   const value=legs.reduce((s,c)=>s+Math.log(rank(c)),0);if(value>score){selected=legs;score=value;}
  }
  const kind=aggressive?'Aggressive 1Q Triple':'Best 1Q Triple';
  if(selected)options.push({label:PREVIEW_LABEL,actionable:false,kind,legs:selected.map(toLeg),limitations:previewLimitations});
  else missing.push(`${kind} preview unavailable: need 3 distinct, eligible Q1 players${aggressive?' with at least 4 verified Q1 games':''}; have ${new Set(candidates.map(c=>c.espnPlayerId??c.player)).size}. No unavailable picks added.`);
 }
 return {label:PREVIEW_LABEL,actionable:false,options,missing};
}
