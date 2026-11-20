import type { Candidate, Ticket } from './types.ts';
import { build } from './optimizer.ts';
import { fourFullOptions, RISK_OPTIONS } from './fourOptions.ts';
import { AGGRESSIVE_PRESETS, resolveRisk, type AggressivePreset, type RiskSelection } from './riskPresets.ts';
import { resolveSport } from './sports/registry.ts';
import type { SportId } from './sports/types.ts';

export interface RiskSlot { risk: string; optional: boolean; ticket: Ticket | null; missing: string[]; ranking: string }
export interface GenOptions { now?: number; testMode?: boolean }

/** Loosest per-leg floor across all presets: candidate pools for presets must be filtered no tighter than this. */
export const LOOSEST_PRESET_THRESHOLDS = {
  minLeg: Math.min(...AGGRESSIVE_PRESETS.map((p) => p.minLegProbability)),
  minSample: Math.min(...AGGRESSIVE_PRESETS.map((p) => p.minSample)),
};

/** One optional aggressive preset through the EXISTING six-leg optimizer (same slot, per-game, EV-lower-bound and validation rules); only the thresholds differ. */
export function presetSlot(pool: Candidate[], preset: AggressivePreset, o: GenOptions = {}): RiskSlot {
  const now = o.now ?? Date.now();
  const r = build('aggr', pool, { now, pregameResearch: true, testMode: o.testMode, top: 60, minDecimal: preset.minTicketDecimal - 1e-9,
    thresholds: { minLeg: preset.minLegProbability, minSample: preset.minSample } });
  const best = [...r.options].sort((a, b) => b.decimal - a.decimal)[0] ?? null;
  const ticket = best ? { ...best, warnings: [`${preset.label} preset: ${preset.warning}`, ...best.warnings] } : null;
  return { risk: preset.label, optional: true, ticket, ranking: `Highest theoretical payout meeting the ${preset.label} floors (per-leg p ≥ ${preset.minLegProbability}, sample ≥ ${preset.minSample}, price ≥ ${preset.minTicketDecimal}x).`,
    missing: ticket ? [] : [`No eligible six-pick ticket meets the ${preset.label} floors.`, ...r.missing.filter((m) => !/higher theoretical price than Best Six/.test(m))] };
}
export const presetSlots = (pool: Candidate[], o: GenOptions = {}): RiskSlot[] => AGGRESSIVE_PRESETS.map((p) => presetSlot(pool, p, o));
export const standardSlots = (pool: Candidate[], o: GenOptions = {}): RiskSlot[] =>
  fourFullOptions(pool, o.now ?? Date.now(), o.testMode ?? false).map((s) => ({ risk: s.label, optional: false, ticket: s.ticket, missing: s.missing, ranking: s.ranking }));

/** Sport-aware entry point. Only implemented sports generate; others return an honest, explicit refusal (never fabricated picks). */
export function generateForRisk(sportId: SportId, pool: Candidate[], risk: unknown, o: GenOptions = {}): { sport: SportId; slots: RiskSlot[]; error?: string } {
  const sport = resolveSport(sportId);
  if (sport.status !== 'implemented') return { sport: sport.id, slots: [], error: `${sport.label} ticket generation is not implemented yet: its odds markets and stats source are unverified.` };
  if (risk == null || risk === 'all') return { sport: sport.id, slots: [...standardSlots(pool, o), ...presetSlots(pool, o)] };
  const sel: RiskSelection | null = resolveRisk(risk);
  if (!sel) return { sport: sport.id, slots: [], error: `Unknown risk option. Choose one of: ${[...RISK_OPTIONS, ...AGGRESSIVE_PRESETS.map((p) => p.label)].join(', ')}.` };
  if (sel.kind === 'preset') return { sport: sport.id, slots: [presetSlot(pool, sel.preset, o)] };
  return { sport: sport.id, slots: standardSlots(pool, o).filter((s) => s.risk === sel.level) };
}
