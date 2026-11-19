import type { Candidate } from './types.ts';
import { phi } from './model.ts';

export const DEFAULT_SIMULATIONS = 6000;

function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

/** Gaussian-copula Monte Carlo: legs share team and game factors. Loadings are assumptions, not fitted values. */
export function simulate(legs: Candidate[], o: { n?: number; seed?: number; teamLoad?: number; gameLoad?: number } = {}) {
  const n = o.n ?? DEFAULT_SIMULATIONS, A = o.teamLoad ?? 0.3, B = o.gameLoad ?? 0.12;
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Simulation count must be a positive integer.');
  if (!Number.isFinite(A) || !Number.isFinite(B) || A * A + B * B >= 1) throw new RangeError('Loadings must be finite and their squared sum must be below 1.');
  const r = rng(o.seed ?? 1), idio = Math.sqrt(1 - A * A - B * B);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const gt: Record<string, number> = {}, gg: Record<string, number> = {};
    let ok = true;
    for (const l of legs) {
      const probability = l.scored?.p;
      if (probability == null || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new RangeError(`Invalid modeled probability for ${l.name}.`);
      }
      gt[l.team] ??= normal(r); gg[l.gameId] ??= normal(r);
      const z = A * gt[l.team] + B * gg[l.gameId] + idio * normal(r);
      if (phi(z) >= probability) ok = false;
    }
    if (ok) hits++;
  }
  const jointP = hits / n;
  const se = Math.sqrt((jointP * (1 - jointP)) / n);
  const z = 1.96, zSquared = z * z, denominator = 1 + zSquared / n;
  const center = (jointP + zSquared / (2 * n)) / denominator;
  const margin = z * Math.sqrt((jointP * (1 - jointP)) / n + zSquared / (4 * n * n)) / denominator;
  return {
    jointP,
    se,
    lower95: Math.max(0, center - margin),
    upper95: Math.min(1, center + margin),
  };
}
