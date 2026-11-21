import {refreshPropLine,cachedPropLine,propLineStatus,propLineEvidence,type PropLineRow} from './propline.ts';
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {credentialFingerprint} from './credentials.ts';
import {readBoard,refreshBoard,assertBoardUsable,providerAccessStatus,FanDuelRestError} from './fanduelRest.ts';
import {fanduelResearch,matchBoard} from './fanduelResearch.ts';
import {fanduelQuarterResearch,pregameQuarterHistory} from './firstQuarterResearch.ts';
import {normalizeQuarterBoard} from './quarterDiagnostics.ts';
import {freeSchedule} from './freeResearch.ts';
import {matchNflEvents,eventIdentifier,nflTeam} from './nflEventMatching.ts';
import {providerTimestamp} from './providerTimestamp.ts';
import {fetchEvents,fetchEventProps,fetchFirstQuarterProps,DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS,DEFAULT_MARKETS,OddsApiError,type PropRow,type FirstQuarterPropRow,type ApiEvent} from '../lib/providers/oddsApi.ts';
import {loadLive,currentSeason,TEAM_ABBR} from '../lib/service.ts';
import {scoreVerifiedHistory} from '../lib/model.ts';
import {loadStatsHistory,loadFirstQuarterHistory,loadCurrentInjuries} from '../lib/providers/stats.ts';
import {makeFirstQuarterCandidates} from '../lib/firstQuarter.ts';
import {verifyQuarterAvailability} from '../lib/providers/espn.ts';
import {quarterMarketKey} from '../lib/propMarkets.ts';
import {eligibilityWarnings} from '../lib/optimizer.ts';
import {firstQuarterRejectionReasons} from '../lib/firstQuarter.ts';
import type {Candidate,FirstQuarterCandidate} from '../lib/types.ts';
import {conservativeContracts,type ProviderId,type Period,type NormalizedQuote} from '../lib/normalizedOdds.ts';
import {fourFullOptions,fourQuarterOptions} from '../lib/fourOptions.ts';
import {presetSlots,LOOSEST_PRESET_THRESHOLDS} from '../lib/presetGeneration.ts';
type Db=Database.Database;
type Games=Awaited<ReturnType<typeof freeSchedule>>;
export type ProviderKeys=Record<'fanduelapi'|'odds-api',string>&{propline?:string};
type Snapshot={at:number;events:ApiEvent[];rows:Record<string,PropLineRow[]>;coverage:Record<string,string[]>;selectedGame:string;period:Period};
const json=<T>(db:Db,key:string):T|null=>{const r=db.prepare('SELECT value FROM cache WHERE key=?').get(key) as {value:string}|undefined;try{return r?JSON.parse(r.value):null;}catch{return null;}};
const put=(db:Db,key:string,value:unknown,at:number)=>db.prepare('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)').run(key,JSON.stringify(value),at);
const identity=(key:string)=>createHash('sha256').update(key).digest('hex').slice(0,24);
const snapshotKey=(key:string,period:Period,game:string)=>`multi-odds:v1:${identity(key)}:${period}:${game}`;
const failureKey=(key:string,period:Period)=>`multi-odds:failure:${identity(key)}:${period}`;
const pauseKey=(key:string)=>`odds:cooldown:${credentialFingerprint(key)}`;
export const providerCapabilities=[
 {id:'fanduelapi',enabled:true,credential:'FANDUEL_API_KEY',coverage:'Independent provider /props inventory, explicit game/q1 periods only. Partial coverage; no direct sportsbook verification. Five-minute free-tier delay possible.'},
 {id:'odds-api',enabled:true,credential:'ODDS_API_KEY',coverage:'FanDuel bookmaker only. Documented full-game standard/alternate yards, receptions, attempts/TDs; optional documented Q1 passing yards only. Account entitlement/current inventory unverified.'},
 {id:'propline',enabled:true,credential:'PROPLINE_API_KEY',coverage:'Independent api.prop-line.com feed; FanDuel bookmaker only. Official NFL standard/alternate ladders and period=q1 contract; current Q1 inventory/account entitlements unverified. Free request limits are reported only from response headers.'},
 {id:'sportsdataio',enabled:false,credential:null,coverage:'Adapter unavailable: exact odds contract, account access and plan entitlements not verified. No requests made.'},
 {id:'oddslink',enabled:false,credential:null,coverage:'Adapter unavailable: authoritative API contract and account entitlement not verified. No requests made.'},
];
export function multiProviderStatus(db:Db,keys:ProviderKeys,now=Date.now()){
 const pause=json<{until:number;status:number;code?:string}>(db,pauseKey(keys['odds-api']));
 const failures=(['FULL','Q1'] as const).flatMap(period=>{const value=json<{at:number;status:number;code?:string}>(db,failureKey(keys['odds-api'],period));return value?[{period,...value}]:[];}).sort((a,b)=>b.at-a.at);
 return {capabilities:providerCapabilities,providers:[{id:'fanduelapi',...providerAccessStatus(db,keys.fanduelapi,now)},{id:'odds-api',configured:!!keys['odds-api'],paused:!!pause&&pause.until>now,retryAt:pause?.until??null,httpStatus:pause?.status??failures[0]?.status??null,code:pause?.code??failures[0]?.code??null,failures,automaticRetry:false,maxEventsPerRefresh:4,maxRequestsPerRefresh:5,cacheTtlSeconds:300,message:'Explicit selected-provider refresh only; existing Odds API cooldown is shared. No automatic fallback. Credits/entitlement are not checked by status.'},propLineStatus(db,keys.propline??'',now)]};
}
const fresh=(at:string,kickoff:string,now:number)=>!!providerTimestamp(at)&&now-Date.parse(at)>=-60000&&now-Date.parse(at)<=1800000&&Date.parse(at)<Date.parse(kickoff)&&Date.parse(kickoff)>now;
const pending=new WeakMap<Db,Map<string,Promise<Snapshot>>>();
export async function refreshOddsSnapshot(db:Db,key:string,period:Period,game:string,free:typeof fetch=fetch,paid:typeof fetch=fetch,now=Date.now()):Promise<Snapshot>{
 if(!key)throw new OddsApiError('ODDS_API_KEY is not configured; no fallback request made.',401);
 const pause=json<{until:number;status:number}>(db,pauseKey(key));if(pause&&pause.until>now)throw new OddsApiError('Odds API is paused until '+new Date(pause.until).toISOString()+'. No request made.',pause.status);
 const cacheKey=snapshotKey(key,period,game),old=json<Snapshot>(db,cacheKey),failed=json<{at:number}>(db,failureKey(key,period));
 if(old&&now-old.at>=0&&now-old.at<300000&&(!failed||failed.at<old.at))return old;
 let flight=pending.get(db);if(!flight){flight=new Map();pending.set(db,flight);}if(flight.has(cacheKey))return flight.get(cacheKey)!;
 const work=(async()=>{let attempted=false;try{
  const games=await freeSchedule(free,now),selected=games.filter(g=>game==='ALL'||g.id===game);
  if(!selected.length)throw new OddsApiError('No verified upcoming games match the selection. No odds request made.',409);
  attempted=true;const schedule=await fetchEvents(key,paid),mapping=matchNflEvents(schedule.events.map(e=>({id:e.id,home_team:e.home_team,away_team:e.away_team,starts_at:e.commence_time})),selected);
  const events=schedule.events.filter(e=>mapping.events.has(e.id)).slice(0,4),rows:Snapshot['rows']={},coverage:Snapshot['coverage']={};
  for(const event of events){
   const verifiedPaid:typeof fetch=async(input,init)=>{const response=await paid(input,init);if(response.ok){const body=await response.clone().json().catch(()=>null) as Record<string,unknown>|null;
    if(body&&((body.id!=null&&body.id!==event.id)||(body.commence_time!=null&&(!providerTimestamp(body.commence_time)||Math.abs(Date.parse(providerTimestamp(body.commence_time)!)-Date.parse(event.commence_time))>60000))||(body.home_team!=null&&nflTeam(body.home_team)!==nflTeam(event.home_team))||(body.away_team!=null&&nflTeam(body.away_team)!==nflTeam(event.away_team))))throw new OddsApiError('Provider odds response contradicts the verified requested event; prices withheld.',503);
    if(body&&Array.isArray(body.bookmakers)){
     const open=(x:Record<string,unknown>)=>x.suspended!==true&&x.active!==false&&[x.status,x.market_status].every(v=>v==null||typeof v==='string'&&['open','active'].includes(v.toLowerCase()));
     body.bookmakers=body.bookmakers.filter(b=>b&&typeof b==='object'&&open(b)).map(b=>({...b,markets:Array.isArray(b.markets)?b.markets.filter((m:Record<string,unknown>)=>m&&open(m)).map((m:Record<string,unknown>)=>({...m,outcomes:Array.isArray(m.outcomes)?m.outcomes.filter((o:Record<string,unknown>)=>o&&open(o)):[]})):[]}));
     return Response.json(body,{headers:response.headers});
    }
   }return response;};
   const result=period==='FULL'?await fetchEventProps(key,event.id,DEFAULT_MARKETS,verifiedPaid):await fetchFirstQuarterProps(key,event.id,verifiedPaid,DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS);rows[event.id]=result.rows;coverage[event.id]=result.marketKeys;}
  const snapshot={at:now,period,selectedGame:game,events:events.map(e=>({id:e.id,home_team:e.home_team,away_team:e.away_team,commence_time:e.commence_time})),rows,coverage};if(JSON.stringify(snapshot).includes(key))throw new OddsApiError('Unsafe provider response withheld.',503);db.transaction(()=>{put(db,cacheKey,snapshot,now);db.prepare('DELETE FROM cache WHERE key=?').run(failureKey(key,period));const pauseNow=json<{until:number}>(db,pauseKey(key));if(pauseNow&&pauseNow.until<=now)db.prepare('DELETE FROM cache WHERE key=?').run(pauseKey(key));})();return snapshot;
 }catch(e){const error=e instanceof OddsApiError?e:new OddsApiError('Odds provider unavailable; no substitute quotes created.',503);if(attempted)put(db,failureKey(key,period),{at:now,status:error.status,code:error.code??null},now);
  if([401,403,429].includes(error.status))put(db,pauseKey(key),{until:now+Math.max(60000,error.retryAfterMs??60000),status:error.status,code:error.code},now);throw error;
 }})();flight.set(cacheKey,work);try{return await work;}finally{flight.delete(cacheKey);}
}
function quote(provider:ProviderId,period:Period,game:Games[number],sourceId:string,player:string,market:string,side:string,line:number|null,american:number,at:string,now:number):NormalizedQuote{
 return {id:JSON.stringify([provider,sourceId,player,market,side,line,american,at]),provider,bookmaker:'fanduel',providerEventId:sourceId,gameId:game.id,player,playerId:null,team:null,opponent:null,kickoff:game.commence_time,market,period,line,side,american,observedAt:at,providerAsOf:null,reportedDelaySeconds:null,status:fresh(at,game.commence_time,now)?'current-provider-snapshot':'stale-or-unverified',provenance:provider==='propline'?'PropLine independent FanDuel-bookmaker snapshot; not verified directly at FanDuel Sportsbook. Delay/batch as_of unreported; selection last_seen_at checked against market update.':provider==='fanduelapi'?'Independent fanduelapi.com snapshot; not verified directly at FanDuel Sportsbook.':'The Odds API bookmaker=fanduel snapshot; not verified directly at FanDuel Sportsbook. Quote update comes from market/bookmaker last_update; batch as_of and delay are not reported.'};
}
async function oddsAnalysis(snapshot:Snapshot,games:Games,f:typeof fetch,now:number,provider:'odds-api'|'propline'='odds-api'){
 const mapping=matchNflEvents(snapshot.events.map(e=>({id:e.id,home_team:e.home_team,away_team:e.away_team,starts_at:e.commence_time})),games),quotes:NormalizedQuote[]=[];
 for(const event of snapshot.events){const game=mapping.events.get(event.id);if(!game)continue;for(const row of snapshot.rows[event.id]??[])quotes.push({...quote(provider,snapshot.period,game,event.id,'player'in row?row.player:row.participant,row.market,row.side,row.line,row.odds,row.updatedAt,now),providerMarket:row.providerMarket,providerPeriod:row.providerPeriod,providerPlayerId:row.providerPlayerId,providerTeam:row.providerTeam,lineType:row.lineType,lastSeenAt:row.lastSeenAt,marketUpdatedAt:row.marketUpdatedAt,lastChangeAt:row.lastChangeAt});}
 const active=quotes.filter(q=>q.status==='current-provider-snapshot'),selected=games.filter(g=>active.some(q=>q.gameId===g.id));
 const playerDiagnostics={historicalRows:null as number|null,q1HistoricalRows:null as number|null,injurySnapshotAvailable:null as boolean|null,availabilityRejections:[] as {player:string;reason:string}[]};
 let full:Candidate[]=[],quarter:FirstQuarterCandidate[]=[];
 if(active.length&&snapshot.period==='FULL'){
  const adapter:typeof fetch=async(input,init)=>{const u=new URL(String(input));if(u.hostname!=='api.the-odds-api.com')return f(input,init);const game=u.pathname.split('/').at(-2);return Response.json({bookmakers:[{key:'fanduel',markets:active.filter(q=>q.gameId===game).map(q=>({key:q.market,last_update:q.observedAt,outcomes:[{name:q.side,description:q.player,point:q.line,price:q.american}]}))}]});};
  const result=await loadLive({key:'local-normalization-no-credential',date:'ALL'},now,adapter,{events:selected,remaining:null});full=result.candidates.flatMap(c=>{const scored=scoreVerifiedHistory(c,now);return scored?[{...scored,id:provider+':'+c.id,resultGameId:c.gameId,espnEventId:games.find(g=>g.id===c.gameId)?.espnEventId}]:[];});
 }else if(active.length){
  const season=currentSeason(new Date(now)),stats=await loadStatsHistory(season,f),raw=await loadFirstQuarterHistory(season,f,stats.games),history=pregameQuarterHistory(raw,stats.games,now);
  playerDiagnostics.historicalRows=stats.games.length;playerDiagnostics.q1HistoricalRows=history.playerGames.length;
  for(const game of selected)quarter.push(...makeFirstQuarterCandidates(active.filter(q=>q.gameId===game.id&&q.line!==null).map(q=>({participant:q.player,market:q.market,side:q.side as 'Over'|'Under'|'AtLeast',line:q.line!,odds:q.american,updatedAt:q.observedAt})),game,stats.games.filter(g=>g.gameDate&&!g.invalidGameDate&&Date.parse(g.gameDate)<now),history,TEAM_ABBR,now,season));
  let report:Awaited<ReturnType<typeof loadCurrentInjuries>>|null=null;try{report=await loadCurrentInjuries(season,f,now);}catch{/* No injury evidence means no eligible automatic picks. */}
  playerDiagnostics.injurySnapshotAvailable=!!report?.currentSnapshotAt;const availability=await verifyQuarterAvailability(quarter,new Map(selected.map(g=>[g.id,[TEAM_ABBR[g.home_team],TEAM_ABBR[g.away_team]]])),report?.statuses??null,f,{currentSnapshotAt:report?.currentSnapshotAt??null,coveredTeams:report?.coveredTeams??[],now});playerDiagnostics.availabilityRejections=availability.rejections.map(r=>({player:r.player,reason:r.reason}));quarter=availability.candidates.map(c=>({...c,id:provider+':'+c.id,provider}));
 }
 return {quotes,full,quarter,playerDiagnostics};
}
export async function multiResearch(db:Db,keys:ProviderKeys,period:Period,game='ALL',f:typeof fetch=fetch,now=Date.now(),testMode=false,slateGameIds?:ReadonlySet<string>){
 const games=await freeSchedule(f,now),selected=games.filter(g=>(game==='ALL'||g.id===game)&&(!slateGameIds||slateGameIds.has(g.id))),results=await Promise.allSettled((['fanduelapi','odds-api','propline'] as const).map(async provider=>{
  const key=keys[provider];if(!key)throw new Error('Not configured. No provider request made.');
  if(provider==='propline'){const snapshot=cachedPropLine(db,key,period,game,now);return {provider,coverage:[...new Set(Object.values(snapshot.coverage).flat())],...await oddsAnalysis(snapshot,selected,f,now,provider),note:`PropLine explicit period snapshot; ${snapshot.rejections.join(' ')||'No parser rejection recorded.'} Missing Q1/alternate markets are not invented.`};}
  if(provider==='odds-api'){
   const snapshot=(json<Snapshot>(db,snapshotKey(key,period,game))??(game!=='ALL'?json<Snapshot>(db,snapshotKey(key,period,'ALL')):null));if(!snapshot)throw new Error('No cached snapshot for this mode/selection. Refresh this provider explicitly.');
   const failed=json<{at:number}>(db,failureKey(key,period)),pause=json<{until:number}>(db,pauseKey(key));
   if(failed&&failed.at>=snapshot.at||pause&&pause.until>now)throw new Error('Provider failure/pause invalidates this provider snapshot; other providers remain independent.');
   return {provider,coverage:[...new Set(Object.values(snapshot.coverage).flat())],...await oddsAnalysis(snapshot,selected,f,now),note:'At most four matched games collected per explicit refresh; no coverage outside cached selection is assumed.'};
  }
  const board=readBoard(db,key);if(!board)throw new Error('No cached board. Refresh explicitly.');assertBoardUsable(db,key,board);
  const raw=matchBoard(normalizeQuarterBoard(board),selected,now,period==='FULL'?'game':'q1'),quotes=raw.quotes.map(q=>{const g=selected.find(g=>g.id===q.eventId)!;return {...quote(provider,period,g,q.providerEventId,q.player,q.market,q.side,q.line,q.odds,q.observedAt,now),id:provider+':'+q.id,team:q.team,opponent:q.opponent,providerAsOf:q.meta.asOf,reportedDelaySeconds:q.meta.delaySeconds,status:q.freshness.eligible&&fresh(q.observedAt,q.kickoff,now)?'current-provider-snapshot' as const:'stale-or-unverified' as const};});
  const coverage=[...new Set(board.props.filter(p=>String(p.record.period).trim().toLowerCase()===(period==='FULL'?'game':'q1')).map(p=>String(p.record.stat).slice(0,100)))];
  const scoped={...board,props:board.props.filter(p=>raw.quotes.some(q=>eventIdentifier(p.record.id)+':'+q.side===q.id))};
  if(period==='FULL'){const result=await fanduelResearch(scoped,f,now,testMode);return {provider,coverage,quotes,full:result.analysisCandidates,quarter:[] as FirstQuarterCandidate[],note:result.provenance};}
  const result=await fanduelQuarterResearch(scoped,f,now,'ALL',game);return {provider,coverage,quotes,full:[] as Candidate[],quarter:result.candidates,note:result.provenance};
 }));
 const sources=results.map((r,i)=>r.status==='fulfilled'?{provider:r.value.provider,status:'cache-analyzed',coverage:r.value.coverage,note:r.value.note}:{provider:(['fanduelapi','odds-api','propline'] as const)[i],status:'unavailable',coverage:[] as string[],note:i===2?'PropLine not configured, cached prices unavailable/paused, or player checks failed. Refresh only this provider explicitly.':i===0?'FanDuelAPI cache absent, blocked, or free player verification failed. No automatic refresh.':'Odds API cache absent/blocked or free player verification failed. No automatic refresh.'});
 const quotes:NormalizedQuote[]=[],full:{candidate:Candidate;quote:NormalizedQuote}[]=[],quarter:{candidate:FirstQuarterCandidate;quote:NormalizedQuote}[]=[];
 for(const r of results)if(r.status==='fulfilled'){
  const value=r.value;for(const q of value.quotes){const c=value.full.find(c=>c.gameId===q.gameId&&c.name===q.player&&c.market===q.market&&c.side===q.side&&c.line===q.line&&c.odds===q.american&&c.oddsAt===q.observedAt),qc=value.quarter.find(c=>c.gameId===q.gameId&&c.player===q.player&&quarterMarketKey(c.market)===q.market&&c.side===q.side&&c.line===q.line&&c.odds===q.american&&c.oddsAt===q.observedAt);
   const verified=c??qc;
   if(verified&&q.provider==='propline'){
    const espn=verified.espnPlayerId?.replace(/^espn:/,''),team=verified.team;
    if(q.providerPlayerId&&q.providerPlayerId.replace(/^espn:/,'')!==espn||q.providerTeam&&nflTeam(q.providerTeam)!==nflTeam(team)){q.status='stale-or-unverified';q.rejections=['PropLine player ID/team contradicts independently verified current roster identity.'];quotes.push(q);continue;}
   }
   if(c){q.playerId=c.espnPlayerId??c.historyPlayerId??null;q.team=c.team;q.opponent=c.opp;full.push({candidate:{...c,quoteEvidence:q},quote:q});}if(qc){q.playerId=qc.espnPlayerId??qc.historyPlayerId??null;q.team=qc.team;q.opponent=qc.opponent;quarter.push({candidate:{...qc,quoteEvidence:q},quote:q});}quotes.push(q);
  }
 }
 const mergedFull=conservativeContracts(full.filter(x=>!eligibilityWarnings('best',x.candidate,now).length||!eligibilityWarnings('aggr',x.candidate,now).length)),mergedQ=conservativeContracts(quarter.filter(x=>!firstQuarterRejectionReasons(x.candidate,false,now).length));
 const eligibility=quotes.map(q=>{const c=full.find(x=>x.quote.id===q.id),qc=quarter.find(x=>x.quote.id===q.id);return {quoteId:q.id,reasons:q.rejections?.length?q.rejections:c?eligibilityWarnings('aggr',c.candidate,now):qc?firstQuarterRejectionReasons(qc.candidate,true,now):['Player identity/history/availability analysis unavailable for this exact quote.']};});
 const propLineCache=propLineEvidence(db,keys.propline??'',period,game,now),propLineQuotes=quotes.filter(q=>q.provider==='propline'),propLineQuarter=quarter.filter(x=>x.quote.provider==='propline');
 const propLinePlayerAnalysis=results[2].status==='fulfilled'&&'playerDiagnostics'in results[2].value?results[2].value.playerDiagnostics:null;
 const propLineDiagnostics={...propLineCache,playerAnalysis:propLinePlayerAnalysis,pipeline:{selectedSidePrices:propLineQuotes.length,freshProviderSidePrices:propLineQuotes.filter(q=>q.status==='current-provider-snapshot').length,availabilityVerifiedCandidates:period==='Q1'?propLineQuarter.length:full.filter(x=>x.quote.provider==='propline').length,eligibleBestSidePrices:period==='Q1'?propLineQuarter.filter(x=>!firstQuarterRejectionReasons(x.candidate,false,now).length).length:full.filter(x=>x.quote.provider==='propline'&&!eligibilityWarnings('best',x.candidate,now).length).length,eligibleAggressiveSidePrices:period==='Q1'?propLineQuarter.filter(x=>!firstQuarterRejectionReasons(x.candidate,true,now).length).length:full.filter(x=>x.quote.provider==='propline'&&!eligibilityWarnings('aggr',x.candidate,now).length).length},eligibilityRejections:eligibility.filter(e=>propLineQuotes.some(q=>q.id===e.quoteId)&&e.reasons.length)};
 return {propLineDiagnostics,mode:period,selectedGame:game,scope:'All verified upcoming games or the selected matchup; no Sunday-only implicit filter.',games:games.map(g=>({id:g.id,label:g.label,kickoff:g.commence_time})),sources,providerStatus:multiProviderStatus(db,keys,now),quotes,eligibility,conflicts:[...mergedFull.conflicts,...mergedQ.conflicts],presetOptions:period==='FULL'?presetSlots(conservativeContracts(full.filter(x=>!eligibilityWarnings('aggr',x.candidate,now,LOOSEST_PRESET_THRESHOLDS).length)).eligible.map(x=>x.candidate),{now,testMode}):[],options:period==='FULL'?fourFullOptions(mergedFull.eligible.map(x=>x.candidate),now,testMode):fourQuarterOptions(mergedQ.eligible.map(x=>x.candidate),now),warnings:['RESEARCH ONLY — probabilities are uncalibrated; EV and combined prices are theoretical, not validated recommendations.','Provider data is independently sourced; direct FanDuel acceptance and same-game pricing are unverified.','No automatic provider refresh or fallback. Missing markets and lines are never invented.'],generatedAt:now};
}
export async function refreshSelectedProvider(db:Db,keys:ProviderKeys,provider:ProviderId,period:Period,game:string,f:typeof fetch=fetch,now=Date.now()){
 if(provider==='propline')return refreshPropLine(db,keys.propline??'',period,game,f,f,now);
 if(provider==='fanduelapi')return refreshBoard(db,keys.fanduelapi,f,now);
 return refreshOddsSnapshot(db,keys['odds-api'],period,game,f,f,now);
}
