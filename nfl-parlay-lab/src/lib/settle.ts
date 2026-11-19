import {contractHit,contractPush} from './propMarkets.ts';
import { normName, statOf, supportsStatMarket, type StatGame } from './providers/stats.ts';
export interface SettlementSelection {
  player: string; playerId?: string; team?: string; opp: string; market: string;
  side: string; line: number | null; snapshotTs?: number; kickoffTs?: number; season?: number; gameId?: string; requireFinal?: boolean;
}
export function settlementOutcome(s: SettlementSelection, games: StatGame[]): { status: 'settled' | 'push' | 'pending'; hit: 0 | 1 | null; reason?: string } {
  const matches = games.filter((game) => {
    if (s.playerId ? game.playerId !== s.playerId : normName(game.name) !== normName(s.player)) return false;
    if (game.opp !== s.opp || s.team && game.team !== s.team || s.season != null && game.season !== s.season) return false;
    if (s.gameId && game.gameId !== s.gameId) return false;
    if (!s.gameId && s.kickoffTs != null) {
      const date = game.gameDate ? Date.parse(game.gameDate) : NaN;
      if (!Number.isFinite(date) || Math.abs(date - s.kickoffTs) > 36 * 3600_000) return false;
    }
    return true;
  });
  if (matches.length !== 1) return { status: 'pending', hit: null, reason: matches.length ? 'ambiguous-result' : 'missing-player-result' };
  if (s.requireFinal && matches[0].completed !== true) return { status: 'pending', hit: null, reason: 'game-not-final' };
  if(matches[0].participationConflict || matches[0].nonParticipationVerified) return {status:'pending',hit:null,reason:matches[0].participationConflict?'conflicting-participation-data':'verified-nonparticipation-excluded-from-calibration'};
  if (!matches[0].playerId || !matches[0].gameId || !supportsStatMarket(matches[0], s.market)) return { status: 'pending', hit: null, reason: 'missing-stat-market' };
  if(s.requireFinal && s.snapshotTs!=null) {
    const actual=matches[0].kickoffTs;
    if(actual!=null && Number.isFinite(actual)) {
      if(s.snapshotTs>=actual)return {status:'pending',hit:null,reason:'post-actual-kickoff-capture'};
    } else if(!matches[0].gameDate || new Date(s.snapshotTs).toISOString().slice(0,10)>=matches[0].gameDate.slice(0,10)) {
      return {status:'pending',hit:null,reason:'actual-kickoff-unverified'};
    }
  }
  const value = statOf(matches[0], s.market);
  if(!Number.isFinite(value))return {status:'pending',hit:null,reason:'invalid-result-value'};
  if (s.market.replace('_alternate', '') === 'player_anytime_td') return s.side==='Yes' ? { status: 'settled', hit: value > 0 ? 1 : 0 } : {status:'pending',hit:null,reason:'invalid-market-side'};
  if (s.line == null || !Number.isFinite(s.line) || !['Over', 'Under','AtLeast'].includes(s.side)) return { status: 'pending', hit: null, reason: 'invalid-market-line-or-side' };
  if (contractPush(value,s.side,s.line)) return { status: 'push', hit: null };
  return { status: 'settled', hit: contractHit(value,s.side,s.line) ? 1 : 0 };
}
/** Legacy API: pushes and unavailable/ambiguous records are never scored as losses. */
export function settle(s: SettlementSelection, games: StatGame[]): 0 | 1 | null {
  return settlementOutcome(s, games).hit;
}
