import type Database from 'better-sqlite3';
import type { Candidate } from '../lib/types.ts';
import { MODEL_VERSION } from '../lib/model.ts';
import { currentSeason } from '../lib/service.ts';
import { loadSchedule, loadFinalStats, matchScheduledGame, resolveScheduledGame, type StatGame } from '../lib/providers/stats.ts';
import { loadEspnSettlementStats } from '../lib/providers/espn.ts';
import { settlementOutcome, type SettlementSelection } from '../lib/settle.ts';
import { pregameIssues } from '../lib/forecastIntegrity.ts';
import { report, type Row } from '../lib/backtest.ts';

export function canRecordForecast(c: Candidate, now = Date.now()): c is Candidate & Required<Pick<Candidate, 'scored' | 'historyPlayerId' | 'historySource'>> {
  const proof = c.verification, history = c.history?.last10;
  if (c.source !== 'live' || !c.scored || c.scored.stale || !Number.isFinite(c.scored.p) ||
      c.scored.p <= 0 || c.scored.p >= 1 || !Number.isFinite(Date.parse(c.kickoff)) || Date.parse(c.kickoff) <= now ||
      !Number.isFinite(c.odds) || Math.abs(c.odds) < 100 || history?.results.length === 0 ||
      !(now - Date.parse(c.oddsAt) >= -5 * 60000 && now - Date.parse(c.oddsAt) <= 30 * 60000) ||
      !c.rosterVerified || !c.eventVerified || !c.quoteVerified || !c.historyVerified ||
      !c.gameId || !c.historyPlayerId || !c.historySource || !history || history.hitGames < 5 || history.hits == null ||
      !proof || proof.event.id !== c.gameId || proof.event.kickoff !== c.kickoff || proof.event.label !== c.eventLabel ||
      proof.quote.bookmaker !== 'fanduel' || proof.quote.player !== c.name || proof.quote.market !== c.market ||
      proof.quote.side !== c.side || proof.quote.line !== c.line || proof.quote.odds !== c.odds || proof.quote.updatedAt !== c.oddsAt ||
      proof.history.playerId !== c.historyPlayerId || proof.history.source !== c.historySource ||
      proof.history.market !== c.market || proof.history.line !== c.line ||
      history.results.some((result) => result.playerId !== c.historyPlayerId || !proof.history.gameIds.includes(result.gameId) || !result.date || !Number.isFinite(Date.parse(result.date)) || Date.parse(result.date) >= now)) return false;
  return true;
}

/** Capture is independent of ticket availability, EV, TEST MODE, and model validation. */
export function recordForecasts(db: Database.Database, candidates: Candidate[], now = Date.now()) {
  const insert = db.prepare(`INSERT OR IGNORE INTO forecast_snapshots
    (model_version, snapshot_ts, kickoff_ts, season, player, history_player_id, history_source, team, opp, pos, market, side, line, odds, odds_at, p, market_p, market_p_source, event_id, result_game_id, espn_event_id, espn_player_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let captured = 0;
  db.transaction(() => {
    for (const c of candidates) {
      if (!canRecordForecast(c, now)) continue;
      captured += insert.run(MODEL_VERSION, now, Date.parse(c.kickoff), currentSeason(new Date(c.kickoff)), c.name,
        c.historyPlayerId, c.historySource, c.team, c.opp, c.pos, c.market, c.side, c.line ?? 0,
        c.odds, c.oddsAt, c.scored.p, c.scored.marketP, c.marketPSource ?? 'single-side', c.gameId, c.resultGameId ?? '', c.espnEventId ?? '', c.espnPlayerId ?? (c.historySource === 'espn' ? c.historyPlayerId : '')).changes;
    }
  })();
  return captured;
}

/** Mapping uses a unique real schedule row. Mapping failure never creates a guessed event ID. */
export async function captureForecasts(db: Database.Database, candidates: Candidate[], f: typeof fetch = fetch, now?: number) {
  if (!candidates.length) return 0;
  let schedule: Record<string, string>[] = [];
  try { schedule = await loadSchedule(f); } catch { /* Capture the verified original Odds API event even if the result bridge is unavailable. */ }
  return recordForecasts(db, candidates.map((candidate) => {
    const match = matchScheduledGame(schedule, { season: currentSeason(new Date(candidate.kickoff)), team: candidate.team, opp: candidate.opp, kickoffTs: Date.parse(candidate.kickoff), resultGameId: candidate.resultGameId, espnEventId: candidate.espnEventId });
    return match ? { ...candidate, resultGameId: match.game_id, espnEventId: /^\d+$/.test(match.espn ?? '') ? match.espn : undefined } : candidate;
  }), now ?? Date.now());
}

/** Last recorded pregame quote per player/market/side/event; refreshes/alternate lines do not inflate validation counts. */
export function evaluationRows(db: Database.Database): Row[] {
  const rows = db.prepare(`SELECT pos, market, side, line, odds, p, market_p AS marketP,
    market_p_source AS marketPSource, hit, snapshot_ts AS snapshotTs, kickoff_ts AS kickoffTs, result_date AS resultDate, result_kickoff_ts AS resultKickoffTs, season, odds_at AS oddsAt
    FROM (SELECT *, ROW_NUMBER() OVER (
      PARTITION BY player, team, opp, REPLACE(market, '_alternate', ''), side, COALESCE(NULLIF(espn_event_id,''),NULLIF(result_game_id,''),NULLIF(event_id,''),CAST(kickoff_ts AS TEXT))
      ORDER BY snapshot_ts DESC, id DESC) AS ranking
      FROM forecast_snapshots WHERE model_version = ? AND snapshot_ts < kickoff_ts)
    WHERE ranking = 1 AND hit IS NOT NULL AND settlement_status='settled' AND result_source IN ('nflverse','espn') AND result_date IS NOT NULL AND (result_game_id<>'' OR espn_event_id<>'') ORDER BY kickoff_ts, snapshot_ts`).all(MODEL_VERSION) as (Row & {season:number;oddsAt:string;resultKickoffTs:number|null})[];
  return rows.filter((row)=>pregameIssues(row).length===0 && (row.resultKickoffTs!=null ? row.snapshotTs<row.resultKickoffTs : !!row.resultDate && new Date(row.snapshotTs).toISOString().slice(0,10)<row.resultDate));
}
export function trackingStatus(db: Database.Database, now = Date.now()) {
  const counts = db.prepare(`SELECT COUNT(*) AS captured, MIN(snapshot_ts) AS firstCaptured, MAX(snapshot_ts) AS lastCaptured,
    SUM(CASE WHEN snapshot_ts >= kickoff_ts THEN 1 ELSE 0 END) AS postKickoffExcluded,
    SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END) AS settledQuotes,
    SUM(CASE WHEN hit IS NULL AND settlement_status = 'pending' AND kickoff_ts >= ? THEN 1 ELSE 0 END) AS upcoming,
    SUM(CASE WHEN hit IS NULL AND settlement_status = 'pending' AND kickoff_ts < ? THEN 1 ELSE 0 END) AS awaitingResults,
    SUM(CASE WHEN settlement_status = 'push' THEN 1 ELSE 0 END) AS pushes,
    SUM(CASE WHEN history_source NOT IN ('nflverse', 'espn') OR history_player_id = '' THEN 1 ELSE 0 END) AS unsupportedIdentities
    FROM forecast_snapshots WHERE model_version = ?`).get(now, now, MODEL_VERSION) as Record<string, number | null>;
  const pendingReasons = db.prepare(`SELECT CASE WHEN kickoff_ts >= ? THEN 'awaiting-kickoff'
    WHEN kickoff_ts >= ? THEN 'awaiting-final-check-window' ELSE settlement_reason END AS reason, COUNT(*) AS count
    FROM forecast_snapshots WHERE model_version=? AND hit IS NULL AND settlement_status='pending' GROUP BY reason`)
    .all(now, now - 6*3600_000, MODEL_VERSION) as { reason: string; count: number }[];
  const incomplete = db.prepare(`SELECT COUNT(*) AS n FROM forecast_snapshots WHERE model_version=? AND
    (event_id='' OR history_player_id='' OR odds_at='')`).get(MODEL_VERSION) as { n: number };
  const legacySnapshots = (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n;
  const otherModels = (db.prepare('SELECT COUNT(*) AS n FROM forecast_snapshots WHERE model_version <> ?').get(MODEL_VERSION) as { n: number }).n;
  return { modelVersion: MODEL_VERSION, pendingReasons, legacySnapshots, firstCaptured: counts.firstCaptured, lastCaptured: counts.lastCaptured, postKickoffExcluded: counts.postKickoffExcluded ?? 0, incompleteMetadata: incomplete.n, otherModels, unsupportedIdentities: counts.unsupportedIdentities ?? 0, captured: counts.captured ?? 0, settledQuotes: counts.settledQuotes ?? 0,
    upcoming: counts.upcoming ?? 0, awaitingResults: counts.awaitingResults ?? 0, pushes: counts.pushes ?? 0 };
}
interface OpenForecast extends SettlementSelection {
  id: number; historySource: string; playerId: string; season: number; kickoffTs: number;
  snapshotTs: number; oddsAt: string; eventId: string; resultGameId: string; espnEventId: string; espnPlayerId: string;
}
export async function updateValidation(db: Database.Database, f: typeof fetch = fetch, now = Date.now()) {
  const notes: string[] = [], providerErrors: string[] = [];
  const open = db.prepare(`SELECT id, player, history_player_id AS playerId, history_source AS historySource,
    team, opp, market, side, line, snapshot_ts AS snapshotTs, odds_at AS oddsAt, kickoff_ts AS kickoffTs, season, event_id AS eventId,
    result_game_id AS resultGameId, espn_event_id AS espnEventId, espn_player_id AS espnPlayerId FROM forecast_snapshots
    WHERE model_version = ? AND hit IS NULL AND settlement_status = 'pending' AND kickoff_ts < ?`)
    .all(MODEL_VERSION, now - 6 * 3600_000) as OpenForecast[];
  let schedule: Record<string, string>[] = [];
  if (open.length) try { schedule = await loadSchedule(f); } catch { providerErrors.push('Authoritative game schedule unavailable; game matching and finality remain pending.'); }
  const blocked = new Map<number,string>(), resolutionReasons=new Map<number,string>();
  const bridge = db.prepare('UPDATE forecast_snapshots SET result_game_id=?,espn_event_id=? WHERE id=?');
  const repair = db.prepare(`INSERT INTO forecast_event_repairs
    (forecast_id,previous_result_game_id,previous_espn_event_id,result_game_id,espn_event_id,reason,verified_at) VALUES (?,?,?,?,?,?,?)`);
  for (const selection of open) {
    const integrity=pregameIssues(selection);
    if (integrity.length) {blocked.set(selection.id,integrity.join(', '));continue;}
    const resolution=resolveScheduledGame(schedule,selection), match=resolution.match;
    resolutionReasons.set(selection.id,resolution.reason);
    if (['conflicting-event-identities','ambiguous-game-identity'].includes(resolution.reason)) {blocked.set(selection.id,resolution.reason);continue;}
    if (match) {
      const resultId=match.game_id, espnId=/^\d+$/.test(match.espn ?? '') ? match.espn : selection.espnEventId;
      if (resultId!==selection.resultGameId || espnId!==selection.espnEventId) {
        repair.run(selection.id,selection.resultGameId,selection.espnEventId,resultId,espnId,resolution.reason,now);
        bridge.run(resultId,espnId,selection.id);
      }
      selection.resultGameId=resultId;selection.espnEventId=espnId;
    }
  }
  const nflverse: StatGame[] = [];
  for (const season of new Set(open.filter((s)=>!blocked.has(s.id) && s.historySource==='nflverse').map((s)=>s.season))) {
    try {nflverse.push(...await loadFinalStats(season,schedule,f));}
    catch {providerErrors.push(`Verified nflverse results unavailable for season ${season}; forecasts remain pending unless an explicit ESPN identity bridge is available.`);}
  }
  const requests = open.filter((s)=>!blocked.has(s.id)).flatMap((s) => {
    const playerId = s.espnPlayerId || (s.historySource === 'espn' ? s.playerId : '');
    return /^espn:\d+$/.test(playerId) && (s.espnEventId || s.historySource === 'espn')
      ? [{ playerId, season: s.season, kickoffTs: s.kickoffTs, eventId: s.espnEventId || undefined }] : [];
  });
  const espn = await loadEspnSettlementStats(requests, f);
  providerErrors.push(...espn.errors);
  const update = db.prepare(`UPDATE forecast_snapshots SET hit=?,settlement_status=?,settlement_reason=?,last_checked_at=?,
    settled_at=?,result_source=?,result_date=?,result_kickoff_ts=?,espn_event_id=? WHERE id=? AND hit IS NULL`);
  db.transaction(() => {
    for (const selection of open) {
      if (blocked.has(selection.id)) {update.run(null,'pending',blocked.get(selection.id),now,null,null,null,null,selection.espnEventId,selection.id);continue;}
      const args = { ...selection, requireFinal: true, line: selection.market.includes('anytime') ? null : selection.line };
      let outcome = settlementOutcome({ ...args, gameId: selection.historySource === 'nflverse' ? selection.resultGameId || undefined : selection.espnEventId || undefined }, selection.historySource === 'nflverse' ? nflverse : []);
      let source = 'nflverse';
      const espnId = selection.espnPlayerId || (selection.historySource === 'espn' ? selection.playerId : '');
      if (outcome.status === 'pending' && /^espn:\d+$/.test(espnId)) {
        outcome = settlementOutcome({ ...args, playerId: espnId, gameId: selection.espnEventId || undefined }, espn.games);
        source = 'espn';
      }
      if (outcome.status!=='pending' && selection.espnEventId && ['game-not-final','postponed-or-cancelled','unsupported-season-type'].includes(espn.eventStates.get(selection.espnEventId) ?? '')) {
        outcome={status:'pending',hit:null,reason:'conflicting-final-status'};
      }
      let reason = outcome.reason ?? outcome.status;
      if (outcome.status === 'pending') {
        if (reason!=='conflicting-final-status' && selection.espnEventId && espn.eventStates.has(selection.espnEventId) && espn.eventStates.get(selection.espnEventId) !== 'final') reason = espn.eventStates.get(selection.espnEventId)!;
        else if (!selection.resultGameId && !selection.espnEventId) reason = 'missing-or-ambiguous-game-identity';
        else if(schedule.length && resolutionReasons.get(selection.id)==='stored-event-not-found' && reason==='missing-player-result') reason='stored-event-unverified-in-schedule';
        else if (providerErrors.length && reason === 'missing-player-result') reason = 'provider-unavailable-or-missing-result';
      }
      const resultGames = source === 'espn' ? espn.games : nflverse;
      const resultPlayer = source === 'espn' ? espnId : selection.playerId;
      const resultId = source === 'espn' ? selection.espnEventId : selection.resultGameId;
      const matched = resultGames.filter((game) => game.playerId === resultPlayer && game.team === selection.team && game.opp === selection.opp &&
        (resultId ? game.gameId === resultId : game.gameDate && Math.abs(Date.parse(game.gameDate)-selection.kickoffTs)<=36*3600_000));
      const date = outcome.status !== 'pending' && matched.length === 1 ? matched[0].gameDate?.slice(0,10) ?? null : null;
      const espnEventId = source === 'espn' && matched.length === 1 ? matched[0].gameId : selection.espnEventId;
      if (outcome.status !== 'pending' && !date) { outcome = {status:'pending',hit:null}; reason='missing-result-date'; }
      update.run(outcome.hit, outcome.status, reason, now, outcome.status === 'pending' ? null : now,
        outcome.status === 'pending' ? null : source, date, matched.length===1 ? matched[0].kickoffTs??null : null, espnEventId, selection.id);
    }
  })();
  const tracking = trackingStatus(db, now), rows = evaluationRows(db);
  if (tracking.otherModels) notes.push(`${tracking.otherModels} forecast quotes belong to other/legacy model versions and cannot validate the current model.`);
  if (tracking.unsupportedIdentities) notes.push(`${tracking.unsupportedIdentities} forecasts lack a supported stored player identity; no result mapping was guessed.`);
  if (!tracking.captured) notes.push('No verified pregame forecasts have been captured for this model. Quotes or player stats alone are not pregame predictions.');
  else if (!rows.length) notes.push('No decisive final results are matched yet. Inspect pending reasons for future games, missing identities, provider delays, non-final games or pushes.');
  notes.push(...providerErrors);
  return { ...report(rows), modelVersion: MODEL_VERSION, tracking, providerErrors, unsettled: Number(tracking.upcoming) + Number(tracking.awaitingResults), notes };
}

/** Read already-settled evidence only: no provider calls or settlement work on generation requests. */
export function calibrationSnapshot(db: Database.Database, now = Date.now()) {
  return { ...report(evaluationRows(db)), tracking: trackingStatus(db, now), notes: ['Postgame settlement and calibration run separately in the background collector while the app is active.'] };
}
