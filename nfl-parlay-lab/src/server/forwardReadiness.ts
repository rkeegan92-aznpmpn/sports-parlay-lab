import type Database from 'better-sqlite3';
import {settlementAudit} from './settlementAudit.ts';
import {phaseHealth} from './collectionHealth.ts';
export function forwardReadiness(db:Database.Database,now=Date.now()) {
 const audit=settlementAudit(db,now),tables=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(r=>r.name));
 const columns=tables.has('saved_tickets')?new Set((db.prepare('PRAGMA table_info(saved_tickets)').all() as {name:string}[]).map(c=>c.name)):new Set<string>();
 const rows=tables.has('saved_tickets')?db.prepare(`SELECT id,created_at,legs_json,${columns.has('source')?'source':"'legacy-unknown'"} AS source,${columns.has('purpose')?'purpose':"'legacy-unknown'"} AS purpose FROM saved_tickets`).all() as {id:number;created_at:number;legs_json:string;source:string;purpose:string}[]:[];
 const gradeRows=tables.has('saved_ticket_grades')?db.prepare('SELECT ticket_id,status,legs_json FROM saved_ticket_grades').all() as {ticket_id:number;status:string;legs_json:string}[]:[];
 const grades=new Map(gradeRows.map(r=>[r.ticket_id,r]));
 const buckets={excludedNonForwardArchives:0,awaitingKickoff:0,partiallyStarted:0,allStarted:0,invalidDetails:0,missingGradeRecord:0,verifiedDecisiveLegs:0};
 const examples=[];
 for(const row of rows){
  if(!['live','manual','mixed'].includes(row.source)||/backtest|simulat|demo/i.test(row.purpose)){buckets.excludedNonForwardArchives++;continue;}
  let legs:any[]=[];try{const parsed=JSON.parse(row.legs_json);if(Array.isArray(parsed))legs=parsed;}catch{}
  const invalid=legs.length!==6||legs.some(l=>!l||!Number.isFinite(Date.parse(l.kickoff)));
  if(invalid){buckets.invalidDetails++;continue;}
  const started=legs.filter(l=>Date.parse(l.kickoff)<now).length;
  if(!started)buckets.awaitingKickoff++;else if(started===6)buckets.allStarted++;else buckets.partiallyStarted++;
  const grade=grades.get(row.id);if(!grade)buckets.missingGradeRecord++;
  let actual:any[]=[];try{actual=JSON.parse(grade?.legs_json??'[]');}catch{}
  if(Array.isArray(actual))buckets.verifiedDecisiveLegs+=actual.filter(l=>l?.status==='settled'&&[0,1].includes(l.hit)&&Number.isFinite(l.actual)&&['nflverse','espn'].includes(l.resultSource)).length;
  if(examples.length<20)examples.push({id:row.id,capturedAtUTC:Number.isFinite(new Date(row.created_at).getTime())?new Date(row.created_at).toISOString():null,startedLegs:started,earliestKickoffUTC:new Date(Math.min(...legs.map(l=>Date.parse(l.kickoff)))).toISOString(),latestKickoffUTC:new Date(Math.max(...legs.map(l=>Date.parse(l.kickoff)))).toISOString(),storedOutcome:grade?.status??'not-initialized',missingPlayerIds:legs.filter(l=>!l.historyPlayerId).length,exactEspnBridges:legs.filter(l=>/^\d+$/.test(l.espnEventId??'')&&/^espn:\d+$/.test(l.espnPlayerId??'')).length});
 }
 return {checkedAtUTC:new Date(now).toISOString(),forecastAudit:audit,tickets:{count:rows.length,...buckets,examples},collectionPhases:phaseHealth(db),
  conclusions:[audit.currentModelCaptured===0?'No current-model forecasts in this database.':'Captured quotes are not settled outcomes; inspect the reconciled forecast buckets.',
   buckets.verifiedDecisiveLegs===0?'Verified ticket accuracy is unavailable because this database has no decisive saved-ticket legs with actual final-source statistics. This is not a measured 0% win rate.':'Verified saved-ticket outcomes exist; use the evaluation dashboard for deduplicated accuracy.',
   'Forecast collection, forecast calibration, saved-ticket grading and BACKTEST simulations are separate datasets. Historical simulations never fill forward accuracy.',
   'Future games must remain Pending. Provider errors cannot establish whether all records are eligible; compare UTC kickoff and current time.']};
}
