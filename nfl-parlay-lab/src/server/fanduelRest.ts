import {providerTimestamp} from './providerTimestamp.ts';
// Server-only authenticated adapter for the independent service documented at
// https://fanduelapi.com/docs and /openapi.json. Never import into client components.
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
export const FD_BASE='https://fanduelapi.com/api/v1';
export const FD_TTL=5*60_000;
export type FeedMeta={asOf:string|null;observedAt:string|null;delaySeconds:number|null;sourceStatus:string;sourceAgeSeconds:number|null;issues?:string[];timestampInputs?:{asOf:string|null;observedAt:string|null};sourceStatusInput?:string|null};
export type FeedRow={record:Record<string,unknown>;meta:FeedMeta};
export type Board={events:FeedRow[];props:FeedRow[];fetchedAt:number;complete:boolean};
export type ProviderFailureKind='authentication'|'access'|'quota'|'rate-limit'|'rate-or-quota'|'provider-down'|'invalid-response';
const failureKind=(status:number):ProviderFailureKind=>status===401?'authentication':[402,403].includes(status)?'access':status===429?'rate-or-quota':status>=500?'provider-down':'invalid-response';
const failureAdvice=(kind:ProviderFailureKind)=>({authentication:'Check FANDUEL_API_KEY privately and restart; no credential is displayed.',access:'Check account and endpoint authorization; no upgrade or payment is performed.',quota:'Wait for the provider account quota reset. No automatic retry or alternate paid provider is used.', 'rate-or-quota':'HTTP 429: the cached response does not distinguish rate limit from quota exhaustion. Check provider account limits and wait until retry time; no automatic retry.', 'rate-limit':'Wait until the reported retry time before an explicit refresh.', 'provider-down':'Provider unavailable. Keep cached research non-actionable and refresh explicitly after recovery.', 'invalid-response':'Provider contract could not be verified; incomplete data is withheld.'}[kind]);
export class FanDuelRestError extends Error {
 status:number;retryAt:number|null;kind:ProviderFailureKind;
 constructor(message:string,status=503,retryAt:number|null=null,kind:ProviderFailureKind=failureKind(status)){super(message);this.status=status;this.retryAt=retryAt;this.kind=kind;}
}
const object=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const date=providerTimestamp;
export function feedMeta(input:unknown):FeedMeta {
 const m=object(input),issues:string[]=[];
 const timestamp=(field:string)=>{const parsed=date(m[field]);if(m[field]!=null&&!parsed)issues.push(`${field}: invalid timestamp or missing explicit timezone`);return parsed;};
 const seconds=(field:string)=>{
  const value=m[field];if(value==null)return null;
  // Finite non-negative JSON seconds only; never interpret another unit or silently ignore invalid metadata.
  if(typeof value!=='number'||!Number.isFinite(value)||value<0){issues.push(`${field}: invalid non-negative seconds`);return null;}return value;
 };
 const status=typeof m.source_status==='string'?m.source_status.trim().toLowerCase():'';
 return {asOf:timestamp('as_of'),observedAt:timestamp('observed_at'),delaySeconds:seconds('delay_seconds'),
 sourceStatus:['ok','delayed','stale','down'].includes(status)?status:'unknown',sourceAgeSeconds:seconds('source_age_seconds'),timestampInputs:{asOf:typeof m.as_of==='string'?m.as_of.slice(0,120):null,observedAt:typeof m.observed_at==='string'?m.observed_at.slice(0,120):null},sourceStatusInput:typeof m.source_status==='string'?m.source_status.slice(0,40):null,...(issues.length?{issues}:{})};
}
export function quoteFreshness(meta:FeedMeta,observedAt:unknown,now=Date.now()) {
 const observed=date(observedAt),asOf=date(meta.asOf),sourceObserved=date(meta.observedAt);
 const quoteAgeSeconds=observed?(now-Date.parse(observed))/1000:null,snapshotAgeSeconds=asOf?(now-Date.parse(asOf))/1000:null;
 const observedSourceAgeSeconds=sourceObserved?(now-Date.parse(sourceObserved))/1000:null;
 // The provider documents source_age_seconds relative to as_of, not the current request clock.
 const reportedSourceWallAgeSeconds=meta.sourceAgeSeconds!==null&&Number.isFinite(meta.sourceAgeSeconds)&&snapshotAgeSeconds!==null?snapshotAgeSeconds+meta.sourceAgeSeconds:null;
 const ages=[quoteAgeSeconds,snapshotAgeSeconds,observedSourceAgeSeconds,reportedSourceWallAgeSeconds].filter((x):x is number=>x!==null);
 const age=ages.length?Math.max(...ages):null;
 const future=[observed,asOf,sourceObserved].filter((x):x is string=>!!x).every(v=>Date.parse(v)<=now+60000);
 const checks=[
  {field:'row.observed_at',passed:!!observed,reason:'Price observation timestamp must be valid and have an explicit timezone.'},
  {field:'meta.as_of',passed:!!asOf,reason:'Response as_of must be valid and have an explicit timezone.'},
  {field:'meta.observed_at',passed:meta.observedAt===null||!!sourceObserved,reason:'A supplied source observation timestamp must be valid and timezone-qualified.'},
  {field:'meta.source_status',passed:['ok','delayed'].includes(meta.sourceStatus),reason:'source health must be ok or delayed; unknown/stale/down is rejected.'},
  {field:'meta.delay_seconds',passed:meta.delaySeconds!==null&&Number.isFinite(meta.delaySeconds)&&meta.delaySeconds>=0&&meta.delaySeconds<=1800,reason:'Reported plan delay must be known, valid and at most 1800 seconds.'},
  {field:'meta.source_age_seconds',passed:meta.sourceAgeSeconds===null||Number.isFinite(meta.sourceAgeSeconds)&&meta.sourceAgeSeconds>=0&&meta.sourceAgeSeconds<=1800,reason:'A supplied source age must be valid and at most 1800 seconds.'},
  {field:'parsed_metadata',passed:!meta.issues?.length,reason:meta.issues?.join('; ')||'Provided metadata parsed without discarded invalid values.'},
  {field:'future_timestamps',passed:future,reason:'No observation/source timestamp may exceed the request clock by more than 60 seconds.'},
  {field:'effective_wall_age',passed:age!==null&&age<=1800,reason:'Price, snapshot and aged source evidence must each remain within the 30-minute (1800 seconds) limit.'},
 ];
 const eligible=checks.every(c=>c.passed);
 return {eligible,observedAt:observed,ageSeconds:age,label:!eligible?'STALE / UNVERIFIED — excluded':(meta.delaySeconds??0)>0||meta.sourceStatus==='delayed'?'DELAYED — not real-time':'RECENT PROVIDER SNAPSHOT — availability not guaranteed',
  checkedAtUtc:new Date(now).toISOString(),asOfUtc:asOf,sourceObservedAtUtc:sourceObserved,quoteAgeSeconds,snapshotAgeSeconds,observedSourceAgeSeconds,reportedSourceWallAgeSeconds,maxAgeSeconds:1800,futureToleranceSeconds:60,checks};
}
// Retain only documented fields. Never persist arbitrary provider messages or credentials.
const fields=['id','event_id','event_name','name','starts_at','home_team','away_team','sport','league','player','team','stat','period','line','over_american','under_american','market_status','observed_at','side','american_odds','odds','position','player_id','nfl_game_id','espn_event_id'];
export async function fetchBoard(key:string,f:typeof fetch=fetch,now=Date.now(),pageBudget=5):Promise<Board> {
 if(!key.trim())throw new FanDuelRestError('FANDUEL_API_KEY is missing in the server environment. Manual research remains available.',401);
 const list=async(path:'events'|'props')=>{
  const rows:FeedRow[]=[],seen=new Set<string>();
  for(let page=0;page<pageBudget;page++) {
   const url=new URL(`${FD_BASE}/${path}`);url.search=new URLSearchParams({sport:'nfl',limit:'200',offset:String(page*200),...(path==='props'?{status:'open'}:{})}).toString();
   let response:Response;
   try {response=await f(url.toString(),{headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});}
   catch {throw new FanDuelRestError('FanDuel data service request failed or timed out. No substitute data was generated.');}
   if(!response.ok) {
    const body=object(await response.json().catch(()=>null)),error=object(body.error);
    const header=response.headers.get('retry-after'),seconds=typeof error.retry_after_seconds==='number'?error.retry_after_seconds:header&&/^\d+$/.test(header)?Number(header):NaN;
    const reset=date(error.reset_at),headerDate=header&&!/^\d+$/.test(header)&&Number.isFinite(Date.parse(header))?new Date(Date.parse(header)).toISOString():null;
    const kind=response.status===429&&error.code==='QUOTA_EXCEEDED'?'quota':response.status===429&&error.code==='RATE_LIMITED'?'rate-limit':failureKind(response.status);
    const deadlines=[reset?Date.parse(reset):NaN,headerDate?Date.parse(headerDate):NaN,Number.isFinite(seconds)&&seconds>=0?now+seconds*1000:NaN].filter(Number.isFinite);
    // Honor real reset/retry evidence. The conservative default applies only when absent.
    const retryAt=[401,402,403,429].includes(response.status)?Math.max(now+60_000,...(deadlines.length?deadlines:[now+(kind==='quota'?24*3600_000:60_000)])):null;
    throw new FanDuelRestError(response.status===401?'FanDuel data service rejected authentication. Check FANDUEL_API_KEY privately and restart the app.':response.status===403||response.status===402?'FanDuel data service account or endpoint access is restricted.':response.status===429?kind==='quota'?'FanDuel data service monthly quota exhausted; wait for the account reset.':kind==='rate-limit'?'FanDuel data service rate limit reached; wait until the reported retry time.':'FanDuel data service HTTP 429: rate/quota limit; check account limits and retry time.':`FanDuel data service HTTP ${response.status}.`,response.status,retryAt,kind);
   }
   let body:Record<string,unknown>;
   try{body=object(await response.json());}catch{throw new FanDuelRestError('FanDuel data service returned invalid JSON.');}
   if(JSON.stringify(body).includes(key))throw new FanDuelRestError('Unsafe provider response withheld.');
   const meta=object(body.meta);
   if(!Array.isArray(body.data)||typeof meta.has_more!=='boolean')throw new FanDuelRestError('FanDuel data service response is missing data or pagination metadata.');
   const signature=JSON.stringify(body.data);
   if(meta.has_more&&(body.data.length===0||seen.has(signature)))throw new FanDuelRestError('FanDuel pagination did not advance; incomplete board withheld.');
   seen.add(signature);
   for(const row of body.data) {const record=object(row);rows.push({record:Object.fromEntries(fields.filter(k=>['string','number'].includes(typeof record[k])).map(k=>[k,record[k]])),meta:feedMeta(meta)});}
   if(!meta.has_more)return rows;
  }
  throw new FanDuelRestError('FanDuel board exceeds the five-page safety budget per endpoint. Incomplete board withheld to protect request quota.');
 };
 const events=await list('events'),props=await list('props');return {events,props,fetchedAt:now,complete:true};
}
function identity(key:string){return createHash('sha256').update(key).digest('hex').slice(0,24);}
export function readBoard(db:Database.Database,key:string):Board|null {
 const row=db.prepare('SELECT value FROM cache WHERE key=?').get(`fanduel-rest:board:${identity(key)}`) as {value:string}|undefined;
 try{return row?JSON.parse(row.value):null;}catch{return null;}
}
export function assertBoardUsable(db:Database.Database,key:string,board:Board) {
 const row=db.prepare('SELECT value FROM cache WHERE key=?').get(`fanduel-rest:failure:${identity(key)}`) as {value:string}|undefined;
 if(row&&JSON.parse(row.value).at>=board.fetchedAt)throw new FanDuelRestError('A newer provider failure makes this cached board unverified. Fetch successfully before generating again.',409);
 if(!board.complete)throw new FanDuelRestError('Incomplete provider board cannot generate research tickets.',409);
}
/** Cached preview is deliberately independent of refresh and failure invalidation. */
export function cachedResearchBoard(db:Database.Database,key:string,preview=false){
 const board=readBoard(db,key);
 if(!board)throw new FanDuelRestError('No readable cached FanDuel board. Cached preview cannot invent a snapshot; no provider request was made.',409);
 if(!board.complete||!Array.isArray(board.props)||!Array.isArray(board.events)||!Number.isFinite(board.fetchedAt))throw new FanDuelRestError('Incomplete cached FanDuel board cannot support research. Existing records were preserved; no provider request was made.',409);
 if(!preview){assertBoardUsable(db,key,board);return {board,providerWarning:null};}
 const failure=db.prepare('SELECT value FROM cache WHERE key=?').get(`fanduel-rest:failure:${identity(key)}`) as {value:string}|undefined;
 // Failure evidence is a warning for display-only research, never a refresh prerequisite.
 return {board,providerWarning:failure?'Provider collection failed or paused. Showing the original cached snapshot only; prices remain non-actionable. No provider retry was made.':null};
}
const inFlight=new WeakMap<Database.Database,Map<string,Promise<Board>>>();
export async function refreshBoard(db:Database.Database,key:string,f:typeof fetch=fetch,now=Date.now()):Promise<Board> {
 if(!key.trim())throw new FanDuelRestError('FANDUEL_API_KEY is missing in the server environment. Manual research remains available.',401);
 const id=identity(key),cooldownKey=`fanduel-rest:cooldown:${id}`;
 const cooldown=db.prepare('SELECT value FROM cache WHERE key=?').get(cooldownKey) as {value:string}|undefined;
 if(cooldown){const saved=JSON.parse(cooldown.value);if(saved.until>now)throw new FanDuelRestError(`FanDuel data service requests are paused. ${failureAdvice(saved.kind??failureKind(saved.status))}`,saved.status,saved.until,saved.kind??failureKind(saved.status));}
 const cached=readBoard(db,key);if(cached&&now-cached.fetchedAt>=0&&now-cached.fetchedAt<FD_TTL){assertBoardUsable(db,key,cached);return cached;}
 let pending=inFlight.get(db);if(!pending){pending=new Map();inFlight.set(db,pending);}if(pending.has(id))return pending.get(id)!;
 const work=(async()=>{try {
  const board=await fetchBoard(key,f,now);db.transaction(()=>{db.prepare('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)').run(`fanduel-rest:board:${id}`,JSON.stringify(board),now);db.prepare('DELETE FROM cache WHERE key=?').run(`fanduel-rest:failure:${id}`);db.prepare('DELETE FROM cache WHERE key=?').run(cooldownKey);})();return board;
 }catch(error){db.prepare('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)').run(`fanduel-rest:failure:${id}`,JSON.stringify({at:now,status:error instanceof FanDuelRestError?error.status:503,kind:error instanceof FanDuelRestError?error.kind:'provider-down'}),now);if(error instanceof FanDuelRestError&&error.retryAt)db.prepare('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)').run(cooldownKey,JSON.stringify({until:error.retryAt,status:error.status,kind:error.kind}),now);throw error;}})();
 pending.set(id,work);try{return await work;}finally{pending.delete(id);}
}

/** Safe cache-only access diagnostics; no credential, provider body or paid request. */
export function providerAccessStatus(db:Database.Database,key:string,now=Date.now()){
 const board=key?readBoard(db,key):null;
 let cooldown:{status?:unknown;until?:unknown;kind?:unknown}|null=null,failureAt:number|null=null,lastFailure:{status?:unknown;kind?:unknown}={};
 if(key){
  const rows=db.prepare('SELECT key,value FROM cache WHERE key IN (?,?)').all(`fanduel-rest:cooldown:${identity(key)}`,`fanduel-rest:failure:${identity(key)}`) as {key:string;value:string}[];
  for(const row of rows)try{const value=JSON.parse(row.value);if(row.key.includes(':cooldown:'))cooldown=value;else if(typeof value.at==='number'&&Number.isFinite(value.at)){failureAt=value.at;lastFailure=value;}}catch{/* Do not turn corrupt metadata into a claimed provider response. */}
 }
 const status=lastFailure.status??cooldown?.status;
 const httpStatus=typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<=599?status:null;
 const candidate=lastFailure.kind??cooldown?.kind;
 const kind:ProviderFailureKind|null=['authentication','access','quota','rate-limit','rate-or-quota','provider-down','invalid-response'].includes(String(candidate))?candidate as ProviderFailureKind:httpStatus?failureKind(httpStatus):null;
 const retryAt=typeof cooldown?.until==='number'&&Number.isFinite(cooldown.until)?cooldown.until:null;
 return {failureKind:kind,nextAction:kind?failureAdvice(kind):'Use explicit refresh only; cached access makes no provider request.',automaticRetry:false,requestBudget:{maxPagesPerEndpoint:5,maxRequestsPerRefresh:10,cacheTtlSeconds:FD_TTL/1000},configured:!!key,snapshotAvailable:!!board,lastFailureAt:failureAt,httpStatus,retryAt,paused:retryAt!==null&&retryAt>now,
  message:kind?failureAdvice(kind):!key?'Provider key is not configured in this environment; manual research remains separate.':!board?'No readable cached board for the current credential; no markets can be invented.':httpStatus===429?'Last recorded provider response was HTTP 429 (rate/quota). No automatic retry; quota versus rate cannot be inferred from status alone.':httpStatus===401?'Last recorded provider response rejected authentication (401).':httpStatus===402||httpStatus===403?'Last recorded provider response restricted account/endpoint access.':failureAt!==null?'A provider failure was recorded; no successful live request is implied.':'No provider failure recorded in this cache; this does not verify live credentials or coverage.'};
}
