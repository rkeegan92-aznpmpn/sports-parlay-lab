import type {Period} from '../lib/normalizedOdds.ts';
import {PROPLINE_MARKETS} from './proplineMarkets.ts';
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const label=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_ -]{1,90}$/.test(v)?v:'(missing/invalid)';
export function propLineRawCounts(input:unknown,period:Period){
 const event=object(input),books=Array.isArray(event.bookmakers)?event.bookmakers:[];
 const counts={bookmakers:books.length,fanDuelBooks:0,fanDuelMarkets:0,q1Markets:0,selectedPeriodMarkets:0,playerMarkets:0,supportedPlayerMarkets:0,fanDuelOutcomes:0,supportedPlayerOutcomes:0};
 const periodCounts:Record<string,number>={},marketKeys:Record<string,number>={},bookmakerKeys:Record<string,number>={};
 for(const b of books){const book=object(b);const bookKey=label(book.key);bookmakerKeys[bookKey]=(bookmakerKeys[bookKey]??0)+1;if(book.key!=='fanduel')continue;counts.fanDuelBooks++;
  for(const item of Array.isArray(book.markets)?book.markets:[]){const m=object(item),key=label(m.key),p=m.period===null?'FULL':label(m.period),outcomes=Array.isArray(m.outcomes)?m.outcomes.length:0;counts.fanDuelMarkets++;counts.fanDuelOutcomes+=outcomes;periodCounts[p]=(periodCounts[p]??0)+1;marketKeys[key]=(marketKeys[key]??0)+1;
   if(m.period==='q1')counts.q1Markets++;
   if(period==='Q1'?m.period!=='q1':m.period!==null)continue;counts.selectedPeriodMarkets++;
   if(typeof m.key==='string'&&m.key.startsWith('player_'))counts.playerMarkets++;
   if(PROPLINE_MARKETS.includes(key)){counts.supportedPlayerMarkets++;counts.supportedPlayerOutcomes+=outcomes;}
  }
 }
 return {counts,periodCounts,marketKeys,bookmakerKeys};
}
export type PropLineParserDiagnostics=ReturnType<typeof propLineRawCounts>&{rejectedByReason:Record<string,number>;parsedSidePrices:number};
export type PropLineCollectionDiagnostics={version:1;request:{scope:string;period:Period;endpoint:'bulk'|'selected';bookmakers:'fanduel';marketKeys:string[];periodParameter:'q1'|null;maxAgeSeconds:1800};response:{shape:'event-array'|'event-object';events:number};eventMatching:{providerEventId:string|null;matchedGameId:string|null;reason:string}[];events:{providerEventId:string|null;verifiedGameId:string|null;parser:PropLineParserDiagnostics}[]};
export function summarizePropLineEvidence(snapshot:{at:number;period:Period;selectedGame:string;rows:Record<string,unknown[]>;coverage:Record<string,string[]>;rejections:string[];diagnostics?:PropLineCollectionDiagnostics}|null,requestedGame:string){
 if(!snapshot)return {retainedMarketIdentifiers:[] as string[],retainedRejectionReasons:[] as string[],status:'no-cached-snapshot',rawEvidenceAvailable:false,cachedAt:null,requestedGame,cacheScope:null,borrowedAllCache:false,parsedSidePrices:0,rawCounts:null,parserRejections:{},request:null,response:null,eventMatching:[],events:[],missing:['No cached PropLine snapshot for this mode/selection. No provider request was made.']};
 const d=snapshot.diagnostics,parsedSidePrices=Object.values(snapshot.rows).reduce((n,rows)=>n+rows.length,0);
 const rawCounts=d?{events:d.response.events,matchedEvents:d.eventMatching.filter(e=>e.matchedGameId).length,fanDuelBooks:0,fanDuelMarkets:0,q1Markets:0,selectedPeriodMarkets:0,supportedPlayerMarkets:0,supportedPlayerOutcomes:0}:null,parserRejections:Record<string,number>={};
 if(d&&rawCounts)for(const e of d.events){for(const k of ['fanDuelBooks','fanDuelMarkets','q1Markets','selectedPeriodMarkets','supportedPlayerMarkets','supportedPlayerOutcomes'] as const)rawCounts[k]+=e.parser.counts[k];for(const [reason,n]of Object.entries(e.parser.rejectedByReason))parserRejections[reason]=(parserRejections[reason]??0)+n;}
 const missing:string[]=[];let status='parsed-prices-present';
 if(!d){status='legacy-raw-evidence-unavailable';missing.push('This older cache retained parsed rows and unique reasons, not raw response counts. Zero parsed rows cannot establish an empty provider response. No paid re-fetch was made.');}
 else if(!d.response.events){status='provider-returned-no-events-under-filters';missing.push('Provider returned no events under the recorded bookmaker/market/period/max_age request filters. This does not prove permanent lack of Q1 coverage.');}
 else if(!rawCounts?.fanDuelBooks){status='no-fanduel-bookmaker-returned';missing.push('Response events had no FanDuel bookmaker block. Other books were not substituted.');}
 else if(!rawCounts.selectedPeriodMarkets){status='no-explicit-selected-period-markets';missing.push('No markets explicitly match the requested period. Full-game or unspecified periods were not substituted.');}
 else if(!rawCounts.supportedPlayerMarkets){status='no-supported-period-player-markets';missing.push('Only game lines, totals or unsupported player identifiers were returned for this period.');}
 else if(!rawCounts.matchedEvents){status='events-failed-verified-schedule-matching';missing.push('Provider returned period markets but no event matched verified NFL IDs/teams/UTC kickoff.');}
 else if(!parsedSidePrices){status='all-returned-player-prices-rejected';missing.push('Supported player markets were present but all prices failed parser checks. Inspect rejection counts; this is not an empty-provider claim.');}
 const retainedMarketIdentifiers=[...new Set(Object.values(snapshot.coverage).flat().filter((v):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$/.test(v)))];
 const retainedRejectionReasons=snapshot.rejections.filter((r):r is string=>typeof r==='string'&&r.length<=300).slice(0,100);
 return {retainedMarketIdentifiers,retainedRejectionReasons,status,rawEvidenceAvailable:!!d,cachedAt:Number.isFinite(snapshot.at)?new Date(snapshot.at).toISOString():null,requestedGame,cacheScope:snapshot.selectedGame,borrowedAllCache:requestedGame!=='ALL'&&snapshot.selectedGame==='ALL',parsedSidePrices,rawCounts,parserRejections,request:d?.request??null,response:d?.response??null,eventMatching:d?.eventMatching??[],events:d?.events??[],missing};
}
