import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { MODEL_VERSION } from '../lib/model.ts';
import { pregameIssues } from '../lib/forecastIntegrity.ts';
import { collectorStatus } from './collector.ts';
interface AuditRow { id:number; modelVersion:string; snapshotTs:number; kickoffTs:number; resultKickoffTs:number|null; season:number; oddsAt:string;
  eventId:string; resultGameId:string; espnEventId:string; playerId:string; source:string;
  market:string;side:string;line:number|null;odds:number|null; status:string; reason:string; hit:number|null; lastChecked:number|null; team:string; opp:string }
const fields = [
  ['id','id','NULL'],['model_version','modelVersion',"'legacy-unversioned'"],['snapshot_ts','snapshotTs','NULL'],['kickoff_ts','kickoffTs','NULL'],
  ['result_kickoff_ts','resultKickoffTs','NULL'],['season','season','NULL'],['odds_at','oddsAt',"''"],['event_id','eventId',"''"],['result_game_id','resultGameId',"''"],
  ['espn_event_id','espnEventId',"''"],['history_player_id','playerId',"''"],['history_source','source',"'legacy-unknown'"],
  ['market','market',"'unknown'"],['side','side',"'unknown'"],['line','line','NULL'],['odds','odds','NULL'],
  ['settlement_status','status',"'legacy-unclassified'"],['settlement_reason','reason',"''"],['hit','hit','NULL'],
  ['last_checked_at','lastChecked','NULL'],['team','team',"''"],['opp','opp',"''"],
] as const;
const iso=(value:number|null)=>value!=null && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
/** Read-only, schema-aware snapshot. Never creates/migrates a DB, fetches providers, or changes a forecast. */
export function settlementAudit(db:Database.Database,now=Date.now()) {
  return db.transaction(()=>{
    const tables=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map((row)=>row.name));
    const columns=tables.has('forecast_snapshots') ? new Set((db.prepare('PRAGMA table_info(forecast_snapshots)').all() as {name:string}[]).map((row)=>row.name)) : new Set<string>();
    const rows:AuditRow[]=tables.has('forecast_snapshots') ? db.prepare(`SELECT ${fields.map(([column,alias,fallback])=>`${columns.has(column)?column:fallback} AS ${alias}`).join(',')} FROM forecast_snapshots`).all() as AuditRow[] : [];
    const current=rows.filter((row)=>row.modelVersion===MODEL_VERSION);
    const buckets={futureKickoff:0,waitingSixHours:0,dueUnchecked:0,duePreviouslyChecked:0,pushes:0,settled:0,invalidProvenance:0,unclassified:0};
    const reasons=new Map<string,number>();
    const events=new Map<string,{identity:string;team:string;opp:string;originalKickoffUTC:string|null;forecasts:number;due:number;future:number}>();
    const examples:{id:number;eventId:string;resultGameId:string;espnEventId:string;kickoffUTC:string|null;resolvedKickoffUTC:string|null;capturedUTC:string|null;market:string;side:string;line:number|null;odds:number|null;reason:string}[]=[];
    let nextEligible:number|null=null;
    let missingOriginalEventIds=0,missingResultEventIds=0,unsupportedPlayerIds=0,identifierNamespaceWarnings=0;
    for(const row of current) {
      if(/^\d+$/.test(row.resultGameId??'') || /^\d{4}_\d{1,2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(row.espnEventId??''))identifierNamespaceWarnings++;
      if(!row.eventId)missingOriginalEventIds++;
      if(!row.resultGameId && !row.espnEventId)missingResultEventIds++;
      if(!row.playerId || !['nflverse','espn'].includes(row.source) || row.source==='espn'&&!/^espn:\d+$/.test(row.playerId))unsupportedPlayerIds++;
      const issues=pregameIssues(row);
      let reason:string;let due=false,future=false;
      if(issues.length){buckets.invalidProvenance++;reason=issues.join(', ');}
      else if(row.status==='push'){buckets.pushes++;reason='push-excluded';}
      else if(row.status==='settled'&&row.hit!=null){buckets.settled++;reason='settled-quote-not-necessarily-a-deduplicated-calibration-trial';}
      else if(row.status!=='pending'||row.hit!=null){buckets.unclassified++;reason='legacy-or-inconsistent-state';}
      else if(row.kickoffTs>=now){buckets.futureKickoff++;reason='awaiting-kickoff';future=true;}
      else if(row.kickoffTs>=now-6*3600_000){buckets.waitingSixHours++;reason='awaiting-six-hour-check-window';}
      else {due=true;if(row.lastChecked==null){buckets.dueUnchecked++;reason='due-but-never-checked';}
        else {buckets.duePreviouslyChecked++;reason=row.reason&&row.reason!=='awaiting-kickoff'?row.reason:'due-with-stale-pending-reason';}}
      if(!issues.length&&row.status==='pending'&&row.hit==null&&!due)nextEligible=Math.min(nextEligible??Infinity,row.kickoffTs+6*3600_000);
      reasons.set(reason,(reasons.get(reason)??0)+1);
      const identity=row.espnEventId?`espn:${row.espnEventId}`:row.resultGameId?`nfl:${row.resultGameId}`:row.eventId?`odds:${row.eventId}`:`legacy:${row.team}:${row.opp}:${row.kickoffTs}`;
      const event=events.get(identity)??{identity,team:row.team,opp:row.opp,originalKickoffUTC:iso(row.kickoffTs),forecasts:0,due:0,future:0};
      event.forecasts++;if(due)event.due++;if(future)event.future++;events.set(identity,event);
      if(examples.length<20&&(due||issues.length))examples.push({id:row.id,eventId:row.eventId,resultGameId:row.resultGameId,espnEventId:row.espnEventId,kickoffUTC:iso(row.kickoffTs),resolvedKickoffUTC:iso(row.resultKickoffTs),capturedUTC:iso(row.snapshotTs),market:row.market,side:row.side,line:row.line,odds:row.odds,reason});
    }
    const collector=tables.has('collector_state')?collectorStatus(db,now):{status:'stopped',active:false,reason:'No collector heartbeat table exists in this legacy database.'};
    const due=buckets.dueUnchecked+buckets.duePreviouslyChecked;
    const conclusions:string[]=[];
    if(!current.length)conclusions.push('This database has no captured forecasts for the current model. Do not substitute quote-only or other-model history.');
    if(!due&&(buckets.futureKickoff||buckets.waitingSixHours))conclusions.push('No valid pending records are due yet. Future games and the six-hour check window cannot be settled early.');
    if(due&&!collector.active)conclusions.push(`${due} records are due, but no active collector heartbeat is confirmed. Start the app or run one-shot settlement after stopping another worker.`);
    if(due&&collector.active)conclusions.push(`${due} records are due. Inspect per-event pending reasons, provider access and last-check timestamps; a fresh heartbeat alone does not prove results exist.`);
    if(buckets.unclassified)conclusions.push(`${buckets.unclassified} rows have legacy or inconsistent state. Inspect the schema and preserve a backup before migration; outcomes cannot be assumed.`);
    if(buckets.invalidProvenance)conclusions.push('Invalid recorded times are excluded, not guessed or converted from seconds to milliseconds. Original records are retained.');
    const count=(table:string)=>tables.has(table)?(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n:0;
    let identity=db.name;try {if(identity!==':memory:')identity=realpathSync(path.resolve(identity));}catch{/* Fingerprint never exposes a local path. */}
    return {asOfUTC:iso(now),modelVersion:MODEL_VERSION,databasePathFingerprint:createHash('sha256').update(identity).digest('hex').slice(0,16),
      totalForecastRows:rows.length,currentModelCaptured:current.length,otherModelRows:rows.length-current.length,
      legacySnapshotRows:count('snapshots'),savedTickets:count('saved_tickets'),schemaMissingFields:fields.filter(([column])=>!columns.has(column)).map(([column])=>column),
      buckets,dueForSettlement:due,bucketsReconcile:Object.values(buckets).reduce((sum,value)=>sum+value,0)===current.length,
      nextEligibleAtUTC:iso(nextEligible),identifierNamespaceWarnings,missingOriginalEventIds,missingResultEventIds,unsupportedPlayerIds,
      reasons:[...reasons].map(([reason,count])=>({reason,count})),events:[...events.values()].slice(0,40),examples,collector,conclusions};
  })();
}
