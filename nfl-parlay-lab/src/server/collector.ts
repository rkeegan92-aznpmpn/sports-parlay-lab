import { credentialFingerprint } from './credentials.ts';
import type Database from 'better-sqlite3';
const LEASE_MS = 90_000;
interface State { credential_fingerprint?:string|null; process_id?:number|null; mode: 'capture-and-settle' | 'settle-only'; owner: string; status: string; heartbeat_at: number; started_at: number; last_attempt_at: number | null; last_success_at: number | null; next_run_at: number | null; last_error: string | null; stopped_at: number | null }
export function collectorStatus(db: Database.Database, now = Date.now()) {
  const row = db.prepare('SELECT * FROM collector_state WHERE id=1').get() as State | undefined;
  const active = Boolean(row && row.status !== 'stopped' && now - row.heartbeat_at < LEASE_MS && now >= row.heartbeat_at - 5000);
  return { credentialFingerprint:row?.credential_fingerprint??null, processId:row?.process_id??null, mode: row?.mode ?? 'capture-and-settle', status: !active ? 'stopped' : row!.status === 'failing' ? 'failing' : row!.status === 'degraded' ? 'degraded' : 'running', active,
    lastHeartbeat: row?.heartbeat_at ?? null, startedAt: row?.started_at ?? null,
    lastAttempt: row?.last_attempt_at ?? null, lastSuccess: row?.last_success_at ?? null,
    nextRun: active ? row?.next_run_at ?? null : null, lastError: row?.last_error ?? null,
    reason: !row ? 'Collector has not started with this database.' : !active && row.status !== 'stopped' ? 'Heartbeat expired; the app/collector may be stopped.' :
      row.status === 'stopped' ? 'Collector stopped.' : row.status === 'failing' ? 'Collector is active but a phase failed; inspect phase diagnostics.' : row.status==='degraded' ? 'Collector is active; provider/data limitations affect one or more phases. Inspect phase diagnostics.' : row.mode === 'settle-only' ? 'Free settlement and cache-only paper capture are active; new paid quote collection is stopped.' : 'Collector heartbeat is current. Collection stops when the Codespace stops.' };
}
export function acquireCollector(db: Database.Database, owner: string, now = Date.now(), mode: State['mode'] = 'capture-and-settle') {
  return db.transaction(() => {
    if (collectorStatus(db, now).active) return false;
    db.prepare(`INSERT INTO collector_state (id,owner,status,heartbeat_at,started_at,mode) VALUES (1,?,'running',?,?,?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,status='running',heartbeat_at=excluded.heartbeat_at,
      started_at=excluded.started_at,mode=excluded.mode,next_run_at=NULL,stopped_at=NULL`).run(owner, now, now, mode);
    db.prepare('UPDATE collector_state SET credential_fingerprint=?,process_id=? WHERE id=1 AND owner=?').run(credentialFingerprint(process.env.ODDS_API_KEY),process.pid,owner);
    return true;
  })();
}
export function heartbeat(db: Database.Database, owner: string, now = Date.now()) {
  return db.prepare("UPDATE collector_state SET heartbeat_at=? WHERE id=1 AND owner=? AND status<>'stopped'").run(now, owner).changes === 1;
}
export function collectorAttempt(db: Database.Database, owner: string, now = Date.now()) {
  db.prepare('UPDATE collector_state SET last_attempt_at=?,next_run_at=NULL WHERE id=1 AND owner=?').run(now, owner);
}
export function collectorResult(db: Database.Database, owner: string, error: string | null, nextRun: number | null, now = Date.now(), severity:'failing'|'degraded'='failing') {
  let safe=error;
  if(safe)for(const key of ['ODDS_API_KEY','PROPLINE_API_KEY','FANDUEL_API_KEY'])if(process.env[key]?.trim())safe=safe.replaceAll(process.env[key]!.trim(),'[redacted]');
  safe=safe?.replace(/apiKey=[^&\s]*/gi,'apiKey=[redacted]').slice(0,600)??null;
  db.prepare(`UPDATE collector_state SET status=?,last_error=?,next_run_at=?,heartbeat_at=?,
    last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END WHERE id=1 AND owner=?`)
    .run(error ? severity : 'running', safe, nextRun, now, safe, now, owner);
}
export function stopCollector(db: Database.Database, owner: string, now = Date.now()) {
  db.prepare("UPDATE collector_state SET status='stopped',stopped_at=?,next_run_at=NULL WHERE id=1 AND owner=?").run(now, owner);
}
