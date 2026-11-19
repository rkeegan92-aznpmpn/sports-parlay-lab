import {contractHit,contractPush} from './propMarkets.ts';
import type { Candidate, Scored } from './types.ts';
import { americanToDecimal, decimalToAmerican, impliedProb } from './odds.ts';

export const MODEL_VERSION = 'historical-hit-beta-v2';

export function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export function poissonCdf(k: number, lambda: number): number {
  let term = Math.exp(-lambda), sum = 0;
  for (let i = 0; i <= k; i++) { sum += term; term *= lambda / (i + 1); }
  return Math.min(1, sum);
}
export const baseMarket = (m: string) => m.replace(/_alternate$/, '');
const COUNT = new Set(['player_pass_tds', 'player_rush_attempts', 'player_receptions','player_pass_attempts','player_pass_completions','player_pass_interceptions','player_rush_tds','player_receiving_tds']);
export const isPushLine = (c: Pick<Candidate, 'market' | 'line'> & {side?:string}) =>
  (!('side' in c)||c.side!=='AtLeast') && baseMarket(c.market)!=='player_anytime_td' && c.line !== null && c.line !== undefined && Number.isInteger(c.line);

/** Yardage: normal. Counts (receptions, attempts, pass TDs): Poisson. Anytime TD: Poisson P(X>=1). */
export function rawProbability(c: Pick<Candidate, 'market' | 'side' | 'line' | 'mean' | 'sd'>): number {
  const m = baseMarket(c.market);
  if (m === 'player_anytime_td') return 1 - Math.exp(-Math.max(c.mean, 0));
  if (c.line == null) throw new Error('Line required');
  if(c.side==='AtLeast')return COUNT.has(m)?1-poissonCdf(Math.ceil(c.line)-1,Math.max(c.mean,1e-6)):1-phi((c.line-0.5-c.mean)/Math.max(c.sd,1e-6));
  if (COUNT.has(m)) {
    const lambda = Math.max(c.mean, 1e-6);
    const win = c.side === 'Under'
      ? poissonCdf(Math.ceil(c.line) - 1, lambda)
      : 1 - poissonCdf(Math.floor(c.line), lambda);
    const push = isPushLine(c) ? poissonCdf(c.line, lambda) - poissonCdf(c.line - 1, lambda) : 0;
    return Math.max(0, Math.min(1, win / Math.max(1e-6, 1 - push)));
  }
  const over = 1 - phi((c.line - c.mean) / Math.max(c.sd, 1e-6));
  return c.side === 'Under' ? 1 - over : over;
}
const MIN_MODEL_PROBABILITY = 0.01;
const MAX_MODEL_PROBABILITY = 0.99;

/** Historical estimate is independent of the sportsbook price and remains unvalidated until backtesting supports it. */
export function scoreCandidate(c: Candidate, now = Date.now()): Scored {
  if (!Number.isFinite(c.sample) || c.sample < 0 || !Number.isFinite(c.mean) || !Number.isFinite(c.sd) || c.sd < 0) {
    throw new RangeError('Player sample, mean, and standard deviation must be finite and non-negative.');
  }
  const raw = rawProbability(c);
  const history = c.history?.last10;
  const hasHistoricalOutcomes = history?.hits != null && history.hitGames > 0;
  const historicalHitRate = hasHistoricalOutcomes ? history.hits! / history.hitGames : null;
  const weight = hasHistoricalOutcomes ? 1 : 0;
  const marketP = c.marketP != null && Number.isFinite(c.marketP) && c.marketP > 0 && c.marketP < 1
    ? c.marketP
    : impliedProb(c.odds);
  const boundedRaw = Math.min(MAX_MODEL_PROBABILITY, Math.max(MIN_MODEL_PROBABILITY, raw));
  const p = hasHistoricalOutcomes
    ? (history.hits! + 2) / (history.hitGames + 4)
    : boundedRaw;
  const boundedP = Math.min(MAX_MODEL_PROBABILITY, Math.max(MIN_MODEL_PROBABILITY, p));
  const ageMin = (now - Date.parse(c.oddsAt)) / 60000;
  const stale = !(ageMin >= -5 && ageMin <= 30);
  const suspiciousLongShot = c.odds >= 200 && boundedP - marketP >= 0.05;
  return {
    raw, p: boundedP, weight, confidence: 'Unvalidated',
    historicalHitRate, historicalHitGames: history?.hitGames ?? 0,
    ev: boundedP * americanToDecimal(c.odds) - 1,
    edge: boundedP - marketP,
    fairOdds: decimalToAmerican(1 / boundedP),
    stale, suspiciousLongShot, marketP,
    conditionalOnNoPush: isPushLine(c),
  };
}
export const scoreAll = (cs: Candidate[], now = Date.now()) => cs.map((c) => ({ ...c, scored: scoreCandidate(c, now) }));

/** Recompute this exact contract from uniquely identified pre-cutoff game results.
 * The Beta(2,2) estimator is unchanged; inconsistent aggregate hit counts cannot drive it.
 * The Wilson interval describes the historical sample, not calibrated forecast confidence.
 */
export function scoreVerifiedHistory(c:Candidate,now=Date.now()):Candidate|null {
 const window=c.history?.last10,proof=c.verification?.history;
 if(!c.historyVerified||!window||!proof||proof.source!==c.historySource||proof.playerId!==c.historyPlayerId||proof.market!==c.market||proof.line!==c.line||!window.results.length||window.results.length>10)return null;
 const cutoff=Math.min(now,Date.parse(c.kickoff)),ids=new Set<string>();
 if(!Number.isFinite(cutoff))return null;
 for(const r of window.results){
  if(!r.gameId||ids.has(r.gameId)||r.playerId!==c.historyPlayerId||!proof.gameIds.includes(r.gameId)||!r.date||!Number.isFinite(Date.parse(r.date))||Date.parse(r.date)>=cutoff||!Number.isFinite(r.value))return null;
  ids.add(r.gameId);
 }
 const decisions=window.results.filter(r=>!contractPush(r.value,c.side,c.line));
 const n=decisions.length;if(!n)return null;
 const hits=decisions.filter(r=>contractHit(r.value,c.side,c.line)).length;
 const corrected={...c,history:{...c.history!,last10:{...window,hits,hitGames:n,hitRate:hits/n}}};
 const scored=scoreCandidate(corrected,now),z=1.959963984540054,rate=hits/n,denom=1+z*z/n;
 const center=(rate+z*z/(2*n))/denom,half=z*Math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/denom;
 return {...corrected,scored:{...scored,estimateBasis:'verified-game-outcomes',historicalInterval:{lower:Math.max(0,center-half),upper:Math.min(1,center+half),method:'Wilson 95% historical hit-rate interval'}}};
}
