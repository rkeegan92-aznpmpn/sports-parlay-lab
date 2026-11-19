import {eventIdentifier} from './nflEventMatching.ts';
import {PROP_STATS,statToken} from '../lib/propMarkets.ts';
import {quoteFreshness,type Board} from './fanduelRest.ts';
import {providerTimestamp} from './providerTimestamp.ts';
import {matchBoard,matchBoardEvents} from './fanduelResearch.ts';
import type {freeSchedule} from './freeResearch.ts';
export const QUARTER_DATE_ZONE='America/New_York';
export function quarterDate(iso:string){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:QUARTER_DATE_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(providerTimestamp(iso)??NaN));
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');
}
export type QuarterRejection={stage:string;reason:string;player?:string;eventId?:string;gameId?:string;propId?:string;side?:string;count?:number};
const supported=new Set(Object.keys(PROP_STATS));
const text=(x:unknown)=>typeof x==='string'?x.slice(0,150):undefined;
/** Only case/whitespace of documented q1/stat/status tokens; never relabel another period. */
export function normalizeQuarterBoard(board:Board):Board {
 return {...board,props:board.props.map(p=>String(p.record.period).trim().toLowerCase()==='q1'?{...p,record:{...p.record,period:'q1',stat:statToken(p.record.stat),market_status:String(p.record.market_status??'').trim().toLowerCase()}}:p)};
}
export function inspectQuarterBoard(board:Board,games:Awaited<ReturnType<typeof freeSchedule>>,now:number,date='ALL',game='ALL'){
 const futureGames=games.filter(g=>Date.parse(g.commence_time)>now);
 const normalized=normalizeQuarterBoard(board),mapping=matchBoardEvents(normalized,futureGames),matched=matchBoard(normalized,futureGames,now,'q1');
 const canonicalGame=futureGames.some(g=>g.id===game)?game:mapping.events.get(game)?.id??(futureGames.filter(g=>g.espnEventId===game).length===1?futureGames.find(g=>g.espnEventId===game)!.id:game);
 // Explicit individual selection is authoritative; a stale Sunday scope must not exclude a selected Thursday/Monday.
 const selected=futureGames.filter(g=>game!=='ALL'?g.id===canonicalGame:date==='ALL'||quarterDate(g.commence_time)===date);
 const selectedIds=new Set(selected.map(g=>g.id)),quotes=matched.quotes.filter(q=>selectedIds.has(q.eventId));
 const pregameQuote=(q:typeof quotes[number])=>Date.parse(q.kickoff)>now&&Date.parse(q.observedAt)<Date.parse(q.kickoff)&&Date.parse(q.meta.asOf??'')<Date.parse(q.kickoff);
 const active=quotes.filter(q=>q.freshness.eligible&&pregameQuote(q));
 const priceChecks:{propId?:string;player?:string;providerEventId?:string;rawObservedAt:string|null;rawAsOf:string|null;rawSourceObservedAt:string|null;sourceStatus:string;reportedSourceAgeSeconds:number|null;delaySeconds:number|null;providerKickoffUtc:string|null;verifiedKickoffUtc:string|null;evaluation:ReturnType<typeof quoteFreshness>}[]=[];
 const periods:Record<string,number>={},stats:Record<string,number>={},rejections:QuarterRejection[]=[];
 let rawQ1Rows=0,supportedQ1Rows=0,normalizedRows=0;
 for(let i=0;i<board.props.length;i++){
  const raw=board.props[i].record,r=normalized.props[i].record,period=String(raw.period??'(missing)').slice(0,40);periods[period]=(periods[period]??0)+1;
  if(r.period!=='q1')continue;
  rawQ1Rows++;stats[String(r.stat)]=(stats[String(r.stat)]??0)+1;if(raw.period!==r.period||raw.stat!==r.stat||raw.market_status!==r.market_status)normalizedRows++;
  const add=(reason:string,stage='raw-q1')=>rejections.push({stage,reason,player:text(r.player),eventId:text(r.event_id),propId:eventIdentifier(r.id)??undefined});
  if(!supported.has(String(r.stat))){add('Unsupported Q1 stat; no mapping or full-game replacement guessed.');continue;}
  supportedQ1Rows++;
  const eventInfo=mapping.events.get(eventIdentifier(r.event_id)??'');
  const rawObservedAt=typeof r.observed_at==='string'?r.observed_at.slice(0,120):null;
  priceChecks.push({propId:eventIdentifier(r.id)??undefined,player:text(r.player),providerEventId:text(r.event_id),rawObservedAt,rawAsOf:normalized.props[i].meta.timestampInputs?.asOf??normalized.props[i].meta.asOf,rawSourceObservedAt:normalized.props[i].meta.timestampInputs?.observedAt??normalized.props[i].meta.observedAt,sourceStatus:normalized.props[i].meta.sourceStatus,reportedSourceAgeSeconds:normalized.props[i].meta.sourceAgeSeconds,delaySeconds:normalized.props[i].meta.delaySeconds,providerKickoffUtc:providerTimestamp(r.starts_at),verifiedKickoffUtc:eventInfo?.commence_time??null,evaluation:quoteFreshness(normalized.props[i].meta,r.observed_at,now)});
  if(typeof r.player!=='string'||!r.player.trim()){add('Missing provider player identity.','missing-player');continue;}
  if(r.market_status!=='open'){add('Q1 market is not open.');continue;}
  const providerKickoff=providerTimestamp(r.starts_at);if(!providerKickoff){add('Invalid provider kickoff or missing explicit timezone; no UTC time inferred.','kickoff');continue;}if(Date.parse(providerKickoff)<=now){add(`Provider kickoff reached (${providerKickoff}); past cached events cannot be relabeled as a future week.`,'kickoff');continue;}
  const event=mapping.events.get(eventIdentifier(r.event_id)??'');
  if(!event){add('Provider event ID, home/away teams or kickoff could not uniquely match the verified upcoming NFL schedule.','event-match');continue;}
  if(!selectedIds.has(event.id)){add('Verified event excluded by the selected game or NFL Eastern-date filter.','selection-filter');continue;}
  const rowQuotes=quotes.filter(q=>q.id===`${eventIdentifier(r.id)}:Over`||q.id===`${eventIdentifier(r.id)}:Under`||q.id===`${eventIdentifier(r.id)}:AtLeast`);
  if(!rowQuotes.length){const evaluation=priceChecks.at(-1)!.evaluation;if(!evaluation.observedAt)add('row.observed_at: invalid or missing explicit timezone; no UTC instant inferred.','freshness');else add('Invalid/missing quote identity, NFL classification, team, prop kickoff, line, side price or conflicting duplicate.','quote-schema');continue;}
  for(const q of rowQuotes){
   if(!q.freshness.eligible)rejections.push({stage:'freshness',reason:q.freshness.checks.filter(c=>!c.passed).map(c=>`${c.field}: ${c.reason}`).join('; '),propId:q.id,player:q.player,eventId:q.providerEventId,gameId:q.eventId,side:q.side});
   else if(!pregameQuote(q))rejections.push({stage:'kickoff',reason:'Quote observation or snapshot is not strictly before the verified pregame kickoff.',propId:q.id,player:q.player,eventId:q.providerEventId,gameId:q.eventId,side:q.side});
  }
 }
 const missingPeriodRows=board.props.filter(p=>typeof p.record.period!=='string'||!p.record.period.trim()).length;
 const mappedQ1Games=new Set(normalized.props.filter(p=>p.record.period==='q1').flatMap(p=>{const g=mapping.events.get(eventIdentifier(p.record.event_id)??'');return g?[g.id]:[];}));
 const kickoffCounts={past:0,invalid:0,future:0};for(const p of normalized.props.filter(p=>p.record.period==='q1')){const at=providerTimestamp(p.record.starts_at);if(!at)kickoffCounts.invalid++;else if(Date.parse(at)<=now)kickoffCounts.past++;else kickoffCounts.future++;}
 const selectedQ1Rows=normalized.props.filter(p=>p.record.period==='q1'&&selectedIds.has(mapping.events.get(eventIdentifier(p.record.event_id)??'')?.id??'')).length;
 const priceAvailability=!selected.length?'no-selected-upcoming-games':!rawQ1Rows?'no-q1-coverage-in-snapshot':!supportedQ1Rows?'unsupported-q1-stats':!selectedQ1Rows?'no-q1-coverage-for-selected-games':!quotes.length?'invalid-selected-prices':!active.length?'stale-or-non-pregame-prices':'fresh-prices-present';
 const diagnostics={priceAvailability,selectedQ1Rows,providerVerificationBlocked:false,selectedGameId:game==='ALL'?'ALL':canonicalGame,selectedGameLabel:game==='ALL'?null:selected[0]?.label??null,effectiveDate:game==='ALL'?date:selected[0]?quarterDate(selected[0].commence_time):null,kickoffCounts,eventMatching:mapping.checks,endpoint:'/api/v1/props',checkedAt:new Date(now).toISOString(),fetchedAt:Number.isFinite(board.fetchedAt)?new Date(board.fetchedAt).toISOString():null,dateTimeZone:QUARTER_DATE_ZONE,requestedDate:date,requestedGame:game,
  cachedFields:[...new Set(board.props.flatMap(p=>Object.keys(p.record)))].sort(),missingPeriodRows,
  rawRows:board.props.length,periodCounts:periods,rawQ1Rows,supportedQ1Rows,q1StatCounts:stats,normalizedRows,matchedGames:mappedQ1Games.size,
  matchedSidePrices:matched.quotes.length,selectedMatchedGames:[...mappedQ1Games].filter(id=>selectedIds.has(id)).length,selectedSidePrices:quotes.length,freshSidePrices:active.length,timestampFreshSidePrices:quotes.filter(q=>q.freshness.eligible).length,pregameSidePrices:quotes.filter(pregameQuote).length,
  eligibilityEvaluated:false,projectedSideProps:0,availabilityEligibleSideProps:0,eligibleSideProps:0,eligiblePlayers:0,aggressiveEligibleSideProps:0,bestOptions:0,aggressiveOptions:0,
  coverage:rawQ1Rows===0?(missingPeriodRows?'period-field-missing':'no-q1-rows-in-snapshot'):supportedQ1Rows===0?'q1-stats-not-supported':'q1-rows-present',
  events:board.events.slice(0,100).map(p=>{const r=p.record,stamp=Date.parse(providerTimestamp(r.starts_at)??'');return {providerEventId:eventIdentifier(r.id)??eventIdentifier(r.event_id)??undefined,label:text(r.event_name??r.name),kickoffUtc:Number.isFinite(stamp)?new Date(stamp).toISOString():null,verifiedKickoffUtc:mapping.events.get(eventIdentifier(r.id)??eventIdentifier(r.event_id)??'')?.commence_time??null,nflDate:Number.isFinite(stamp)?quarterDate(String(r.starts_at)):null,pregame:Number.isFinite(stamp)&&stamp>now,matchedGameId:mapping.events.get(eventIdentifier(r.id)??eventIdentifier(r.event_id)??'')?.id??null};}),
  priceChecks,rejections};
 return {selected,matched,quotes,active,diagnostics};
}
