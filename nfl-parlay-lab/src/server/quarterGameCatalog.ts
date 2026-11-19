import {freeSchedule} from './freeResearch.ts';
import {matchBoardEvents} from './fanduelResearch.ts';
import {eventIdentifier} from './nflEventMatching.ts';
import type {Board} from './fanduelRest.ts';
/** Free schedule catalog is independent of odds coverage, freshness and provider failure state. */
export async function quarterGameCatalog(board:Board|null,f:typeof fetch=fetch,now=Date.now()){
 const schedule=await freeSchedule(f,now);
 // Cache coverage is optional: malformed/legacy odds data must never hide a good free schedule.
 const usable=board&&Array.isArray(board.events)&&Array.isArray(board.props)?{...board,events:board.events.filter(p=>p?.record&&typeof p.record==='object'),props:board.props.filter(p=>p?.record&&typeof p.record==='object')}:null;
 const mapped=usable?matchBoardEvents(usable,schedule):null;
 return {catalogSource:'Verified free NFL schedule; no odds-provider request',catalogCheckedAt:new Date(now).toISOString(),windowDays:21,
  games:schedule.map(g=>({id:g.id,label:g.label,kickoff:g.commence_time,espnEventId:g.espnEventId,nflDate:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(g.commence_time)),cachedQ1Rows:usable?usable.props.filter(p=>String(p.record.period).trim().toLowerCase()==='q1'&&mapped?.events.get(eventIdentifier(p.record.event_id)??'')?.id===g.id).length:null}))};
}
