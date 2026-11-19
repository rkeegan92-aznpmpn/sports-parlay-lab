import type Database from 'better-sqlite3';
export type Phase='capture'|'forecast-settlement'|'ticket-grading'|'paper-betting';
export function collectionPolicy(db:Database.Database,key:string|undefined,requested:string|undefined,now=Date.now()) {
 if(requested!=='capture-and-settle')return {capture:false,reason:requested==='settle-only'?'Explicit free settlement-only mode; cached paper capture and free grading continue. No paid quote requests.':'Cache-only paper collection and free settlement/grading are active. Legacy paid Odds API capture requires explicit capture-and-settle mode; PropLine cache research does not depend on Odds API credits.'};
 if(!key?.trim())return {capture:false,reason:'Explicit paid capture requested but ODDS_API_KEY is absent; cached paper work and free grading continue.'};
 return {capture:true,reason:'Live capture enabled; provider cooldowns still apply.'};
}
export function recordPhase(db:Database.Database,phase:Phase,status:'ok'|'paused'|'degraded'|'failed',messages:string[],now=Date.now()) {
 const safe=messages.map(m=>{for(const key of ['ODDS_API_KEY','PROPLINE_API_KEY','FANDUEL_API_KEY'])if(process.env[key]?.trim())m=m.replaceAll(process.env[key]!.trim(),'[redacted]');return m.replace(/apiKey=[^&\s]*/gi,'apiKey=[redacted]').slice(0,600);});
 db.prepare(`INSERT INTO collector_phases(phase,status,checked_at,last_success_at,messages_json) VALUES(?,?,?,?,?) ON CONFLICT(phase) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,last_success_at=COALESCE(excluded.last_success_at,collector_phases.last_success_at),messages_json=excluded.messages_json`).run(phase,status,now,status==='ok'?now:null,JSON.stringify(safe));
}
export function phaseHealth(db:Database.Database) {
 const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collector_phases'").get();
 if(!table)return [];
 return (db.prepare('SELECT phase,status,checked_at,last_success_at,messages_json FROM collector_phases ORDER BY phase').all() as {phase:string;status:string;checked_at:number;last_success_at:number|null;messages_json:string}[]).map(r=>({phase:r.phase,status:r.status,checkedAt:r.checked_at,lastSuccess:r.last_success_at,messages:JSON.parse(r.messages_json) as string[]}));
}
