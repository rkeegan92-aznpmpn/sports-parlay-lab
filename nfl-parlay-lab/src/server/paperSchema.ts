/** Additive NFL-only virtual ledger; no alteration/reset of existing research archives. */
export const PAPER_SCHEMA=`
CREATE TABLE IF NOT EXISTS paper_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 1,
 lead_minutes INTEGER NOT NULL DEFAULT 120, close_minutes INTEGER NOT NULL DEFAULT 15,
 days_json TEXT NOT NULL DEFAULT '[0,1,4,6]', updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO paper_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS paper_selection (
 id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('ALL','SUNDAY','GAMES')),
 game_ids_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO paper_selection(id,mode) VALUES(1,'ALL');
CREATE TABLE IF NOT EXISTS paper_wagers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slate_key TEXT NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL, nfl_date TEXT NOT NULL,
 strategy TEXT NOT NULL CHECK(strategy IN ('Safer','Balanced','Aggressive','Long Shot')),
 created_at INTEGER NOT NULL, capture_mode TEXT NOT NULL CHECK(capture_mode IN ('automatic','manual')),
 stake_cents INTEGER NOT NULL CHECK(stake_cents=1000), theoretical_decimal REAL NOT NULL,
 legs_json TEXT NOT NULL, ticket_json TEXT NOT NULL, UNIQUE(slate_key,strategy)
);
CREATE TABLE IF NOT EXISTS paper_ticket_grades (ticket_id INTEGER PRIMARY KEY,status TEXT NOT NULL,legs_json TEXT NOT NULL,checked_at INTEGER NOT NULL,finalized INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS paper_grade_events (id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id INTEGER NOT NULL,checked_at INTEGER NOT NULL,previous_json TEXT,result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS paper_settlements (wager_id INTEGER PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',return_cents INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS paper_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,wager_id INTEGER,created_at INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('opening','stake','settlement','correction')),amount_cents INTEGER NOT NULL,
 note TEXT NOT NULL
);
INSERT OR IGNORE INTO paper_ledger(event_key,created_at,kind,amount_cents,note) VALUES('opening:1000',CAST(strftime('%s','now') AS INTEGER)*1000,'opening',100000,'Starting virtual bankroll; no real money.');
CREATE TABLE IF NOT EXISTS paper_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,slate_key TEXT,mode TEXT NOT NULL,status TEXT NOT NULL,captured INTEGER NOT NULL,notes_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS paper_wagers_no_update BEFORE UPDATE ON paper_wagers BEGIN SELECT RAISE(ABORT,'Paper quoted selections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_wagers_no_delete BEFORE DELETE ON paper_wagers BEGIN SELECT RAISE(ABORT,'Paper quoted selections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_ledger_no_update BEFORE UPDATE ON paper_ledger BEGIN SELECT RAISE(ABORT,'Paper ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS paper_ledger_no_delete BEFORE DELETE ON paper_ledger BEGIN SELECT RAISE(ABORT,'Paper ledger is append-only'); END;
`;
