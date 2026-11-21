import {PAPER_SCHEMA,ensurePaperStake} from './paperSchema.ts';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { databaseFile } from './storage.ts';
const FORECAST_TABLE = `CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version TEXT NOT NULL,
  snapshot_ts INTEGER NOT NULL,
  kickoff_ts INTEGER NOT NULL,
  season INTEGER NOT NULL,
  player TEXT NOT NULL,
  history_player_id TEXT NOT NULL,
  history_source TEXT NOT NULL,
  team TEXT NOT NULL,
  opp TEXT NOT NULL,
  pos TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL NOT NULL,
  odds INTEGER NOT NULL,
  odds_at TEXT NOT NULL,
  p REAL NOT NULL,
  market_p REAL,
  market_p_source TEXT NOT NULL,
  hit INTEGER,
  settlement_status TEXT NOT NULL DEFAULT 'pending',
  event_id TEXT NOT NULL DEFAULT '',
  result_game_id TEXT NOT NULL DEFAULT '',
  espn_event_id TEXT NOT NULL DEFAULT '',
  espn_player_id TEXT NOT NULL DEFAULT '',
  settlement_reason TEXT NOT NULL DEFAULT 'awaiting-kickoff',
  last_checked_at INTEGER,
  settled_at INTEGER,
  result_source TEXT,
  result_date TEXT,
  result_kickoff_ts INTEGER,
  legacy_hit INTEGER,
  UNIQUE(model_version, player, team, opp, market, side, line, kickoff_ts, odds, odds_at)
);`;
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS saved_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT NOT NULL, joint_p REAL, decimal REAL, legs_json TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'legacy-research');
CREATE TABLE IF NOT EXISTS pick6_batch_archives (strategy TEXT NOT NULL,signature TEXT NOT NULL,purpose TEXT NOT NULL,ticket_id INTEGER NOT NULL,PRIMARY KEY(strategy,signature,purpose));
CREATE INDEX IF NOT EXISTS pick6_batch_archive_ticket ON pick6_batch_archives(ticket_id);
CREATE TABLE IF NOT EXISTS saved_grade_events (id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id INTEGER NOT NULL,checked_at INTEGER NOT NULL,previous_json TEXT,result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS historical_backtests (run_key TEXT PRIMARY KEY, season INTEGER NOT NULL, created_at INTEGER NOT NULL, result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manual_quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, input_json TEXT NOT NULL, captured_at INTEGER NOT NULL, retired_at INTEGER);
CREATE TABLE IF NOT EXISTS saved_ticket_grades (ticket_id INTEGER PRIMARY KEY, status TEXT NOT NULL, legs_json TEXT NOT NULL, checked_at INTEGER NOT NULL, finalized INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_ts INTEGER NOT NULL, kickoff_ts INTEGER NOT NULL, season INTEGER, player TEXT NOT NULL, team TEXT, opp TEXT, pos TEXT, market TEXT NOT NULL, side TEXT NOT NULL, line REAL, odds INTEGER NOT NULL, p REAL NOT NULL, hit INTEGER, UNIQUE(player, market, side, line, kickoff_ts));
CREATE TABLE IF NOT EXISTS discovered_manual_props (id INTEGER PRIMARY KEY AUTOINCREMENT,input_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS manual_quote_checks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, target_key TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 expected_json TEXT NOT NULL, observation_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS manual_quote_checks_target ON manual_quote_checks(target_key,id);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS collector_phases (phase TEXT PRIMARY KEY,status TEXT NOT NULL,checked_at INTEGER NOT NULL,last_success_at INTEGER,messages_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collector_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'capture-and-settle',
  heartbeat_at INTEGER NOT NULL, started_at INTEGER NOT NULL, last_attempt_at INTEGER,
  last_success_at INTEGER, next_run_at INTEGER, last_error TEXT, stopped_at INTEGER, credential_fingerprint TEXT, process_id INTEGER
);
CREATE TABLE IF NOT EXISTS forecast_event_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, forecast_id INTEGER NOT NULL, previous_result_game_id TEXT NOT NULL, previous_espn_event_id TEXT NOT NULL,
  result_game_id TEXT NOT NULL, espn_event_id TEXT NOT NULL, reason TEXT NOT NULL, verified_at INTEGER NOT NULL
);
${FORECAST_TABLE}
${PAPER_SCHEMA}`;
let db: Database.Database | undefined;
export function getDb() {
  if (!db) {
    const file = databaseFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file); db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000'); db.exec(SCHEMA);
    ensurePaperStake(db as never);
    const gradeColumns=db.pragma('table_info(saved_ticket_grades)') as {name:string}[];
    if(!gradeColumns.some(c=>c.name==='finalized'))db.exec('ALTER TABLE saved_ticket_grades ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0');
    const collectorColumns = db.pragma('table_info(collector_state)') as {name:string}[];
    if (!collectorColumns.some((column)=>column.name==='mode')) db.exec("ALTER TABLE collector_state ADD COLUMN mode TEXT NOT NULL DEFAULT 'capture-and-settle'");
    if (!collectorColumns.some(c=>c.name==='credential_fingerprint')) db.exec('ALTER TABLE collector_state ADD COLUMN credential_fingerprint TEXT');
    if (!collectorColumns.some(c=>c.name==='process_id')) db.exec('ALTER TABLE collector_state ADD COLUMN process_id INTEGER');
    const savedColumns = db.pragma('table_info(saved_tickets)') as { name: string }[];
    if (!savedColumns.some((column) => column.name === 'sport')) db.exec("ALTER TABLE saved_tickets ADD COLUMN sport TEXT NOT NULL DEFAULT 'nfl'");
    if (!savedColumns.some((column) => column.name === 'purpose')) {
      db.exec("ALTER TABLE saved_tickets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'legacy-research'");
    }
    const columns = db.pragma('table_info(forecast_snapshots)') as { name: string }[];
    if (!columns.some((column) => column.name === 'model_version') ||
        !columns.some((column) => column.name === 'history_player_id') ||
        !columns.some((column) => column.name === 'history_source')) {
      const names = new Set(columns.map((column) => column.name));
      db.transaction(() => {
        db!.exec('ALTER TABLE forecast_snapshots RENAME TO forecast_snapshots_legacy');
        db!.exec(FORECAST_TABLE);
        const value = (name: string, fallback: string) => names.has(name) ? name : fallback;
        db!.exec(`INSERT INTO forecast_snapshots
          (id, model_version, snapshot_ts, kickoff_ts, season, player, history_player_id, history_source, team, opp, pos, market, side, line, odds, odds_at, p, market_p, market_p_source, hit)
          SELECT id, ${value('model_version', "'legacy-unversioned'")}, snapshot_ts, kickoff_ts, season, player,
          ${value('history_player_id', "''")}, ${value('history_source', "'legacy-unverified'")},
          team, opp, pos, market, side, line, odds, odds_at, p, market_p, market_p_source, hit
          FROM forecast_snapshots_legacy`);
        db!.exec('DROP TABLE forecast_snapshots_legacy');
      })();
    }
    const forecastColumns = db.pragma('table_info(forecast_snapshots)') as { name: string }[];
    if (!forecastColumns.some((column) => column.name === 'settlement_status')) {
      db.exec("ALTER TABLE forecast_snapshots ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'pending'");
      db.exec("UPDATE forecast_snapshots SET settlement_status = 'settled' WHERE hit IS NOT NULL");
    }
    const known = new Set((db.pragma('table_info(forecast_snapshots)') as { name: string }[]).map((column) => column.name));
    for (const [name, type] of Object.entries({ event_id: "TEXT NOT NULL DEFAULT ''", result_game_id: "TEXT NOT NULL DEFAULT ''",
      espn_event_id: "TEXT NOT NULL DEFAULT ''", espn_player_id: "TEXT NOT NULL DEFAULT ''",
      settlement_reason: "TEXT NOT NULL DEFAULT 'awaiting-kickoff'", last_checked_at: 'INTEGER', settled_at: 'INTEGER', result_source: 'TEXT', result_date: 'TEXT', result_kickoff_ts: 'INTEGER', legacy_hit: 'INTEGER' })) {
      if (!known.has(name)) db.exec(`ALTER TABLE forecast_snapshots ADD COLUMN ${name} ${type}`);
    }
    if (!known.has('result_kickoff_ts')) db.exec("UPDATE forecast_snapshots SET legacy_hit=COALESCE(legacy_hit,hit),hit=NULL,settlement_status='pending',settlement_reason='requires-actual-kickoff-verification' WHERE hit IS NOT NULL AND result_source IS NOT NULL AND (result_date IS NULL OR date(snapshot_ts/1000,'unixepoch')>=result_date)");
    if (!known.has('legacy_hit')) db.exec("UPDATE forecast_snapshots SET legacy_hit=hit,hit=NULL,settlement_status='pending',settlement_reason='requires-final-result-reverification' WHERE hit IS NOT NULL AND result_source IS NULL");
  }
  return db;
}
