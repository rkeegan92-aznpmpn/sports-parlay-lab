export type ProviderId='fanduelapi'|'odds-api'|'propline';
export type Period='FULL'|'Q1';
export type NormalizedQuote={providerMarket?:string;providerPeriod?:string|null;providerPlayerId?:string;providerTeam?:string;lineType?:string;lastSeenAt?:string;marketUpdatedAt?:string;lastChangeAt?:string|null;rejections?:string[];id:string;provider:ProviderId;bookmaker:'fanduel';providerEventId:string;gameId:string;player:string;playerId:string|null;team:string|null;opponent:string|null;kickoff:string;market:string;period:Period;line:number|null;side:string;american:number;observedAt:string;providerAsOf:string|null;reportedDelaySeconds:number|null;status:'current-provider-snapshot'|'stale-or-unverified';provenance:string};
/** Price differences stay visible. Identical contracts use the less favorable price conservatively. */
export function conservativeContracts<T extends {quote:NormalizedQuote}>(input:T[]):{eligible:T[];conflicts:string[]}{
 const groups=new Map<string,T[]>(),conflicts:string[]=[];
 for(const x of input){const q=x.quote;if(q.status!=='current-provider-snapshot')continue;const id=JSON.stringify([q.gameId,q.playerId??q.player.toLowerCase().replace(/[^a-z0-9]/g,''),q.market.replace(/_alternate$/,''),q.period,q.line,q.side]);groups.set(id,[...(groups.get(id)??[]),x]);}
 const decimal=(n:number)=>n>0?1+n/100:1+100/-n;
 const eligible:T[]=[];for(const [id,rows]of groups){if(new Set(rows.map(x=>JSON.stringify([x.quote.team,x.quote.opponent,x.quote.kickoff]))).size>1){conflicts.push('Conflicting verified team/opponent/kickoff evidence: '+id);continue;}rows.sort((a,b)=>decimal(a.quote.american)-decimal(b.quote.american)||a.quote.id.localeCompare(b.quote.id));eligible.push(rows[0]);}
 return {eligible,conflicts};
}
