import type {AvailableQuote} from './fanduelResearch.ts';
import type {PreviewLeg} from '../lib/researchPreview.ts';
import {quoteFreshness} from './fanduelRest.ts';
/** Only a non-actionable display exception, not a new actionable quote eligibility rule. */
export function previewQuoteAllowed(q:AvailableQuote,now:number){
 const f=quoteFreshness(q.meta,q.observedAt,now);
 return Date.parse(q.kickoff)>now&&Date.parse(q.observedAt)<Date.parse(q.kickoff)&&Date.parse(q.meta.asOf??'')<Date.parse(q.kickoff)&&
  f.checks.every(c=>c.passed||['effective_wall_age','meta.source_status'].includes(c.field)||c.field==='meta.source_age_seconds'&&typeof q.meta.sourceAgeSeconds==='number'&&q.meta.sourceAgeSeconds>1800);
}
export function previewLeg(q:AvailableQuote,team:string,opponent:string,probability:number|null,sample:number,now:number,position?:string):PreviewLeg{
 const evaluation=quoteFreshness(q.meta,q.observedAt,now);
 return {quoteId:q.id,gameId:q.eventId,providerEventId:q.providerEventId,player:q.player,market:q.market,side:q.side,line:q.line,odds:q.odds,kickoff:q.kickoff,period:q.market.endsWith('_q1')?'q1':'game',team,opponent,position,capturedAt:q.observedAt,checkedAt:new Date(now).toISOString(),asOf:q.meta.asOf,ageSeconds:evaluation.ageSeconds??(now-Date.parse(q.observedAt))/1000,source:'Cached independent fanduelapi.com snapshot',reasons:evaluation.checks.filter(c=>!c.passed).map(c=>`${c.field}: ${c.reason}`),probability,sample};
}
