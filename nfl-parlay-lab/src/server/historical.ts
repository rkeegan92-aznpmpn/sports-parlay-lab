import type Database from 'better-sqlite3';
import {loadFinalStats,loadSchedule} from '../lib/providers/stats.ts';
import {simulateHistorical,HISTORICAL_VERSION,type HistoricalQuote} from '../lib/historical.ts';
import {MODEL_VERSION} from '../lib/model.ts';
export async function runHistorical(db:Database.Database,season:number,f:typeof fetch=fetch,refresh=false):Promise<ReturnType<typeof simulateHistorical>&{generatedAt:number;cached:boolean}> {
 const key=`${HISTORICAL_VERSION}:${season}`;
 const old=db.prepare('SELECT result_json,created_at FROM historical_backtests WHERE run_key=?').get(key) as {result_json:string;created_at:number}|undefined;
 if(!refresh&&old&&Date.now()-old.created_at<6*3600_000)return {...JSON.parse(old.result_json),generatedAt:old.created_at,cached:true};
 const schedule=await loadSchedule(f),games=await loadFinalStats(season,schedule,f);
 if(!games.length)throw new Error('Historical completed statistics unavailable');
 const quotes=db.prepare(`SELECT history_player_id AS playerId,result_game_id AS gameId,market,side,line,odds,snapshot_ts AS capturedAt,odds_at AS oddsAt,id AS captureId FROM forecast_snapshots WHERE model_version=? AND season=? AND snapshot_ts<kickoff_ts AND result_game_id<>'' AND settlement_status IN ('settled','push') AND result_source IN ('nflverse','espn') AND result_kickoff_ts IS NOT NULL AND snapshot_ts<result_kickoff_ts`).all(MODEL_VERSION,season) as (Omit<HistoricalQuote,'oddsAt'>&{oddsAt:string})[];
 const result=simulateHistorical(games,schedule,season,quotes.map(q=>({...q,oddsAt:Date.parse(q.oddsAt)})));
 const now=Date.now();db.prepare('INSERT INTO historical_backtests(run_key,season,created_at,result_json) VALUES(?,?,?,?) ON CONFLICT(run_key) DO UPDATE SET created_at=excluded.created_at,result_json=excluded.result_json').run(key,season,now,JSON.stringify(result));
 return {...result,generatedAt:now,cached:false};
}
