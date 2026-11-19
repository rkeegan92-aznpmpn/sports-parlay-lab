import {matchNflEvents,nflTeam,eventIdentifier} from './nflEventMatching.ts';
import {PROP_STATS,statToken,propSides} from '../lib/propMarkets.ts';
import {fullGamePreviews} from '../lib/researchPreview.ts';
import {previewQuoteAllowed,previewLeg} from './previewQuotes.ts';
import {inSundayWindow} from '../lib/sundayWindow.ts';
import {providerTimestamp} from './providerTimestamp.ts';
import {scoreVerifiedHistory} from '../lib/model.ts';
import {TEAM_ABBR,loadLive} from '../lib/service.ts';
import type {Candidate} from '../lib/types.ts';
import {build,eligibilityWarnings} from '../lib/optimizer.ts';
import {freeSchedule} from './freeResearch.ts';
import {FanDuelRestError,quoteFreshness,type Board,type FeedMeta} from './fanduelRest.ts';
import {groupCandidateRejections} from '../lib/rejections.ts';

type Games=Awaited<ReturnType<typeof freeSchedule>>;
const canonical=(s:string)=>({LAR:'LA',WSH:'WAS',JAC:'JAX'}[s]??s);
const team=(s:unknown)=>nflTeam(s)??'';
const validText=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>0&&s.length<=150;
const markets=Object.fromEntries(Object.entries(PROP_STATS).map(([stat,d])=>[stat,d.market]));
export type AvailableQuote={id:string;providerEventId:string;eventId:string;player:string;team:string|null;opponent:string|null;teamSource:'provider'|'verified-roster'|'unavailable';kickoff:string;market:string;side:'Over'|'Under'|'AtLeast';line:number;odds:number;observedAt:string;meta:FeedMeta;freshness:ReturnType<typeof quoteFreshness>};
export function matchBoardEvents(board:Board,games:Games){return matchNflEvents(board.events.map(e=>e.record),games);}
export function matchBoard(board:Board,games:Games,now=Date.now(),period:'game'|'q1'='game') {
 const {events,issues}=matchBoardEvents(board,games);
 const quotes:AvailableQuote[]=[];
 const seen=new Map<string,string>(),conflicts=new Set<string>();
 for(const {record:r,meta} of board.props) {
  const propId=eventIdentifier(r.id),event=events.get(eventIdentifier(r.event_id)??''),base=markets[statToken(r.stat)];
  const market=period==='q1'&&!!markets[statToken(r.stat)]?`${base}_q1`:period==='game'?base:undefined;
  if(!event||!market||r.period!==period||r.market_status!=='open'||!validText(r.player)||!propId||
    !['nfl'].includes(String(r.league).toLowerCase())||!['nfl','football'].includes(String(r.sport).toLowerCase())){issues.push('Unsupported, unavailable, non-NFL, non-full-game or unmatched prop excluded.');continue;}
  if(!propSides(r).length||propSides(r).some(s=>s.line<0||s.line>2000)||!validText(r.starts_at)||!providerTimestamp(r.starts_at)||Math.abs(Date.parse(providerTimestamp(r.starts_at)!)-Date.parse(event.commence_time))>60000){issues.push('Invalid line or prop kickoff mismatch excluded.');continue;}
  const own=team(r.team),home=team(event.home_team),away=team(event.away_team);
  if(r.team!=null&&![home,away].includes(own)){issues.push('Prop player team does not match the verified event.');continue;}
  const fresh=quoteFreshness(meta,r.observed_at,now);
  if(!fresh.observedAt){issues.push('Prop observation timestamp missing; no timestamp was invented.');continue;}
  for(const {side,line,odds} of propSides(r)) {
   if(typeof odds!=='number'||!Number.isInteger(odds)||Math.abs(odds)<100||Math.abs(odds)>100000){issues.push('Unavailable or invalid side price excluded.');continue;}
   const quote:AvailableQuote={id:`${propId}:${side}`,providerEventId:String(r.event_id),eventId:event.id,player:r.player.trim(),team:own||null,opponent:own?(own===home?away:home):null,teamSource:own?'provider':'unavailable',kickoff:event.commence_time,market:(side==='AtLeast'||String(r.stat).trim().toLowerCase().endsWith('_alternate'))&&period==='game'?`${market}_alternate`:market,side,line,odds,observedAt:fresh.observedAt,meta,freshness:fresh};
   const signature=JSON.stringify(quote),previous=seen.get(quote.id);
   if(previous&&previous!==signature){conflicts.add(quote.id);issues.push('Conflicting duplicate quote withheld.');continue;}
   if(!previous){seen.set(quote.id,signature);quotes.push(quote);}
  }
 }
 return {quotes:quotes.filter(q=>!conflicts.has(q.id)),issues:[...new Set(issues)],matchedEvents:events.size};
}
export async function fanduelResearch(board:Board,f:typeof fetch=fetch,now=Date.now(),testMode=false,stalePreview=false,sundayOnly=false) {
 if(!board.complete)throw new FanDuelRestError('Incomplete provider board cannot generate research tickets.',409);
 const schedule=await freeSchedule(f,now),games=sundayOnly?schedule.filter(g=>inSundayWindow(g.commence_time,now)):schedule,matched=matchBoard(board,games,now);
 const active=matched.quotes.filter(q=>(stalePreview?previewQuoteAllowed(q,now):q.freshness.eligible)&&Date.parse(q.kickoff)>now);
 const selected=games.filter(g=>active.some(q=>q.eventId===g.id));
 const adapter:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));if(url.hostname!=='api.the-odds-api.com')return f(input,init);
  const id=url.pathname.split('/').at(-2);
  return Response.json({bookmakers:[{key:'fanduel',markets:active.filter(q=>q.eventId===id).map(q=>({key:q.market,last_update:q.observedAt,outcomes:[{name:q.side,description:q.player,point:q.line,price:q.odds}]}))}]});
 };
 const data=await loadLive({key:'fanduel-rest-normalization-no-credential',date:'ALL'},now,adapter,{events:selected,remaining:null});
 const invalidHistory:typeof data.candidates=[];
 const pool:Candidate[]=data.candidates.flatMap(original=>{
  const c=scoreVerifiedHistory(original,now);if(!c){invalidHistory.push(original);return [];}
  const quote=active.find(q=>q.eventId===c.gameId&&q.player===c.name&&q.market===c.market&&q.side===c.side&&q.line===c.line&&q.odds===c.odds&&q.observedAt===c.oddsAt&&(q.team===canonical(c.team)||q.team===null&&c.rosterVerified===true));
  if(!quote)return [];
  return [{...c,id:`fanduelapi:${quote.id}`,oddsProvider:'fanduelapi' as const,providerPropId:quote.id,providerEventId:quote.providerEventId,providerAsOf:quote.meta.asOf!,providerDelaySeconds:quote.meta.delaySeconds!,providerSourceStatus:quote.meta.sourceStatus,
   resultGameId:c.gameId,espnEventId:games.find(g=>g.id===c.gameId)?.espnEventId}];
 });
 const quotes=matched.quotes.map(q=>{if(q.team!==null)return q;const verified=pool.filter(c=>c.id===`fanduelapi:${q.id}`&&c.rosterVerified===true);return verified.length===1?{...q,team:canonical(verified[0].team),opponent:canonical(verified[0].opp),teamSource:'verified-roster' as const}:q;});
 const preview=stalePreview?fullGamePreviews(pool,c=>previewLeg(active.find(q=>`fanduelapi:${q.id}`===c.id)!,c.team,c.opp,c.scored?.p??null,c.sample,now,c.pos),now):null;
 const first=build('aggr',stalePreview?[]:pool,{now,pregameResearch:true,testMode}),signature=(t:{legs:Candidate[]})=>t.legs.map(l=>JSON.stringify([l.historySource,l.historyPlayerId,l.gameId,l.market.replace(/_alternate$/,''),l.side,l.line])).sort().join('|');
 const one=first.options[0];
 const second=one?build('aggr',stalePreview?[]:pool,{now,pregameResearch:true,testMode,avoid:new Set(one.legs.map(l=>l.id))}):first;
 const two=one?second.options.find(t=>signature(t)!==signature(one)):undefined;
 const tickets=[one,two].filter((t):t is NonNullable<typeof t>=>!!t);
 return {...matched,quotes,tickets,preview,analysisCandidates:pool,notes:data.notes,pipelineRejections:data.pipelineRejections??[],rejected:groupCandidateRejections([...invalidHistory.map(candidate=>({candidate,reasons:['Historical outcome dates, identities or unique game records could not be verified for this exact market/line.']})),...pool.flatMap(candidate=>{const reasons=eligibilityWarnings('aggr',candidate,now);return reasons.length?[{candidate,reasons}]:[];})]),
  missing:preview?preview.missing:!one?first.missing:!two?['No second distinct eligible aggressive combination is available. Add verified alternative markets; no replacement picks were invented.']:[],
  provenance:'Independent fanduelapi.com data service. Free tier may be delayed five minutes. Research estimates are unvalidated; no guaranteed wins or wagers. Combined odds are theoretical products, not a FanDuel parlay quote.',validationGatePassed:false};
}
