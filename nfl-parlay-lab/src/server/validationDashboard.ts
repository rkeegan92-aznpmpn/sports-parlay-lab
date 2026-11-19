import {phaseHealth} from './collectionHealth.ts';
import type Database from 'better-sqlite3';
import { report } from '../lib/backtest.ts';
import { evaluationRows, trackingStatus } from './tracking.ts';
import { settlementAudit } from './settlementAudit.ts';
import { collectorStatus } from './collector.ts';
export function validationDashboard(db: Database.Database, now = Date.now()) {
  const tracking = trackingStatus(db, now);
  const recentForecasts = db.prepare(`SELECT id,player,history_player_id AS playerId,event_id AS eventId,
    result_game_id AS resultGameId,espn_event_id AS espnEventId,snapshot_ts AS capturedAt,kickoff_ts AS kickoffAt,
    odds_at AS oddsAt,market,side,line,odds,p,settlement_status AS status,settlement_reason AS reason,
    result_source AS resultSource,result_date AS resultDate FROM forecast_snapshots WHERE model_version=? ORDER BY id DESC LIMIT 20`)
    .all(tracking.modelVersion) as {id:number;player:string;playerId:string;eventId:string;resultGameId:string;espnEventId:string;capturedAt:number;kickoffAt:number;oddsAt:string;market:string;side:string;line:number;odds:number;p:number;status:string;reason:string;resultSource:string|null;resultDate:string|null}[];
  return { collectionPhases:phaseHealth(db), settlementAudit: settlementAudit(db,now), recentForecasts, ...report(evaluationRows(db)), tracking, collector: collectorStatus(db, now), updatedAt: now };
}
