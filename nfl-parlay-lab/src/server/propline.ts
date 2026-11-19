// Independent server-only adapter. Official contract: https://api.prop-line.com/openapi.json
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {freeSchedule} from './freeResearch.ts';
import {matchNflEvents,eventIdentifier,nflTeam} from './nflEventMatching.ts';
import {providerTimestamp} from './providerTimestamp.ts';
import {SUPPORTED_MARKETS,OddsApiError,type ApiEvent,type PropRow,type FirstQuarterPropRow} from '../lib/providers/oddsApi.ts';
import type {Period} from '../lib/normalizedOdds.ts';
export const PROPLINE_BASE='https://api.prop-line.com/v1';
export {PROPLINE_MARKETS} from './proplineMarkets.ts';
import {PROPLINE_MARKETS} from './proplineMarkets.ts';
import {propLineRawCounts,summarizePropLineEvidence,type PropLineCollectionDiagnostics,type PropLineParserDiagnostics} from './proplineDiagnostics.ts';
export type PropLineRow=(PropRow|FirstQuarterPropRow)&{providerMarket?:string;providerPeriod?:string|null;providerPlayerId?:string;providerTeam?:string;lineType?:string;lastSeenAt?:string;marketUpdatedAt?:string;lastChangeAt?:string|null};
export type PropLineSnapshot={at:number;events:ApiEvent[];rows:Record<string,PropLineRow[]>;coverage:Record<string,string[]>;selectedGame:string;period:Period;rejections:string[];diagnostics?:PropLineCollectionDiagnostics};
type Db=Database.Database;
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'&&v.trim()&&v.length<=200?v.trim():null;
const read=<T>(db:Db,key:string):T|null=>{const r=db.prepare('SELECT value FROM cache WHERE key=?').get(key) as {value:string}|undefined;try{return r?JSON.parse(r.value):null;}catch{return null;}};
const put=(db:Db,key:string,value:unknown,at:number)=>db.prepare('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)').run(key,JSON.stringify(value),at);
const id=(key:string)=>createHash('sha256').update(key).digest('hex').slice(0,24);
const cacheKey=(key:string,p:Period,game:string)=>`propline:v1:snapshot:${id(key)}:${p}:${game}`;
const pauseKey=(key:string)=>`propline:cooldown:${id(key)}`;
const failureKey=(key:string,p:Period)=>`propline:failure:${id(key)}:${p}`;
const codes=['missing_api_key','invalid_api_key','upgrade_required','burst_limit_exceeded','daily_limit_exceeded','unknown_sport','event_not_found'];
export type Usage={limit:number|null;used:number|null;remaining:number|null;resetAt:number|null;observedAt:number};
const int=(v:string|null)=>v!==null&&/^\d+$/.test(v)&&Number.isSafeInteger(Number(v))?Number(v):null;
function usage(headers:Headers,now:number):Usage{const reset=int(headers.get('x-daily-reset'));return {limit:int(headers.get('x-daily-limit')),used:int(headers.get('x-daily-used')),remaining:int(headers.get('x-daily-remaining')),resetAt:reset!==null&&reset*1000<=8640000000000000?reset*1000:null,observedAt:now};}
export class PropLineError extends OddsApiError{retryAt:number|null;constructor(message:string,status:number,code:string|undefined=undefined,retryAt:number|null=null){super(message,status);this.code=code;this.retryAt=retryAt;}}
const open=(r:Record<string,unknown>)=>r.redacted!==true&&r.live!==true&&r.suspended!==true&&r.suspended_at==null&&r.active!==false&&[r.status,r.market_status].every(v=>v==null||typeof v==='string'&&['open','active'].includes(v.toLowerCase()));
export function parsePropLineEvent(input:unknown,period:Period,now=Date.now()){
 const event=obj(input),rows:PropLineRow[]=[],coverage=new Set<string>(),rejections:string[]=[];
 const diagnostics:PropLineParserDiagnostics={...propLineRawCounts(input,period),rejectedByReason:{},parsedSidePrices:0};
 const reject=(reason:string)=>{rejections.push(reason);diagnostics.rejectedByReason[reason]=(diagnostics.rejectedByReason[reason]??0)+1;};
 if(event.sport_key!=='football_nfl'||!open(event)||!providerTimestamp(event.commence_time)||Date.parse(providerTimestamp(event.commence_time)!)<=now){reject('Not an open pregame NFL event or response is redacted.');return {rows,coverage:[],rejections,diagnostics};}
 for(const b of Array.isArray(event.bookmakers)?event.bookmakers:[]){const book=obj(b);if(book.key!=='fanduel'){reject('Other bookmaker excluded; FanDuel was requested.');continue;}if(!open(book)){reject('FanDuel bookmaker suspended, closed or redacted.');continue;}
  for(const item of Array.isArray(book.markets)?book.markets:[]){const m=obj(item),key=text(m.key);if(!key)continue;coverage.add(`${key}:${m.period??'FULL'}`);
   if(!open(m)){reject('Suspended, closed or redacted market.');continue;}
   if(period==='Q1'?m.period!=='q1':m.period!==null){reject('Period missing or mismatched; FULL and Q1 never substitute.');continue;}
   // PropLine uses reception_tds; existing model names the identical receiving-TD statistic differently.
   const base=key==='player_reception_tds'?'player_receiving_tds':key;
   if(!PROPLINE_MARKETS.includes(key)||!SUPPORTED_MARKETS.includes(base)){reject('Unsupported player market; no statistic mapping guessed.');continue;}
   const marketAt=providerTimestamp(m.last_update);if(!marketAt){reject('Missing explicit-zone market timestamp.');continue;}
   for(const item of Array.isArray(m.outcomes)?m.outcomes:[]){const o=obj(item),player=text(o.description),seen=providerTimestamp(o.last_seen_at),changed=providerTimestamp(o.last_change_at),price=o.price;
    if(!open(o)||!player||typeof price!=='number'||!Number.isInteger(price)||Math.abs(price)<100||Math.abs(price)>100000){reject('Missing player, unavailable/redacted price or suspended outcome.');continue;}
    // A last-change time cannot prove that a selection remains offered. Require last delivery to equal market delivery.
    if(!seen||seen!==marketAt||now-Date.parse(seen)<-60000||now-Date.parse(seen)>1800000||o.last_change_at!=null&&!changed||changed!==null&&Date.parse(changed)>Date.parse(seen)+60000){reject('Stale, future, missing or withdrawn selection timestamp.');continue;}
    if((o.line_type??m.line_type)==='milestone'&&['Over','Under'].includes(String(o.name))){reject('Milestone Over/Under threshold semantics unverified; no N+ conversion guessed.');continue;}
    let side:PropRow['side']|null=null,line:number|null=null;
    if(['Over','Under'].includes(String(o.name))&&typeof o.point==='number'&&Number.isFinite(o.point)&&o.point>=0){side=o.name as 'Over'|'Under';line=o.point;}
    else if(o.name==='Yes'&&base==='player_anytime_td'){side='Yes';}
    else {const plus=typeof o.name==='string'?/^(\d+(?:\.\d+)?)\+\s*(?:[A-Za-z].*)?$/.exec(o.name.trim()):null;if(plus&&(o.point==null||o.point===Number(plus[1]))){side='AtLeast';line=Number(plus[1]);}}
    if(line!==null&&(!Number.isFinite(line)||line<0||line>2000)){reject('Invalid or out-of-range actual line.');continue;}
    if(!side||base==='player_anytime_td'&&side!=='Yes'||period==='Q1'&&side==='Yes'){reject('Unsupported side/threshold; no implied threshold invented.');continue;}
    if(o.player_id!=null&&(!text(o.player_id)||!/^espn:\d+$/.test(String(o.player_id)))){reject('Unverified NFL player-ID namespace.');continue;}
    if(o.player_team!=null&&(!nflTeam(o.player_team)||![nflTeam(event.home_team),nflTeam(event.away_team)].includes(nflTeam(o.player_team)))){reject('Provider player team unrecognized.');continue;}
    const alternate=['alternate','milestone'].includes(String(o.line_type??m.line_type))||side==='AtLeast';
    const market=period==='Q1'?base+'_q1':alternate&&base!=='player_anytime_td'?base+'_alternate':base;
    if(period==='FULL'&&!SUPPORTED_MARKETS.includes(market)){reject('Unsupported alternate model.');continue;}
    const common={providerMarket:key,providerPeriod:m.period as string|null,market,side,line,odds:price,updatedAt:seen,providerPlayerId:text(o.player_id)??undefined,providerTeam:text(o.player_team)??undefined,lineType:text(o.line_type??m.line_type)??'unreported',lastSeenAt:seen,marketUpdatedAt:marketAt,lastChangeAt:changed};
    rows.push(period==='FULL'?{...common,player} as PropLineRow:{...common,participant:player} as PropLineRow);
   }
  }
 }
 // If identical contracts disagree, withhold them instead of allowing provider row order to choose a price.
 const groups=new Map<string,PropLineRow[]>();for(const row of rows){const k=JSON.stringify(['player'in row?row.player:row.participant,row.market,row.side,row.line]);groups.set(k,[...(groups.get(k)??[]),row]);}
 const unique:PropLineRow[]=[];for(const group of groups.values()){if(new Set(group.map(r=>JSON.stringify(r))).size===1)unique.push(group[0]);else reject('Conflicting duplicate player contract withheld.');}
 diagnostics.parsedSidePrices=unique.length;
 return {diagnostics,rows:unique,coverage:[...coverage].sort(),rejections:[...new Set(rejections)]};
}
export function propLineStatus(db:Db,key:string,now=Date.now()){
 const pause=key?read<{until:number;status:number;code?:string}>(db,pauseKey(key)):null,failures=key?(['FULL','Q1'] as const).flatMap(period=>{const v=read<{at:number;status:number;code?:string}>(db,failureKey(key,period));return v?[{period,...v}]:[];}):[];
 return {id:'propline',configured:!!key,paused:!!pause&&pause.until>now,retryAt:pause?.until??null,httpStatus:pause?.status??failures.sort((a,b)=>b.at-a.at)[0]?.status??null,code:pause?.code??failures[0]?.code??null,failures,usage:key?read<Usage>(db,`propline:usage:${id(key)}`):null,automaticRetry:false,maxRequestsPerRefresh:2,cacheTtlSeconds:300,message:'PropLine independent snapshot, FanDuel bookmaker only. FULL vs period=q1 is explicit; free-key/account coverage unverified. Refresh only on request; no paid analytics or SGP calls.'};
}
export function propLineEvidence(db:Db,key:string,p:Period,game:string,now=Date.now()){
 const snapshot=key?(read<PropLineSnapshot>(db,cacheKey(key,p,game))??(game!=='ALL'?read<PropLineSnapshot>(db,cacheKey(key,p,'ALL')):null)):null;
 const failure=key?read<{at:number}>(db,failureKey(key,p)):null,access=propLineStatus(db,key,now);
 const blocked=!!snapshot&&(!!failure&&failure.at>=snapshot.at||access.paused);
 try{return {...summarizePropLineEvidence(snapshot,game),providerVerificationBlocked:blocked,providerAccess:access};}catch{return {...summarizePropLineEvidence(null,game),status:'cached-diagnostics-unreadable',providerVerificationBlocked:true,providerAccess:access};}
}
export function cachedPropLine(db:Db,key:string,p:Period,game:string,now=Date.now()){
 if(!key)throw new PropLineError('PROPLINE_API_KEY is not configured in the server environment.',401);
 const snapshot=read<PropLineSnapshot>(db,cacheKey(key,p,game))??(game!=='ALL'?read<PropLineSnapshot>(db,cacheKey(key,p,'ALL')):null);
 if(!snapshot)throw new PropLineError('No PropLine cached snapshot for this mode/selection. Refresh explicitly; no request made.',409);
 const failure=read<{at:number}>(db,failureKey(key,p)),pause=read<{until:number}>(db,pauseKey(key));
 if(failure&&failure.at>=snapshot.at||pause&&pause.until>now)throw new PropLineError('PropLine failure/pause makes its cached prices unverified; other providers remain independent.',409);
 return snapshot;
}
const inFlight=new WeakMap<Db,Map<string,Promise<PropLineSnapshot>>>();
export async function refreshPropLine(db:Db,key:string,p:Period,game:string,free:typeof fetch=fetch,request:typeof fetch=fetch,now=Date.now()):Promise<PropLineSnapshot>{
 if(!key.trim())throw new PropLineError('PROPLINE_API_KEY is not configured in the server environment.',401);
 const pause=read<{until:number;status:number;code?:string}>(db,pauseKey(key));if(pause&&pause.until>now)throw new PropLineError('PropLine requests paused until '+new Date(pause.until).toISOString()+'. No request made.',pause.status,pause.code,pause.until);
 try{const old=cachedPropLine(db,key,p,game,now);if(old.at<=now&&now-old.at<300000){
  let usable=true;
  if(p==='Q1'&&game!=='ALL'&&old.selectedGame==='ALL'){
   usable=false;if(old.events.length){const verified=(await freeSchedule(free,now)).filter(g=>g.id===game),mapped=matchNflEvents(old.events.map(e=>({id:e.id,home_team:e.home_team,away_team:e.away_team,starts_at:e.commence_time})),verified);usable=[...mapped.events.keys()].some(id=>old.rows[id]?.some(row=>!!providerTimestamp(row.updatedAt)&&now-Date.parse(row.updatedAt)>=-60000&&now-Date.parse(row.updatedAt)<=1800000&&Date.parse(row.updatedAt)<Date.parse(mapped.events.get(id)!.commence_time)));}
  }
  if(usable)return old;
 }}catch{/* Explicit request may recover an expired/failed cache; pause already enforced. */}
 let pending=inFlight.get(db);if(!pending){pending=new Map();inFlight.set(db,pending);}const name=cacheKey(key,p,game);if(pending.has(name))return pending.get(name)!;
 let attempted=false,calls=0;
 const get=async(path:string,params:Record<string,string>)=>{
  if(++calls>2)throw new PropLineError('PropLine two-request safety budget reached; no retry.',503);
  const url=new URL(PROPLINE_BASE+path);url.search=new URLSearchParams(params).toString();attempted=true;let r:Response;
  try{r=await request(url.toString(),{headers:{'X-API-Key':key},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new PropLineError('PropLine request failed or timed out. No replacement prices created.',503);}
  const quota=usage(r.headers,now);put(db,`propline:usage:${id(key)}`,quota,now);
  if(!r.ok){const body=obj(await r.json().catch(()=>null)),detail=obj(body.detail),code=codes.includes(String(detail.error))?String(detail.error):undefined;
   const raw=r.headers.get('retry-after'),headerSeconds=int(raw),bodySeconds=typeof detail.retry_after_seconds==='number'&&Number.isSafeInteger(detail.retry_after_seconds)&&detail.retry_after_seconds>=0?detail.retry_after_seconds:null;
   const httpDate=raw&&/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)&&Number.isFinite(Date.parse(raw))?Date.parse(raw):NaN;
   const deadlines=[headerSeconds===null?NaN:now+headerSeconds*1000,bodySeconds===null?NaN:now+bodySeconds*1000,httpDate,...(code==='daily_limit_exceeded'?[quota.resetAt??NaN]:[])].filter(t=>Number.isFinite(t)&&t<=8640000000000000);
   const retryAt=[401,403,429,503].includes(r.status)?Math.max(now+(r.status===401||r.status===403?60000:1000),...(deadlines.length?deadlines:[now+(code==='daily_limit_exceeded'?86400000:60000)])):null;
   throw new PropLineError(r.status===401?'PropLine authentication rejected. Check the server-only key privately and restart.':r.status===403?'PropLine endpoint/plan access denied; no upgrade or payment performed.':r.status===429?code==='daily_limit_exceeded'?'PropLine daily quota exhausted. Wait for its UTC reset.':'PropLine burst/rate limit reached; honor retry time.':r.status===404?'PropLine event/sport missing or merged. No automatic retry with guessed IDs.':`PropLine HTTP ${r.status}; no substitute prices.`,r.status,code,retryAt);
  }
  const body=await r.json().catch(()=>{throw new PropLineError('PropLine returned invalid JSON.',503);});if(JSON.stringify(body).includes(key))throw new PropLineError('Unsafe PropLine response withheld.',503);return body as unknown;
 };
 const work=(async()=>{try{
  const games=(await freeSchedule(free,now)).filter(g=>game==='ALL'||g.id===game);if(!games.length)throw new PropLineError('No verified upcoming NFL game matches selection. No provider request made.',409);
  const params:Record<string,string>={bookmakers:'fanduel',markets:PROPLINE_MARKETS.join(','),max_age:'1800',...(p==='Q1'?{period:'q1'}:{})};let bodies:unknown[];
  if(game==='ALL'){const data=await get('/sports/football_nfl/odds',params);if(!Array.isArray(data))throw new PropLineError('Malformed PropLine bulk response; expected event array, no pagination guessed.',503);bodies=data;}
  else{
   const data=await get('/sports/football_nfl/events',{});if(!Array.isArray(data))throw new PropLineError('Malformed PropLine events response.',503);
   const matches=matchNflEvents(data.map(v=>{const e=obj(v);return {id:e.id,home_team:e.home_team,away_team:e.away_team,starts_at:e.commence_time,espn_event_id:e.espn_event_id};}),games),ids=[...matches.events.keys()].filter(n=>/^\d+$/.test(n));
   if(ids.length!==1)throw new PropLineError('PropLine event did not uniquely match selected NFL game, teams and UTC kickoff; no odds request made.',409);
   const body=await get('/sports/football_nfl/events/'+ids[0]+'/odds',params);if(eventIdentifier(obj(body).id)!==ids[0])throw new PropLineError('PropLine response event ID contradicts request.',503);bodies=[body];
  }
  const diagnostics:PropLineCollectionDiagnostics={version:1,request:{scope:game,period:p,endpoint:game==='ALL'?'bulk':'selected',bookmakers:'fanduel',marketKeys:[...PROPLINE_MARKETS],periodParameter:p==='Q1'?'q1':null,maxAgeSeconds:1800},response:{shape:game==='ALL'?'event-array':'event-object',events:bodies.length},eventMatching:[],events:[]};
  const snapshot:PropLineSnapshot={at:now,events:[],rows:{},coverage:{},selectedGame:game,period:p,rejections:[],diagnostics};
  const signatures=new Map<string,string>(),bad=new Set<string>();
  for(const body of bodies){const e=obj(body),eventId=eventIdentifier(e.id),parsed=parsePropLineEvent(body,p,now);const evidence={providerEventId:eventId,verifiedGameId:null as string|null,parser:parsed.diagnostics};diagnostics.events.push(evidence);if(!eventId){snapshot.rejections.push('Missing provider event ID.');continue;}
   const signature=JSON.stringify(body);if(signatures.has(eventId)&&signatures.get(eventId)!==signature){bad.add(eventId);snapshot.rejections.push('Conflicting duplicate provider event withheld.');continue;}if(signatures.has(eventId))continue;signatures.set(eventId,signature);
   const matching=matchNflEvents([{id:e.id,home_team:e.home_team,away_team:e.away_team,starts_at:e.commence_time,espn_event_id:e.espn_event_id}],games);
   diagnostics.eventMatching.push(...matching.checks.map(c=>({providerEventId:c.providerEventId,matchedGameId:c.matchedGameId,reason:c.reason})));
   evidence.verifiedGameId=matching.events.get(eventId)?.id??null;
   if(!matching.events.has(eventId)||e.live===true){snapshot.rejections.push('Provider event failed unique future NFL teams/ID/UTC kickoff matching.');continue;}
   const event:ApiEvent={id:eventId,home_team:String(e.home_team),away_team:String(e.away_team),commence_time:providerTimestamp(e.commence_time)!};snapshot.events.push(event);snapshot.rows[eventId]=parsed.rows;snapshot.coverage[eventId]=parsed.coverage;snapshot.rejections.push(...parsed.rejections);
  }
  snapshot.events=snapshot.events.filter(e=>!bad.has(e.id));for(const e of diagnostics.eventMatching)if(e.providerEventId&&bad.has(e.providerEventId)){e.matchedGameId=null;e.reason='Conflicting duplicate provider event withheld.';}for(const n of bad){delete snapshot.rows[n];delete snapshot.coverage[n];}snapshot.rejections=[...new Set(snapshot.rejections)];
  if(JSON.stringify(snapshot).includes(key))throw new PropLineError('Unsafe PropLine snapshot withheld.',503);
  db.transaction(()=>{put(db,name,snapshot,now);db.prepare('DELETE FROM cache WHERE key=?').run(failureKey(key,p));const currentPause=read<{until:number}>(db,pauseKey(key));if(currentPause&&currentPause.until<=now)db.prepare('DELETE FROM cache WHERE key=?').run(pauseKey(key));})();return snapshot;
 }catch(e){const error=e instanceof PropLineError?e:new PropLineError('PropLine verification failed; no substitute prices.',503);if(attempted)put(db,failureKey(key,p),{at:now,status:error.status,code:error.code??null},now);if(error.retryAt)put(db,pauseKey(key),{until:error.retryAt,status:error.status,code:error.code??null},now);throw error;}})();pending.set(name,work);try{return await work;}finally{pending.delete(name);}
}
