import {TEAM_ABBR} from '../lib/service.ts';
import {providerTimestamp} from './providerTimestamp.ts';
export type NflEvent={id:string;home_team:string;away_team:string;commence_time:string;espnEventId?:string};
const token=(s:string)=>s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const canonical=(s:string)=>({LAR:'LA',WSH:'WAS',JAC:'JAX'} as Record<string,string>)[s]??s;
const aliases=new Map<string,Set<string>>();
function alias(name:string,abbr:string){const k=token(name),set=aliases.get(k)??new Set<string>();set.add(canonical(abbr));aliases.set(k,set);}
for(const [name,abbr]of Object.entries(TEAM_ABBR)){
 alias(name,abbr);alias(abbr,abbr);
 const words=name.split(' '),nickname=words.at(-1)!;alias(nickname,abbr);alias(words.slice(0,-1).join(' '),abbr);alias(abbr+' '+nickname,abbr);for(const [alternate,current]of Object.entries({LAR:'LA',WSH:'WAS',JAC:'JAX'}))if(canonical(current)===canonical(abbr))alias(alternate+' '+nickname,abbr);
 alias(name.replace('Los Angeles','LA').replace('New York','NY'),abbr);
}
for(const [name,abbr]of Object.entries({LAR:'LA',WSH:'WAS',JAC:'JAX'}))alias(name,abbr);
export function nflTeam(value:unknown):string|null{if(typeof value!=='string')return null;const values=aliases.get(token(value));return values?.size===1?[...values][0]:null;}
export function eventIdentifier(value:unknown):string|null{
 if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?String(value):null;
 return typeof value==='string'&&value.trim()&&value.length<=150?value.trim():null;
}
export function providerEventTeams(row:Record<string,unknown>){
 const name=typeof row.event_name==='string'?row.event_name:typeof row.name==='string'?row.name:'';
 const parts=name.split(/\s*@\s*|\s+at\s+/i);
 const present=(v:unknown)=>typeof v==='string'&&v.trim()?v:undefined;
 const homeRaw=present(row.home_team)??(parts.length===2?parts[1]:undefined),awayRaw=present(row.away_team)??(parts.length===2?parts[0]:undefined);
 return {home:nflTeam(homeRaw),away:nflTeam(awayRaw),homeRaw,awayRaw};
}
export function matchNflEvents<T extends NflEvent>(records:Record<string,unknown>[],games:T[]){
 const events=new Map<string,T>(),badEvents=new Set<string>(),signatures=new Map<string,string>(),issues:string[]=[];
 const checks:{providerEventId:string|null;providerKickoffUtc:string|null;home:string|null;away:string|null;matchedGameId:string|null;verifiedKickoffUtc:string|null;method:string|null;reason:string}[]=[];
 for(const r of records){
  const id=eventIdentifier(r.id)??eventIdentifier(r.event_id),starts=providerTimestamp(r.starts_at),teams=providerEventTeams(r);
  const record={providerEventId:id,providerKickoffUtc:starts,home:teams.home,away:teams.away,matchedGameId:null as string|null,verifiedKickoffUtc:null as string|null,method:null as string|null,reason:''};checks.push(record);
  const reject=(reason:string)=>{record.reason=reason;issues.push(reason);};
  if(!id){reject('Provider event identifier missing or invalid.');continue;}
  const other=eventIdentifier(r.event_id);
  if(eventIdentifier(r.id)&&other&&id!==other){badEvents.add(id);badEvents.add(other);events.delete(id);events.delete(other);reject('Conflicting provider event identifiers withheld.');continue;}
  if(badEvents.has(id)){reject('Conflicting duplicate provider event ID withheld.');continue;}
  const signature=JSON.stringify([teams.home??teams.homeRaw,teams.away??teams.awayRaw,starts,r.nfl_game_id??null,r.espn_event_id??null]);
  if(signatures.has(id)&&signatures.get(id)!==signature){badEvents.add(id);events.delete(id);reject('Conflicting duplicate provider event identity or kickoff withheld.');continue;}signatures.set(id,signature);
  if(!starts){reject('Provider kickoff is invalid or missing an explicit timezone; no instant inferred.');continue;}
  const nflId=eventIdentifier(r.nfl_game_id)??(/^\d{4}_\d{1,2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(id)?id:null);
  const espnId=eventIdentifier(r.espn_event_id)??(/^espn:\d+$/.test(id)?id.slice(5):null);
  const idMatches=nflId?games.filter(g=>g.id===nflId):espnId?games.filter(g=>g.espnEventId===espnId):null;
  if(nflId&&espnId){const also=games.filter(g=>g.espnEventId===espnId);if(idMatches?.length!==1||also.length!==1||also[0].id!==idMatches[0].id){reject('Explicit NFL and ESPN event IDs conflict or are ambiguous.');continue;}}
  if(idMatches&&idMatches.length!==1){reject('Explicit namespaced event ID did not uniquely match the verified NFL schedule.');continue;}
  const candidates=idMatches??games.filter(g=>teams.home!==null&&teams.away!==null&&nflTeam(g.home_team)===teams.home&&nflTeam(g.away_team)===teams.away);
  const matched=candidates.filter(g=>
   (!teams.homeRaw||teams.home!==null&&nflTeam(g.home_team)===teams.home)&&(!teams.awayRaw||teams.away!==null&&nflTeam(g.away_team)===teams.away)&&
   Math.abs(Date.parse(g.commence_time)-Date.parse(starts))<=60000);
  if(matched.length!==1){reject('Provider teams and kickoff did not uniquely match verified NFL schedule; no next-week or timezone shift guessed.');continue;}
  events.set(id,matched[0]);record.matchedGameId=matched[0].id;record.verifiedKickoffUtc=matched[0].commence_time;record.method=nflId?'explicit-nfl-id':espnId?'explicit-espn-id':'normalized-teams-and-kickoff';record.reason='Matched with verified UTC kickoff (existing 60-second maximum tolerance).';
 }
 for(const check of checks)if(check.providerEventId&&badEvents.has(check.providerEventId)){check.matchedGameId=null;check.verifiedKickoffUtc=null;check.method=null;check.reason='Conflicting provider event ID withheld.';}
 return {events,issues:[...new Set(issues)],checks};
}
