import { RISK_OPTIONS, type RiskOption } from './fourOptions.ts';
import { CONFIG } from './optimizer.ts';

/** The four existing levels are unchanged and remain the default. */
export const STANDARD_RISK_LEVELS = RISK_OPTIONS;
export type AggressivePresetId = 'aggressive-plus' | 'high-roller' | 'moonshot';
export interface AggressivePreset {
  id: AggressivePresetId; label: string; description: string;
  /** Minimum per-leg estimated probability. Always below the existing Aggressive floor. */
  minLegProbability: number;
  minSample: number;
  /** Minimum theoretical ticket decimal price. */
  minTicketDecimal: number;
  warning: string;
}
/** OPTIONAL presets. Numbers are proposed defaults, not backtested; wiring into the optimizer is a later stage. */
export const AGGRESSIVE_PRESETS: readonly AggressivePreset[] = [
  { id: 'aggressive-plus', label: 'Aggressive+', description: 'Looser per-leg floor than Aggressive for higher payouts.', minLegProbability: 0.25, minSample: 6, minTicketDecimal: 20, warning: 'Higher loss risk than Aggressive. Unvalidated.' },
  { id: 'high-roller', label: 'High Roller', description: 'Much longer odds; most tickets will lose.', minLegProbability: 0.2, minSample: 6, minTicketDecimal: 50, warning: 'Most tickets will lose. Unvalidated.' },
  { id: 'moonshot', label: 'Moonshot', description: 'Maximum aggression with a larger sample requirement to limit pure noise.', minLegProbability: 0.15, minSample: 8, minTicketDecimal: 100, warning: 'Extreme long shot; expect near-constant losses. Unvalidated.' },
];
export type RiskSelection = { kind: 'standard'; level: RiskOption } | { kind: 'preset'; preset: AggressivePreset };
export const DEFAULT_RISK_SELECTION: RiskSelection = { kind: 'standard', level: 'Balanced' };
/** Resolves a user-supplied id/label. Unknown values return null (callers must not silently substitute). */
export function resolveRisk(input: unknown): RiskSelection | null {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  const level = RISK_OPTIONS.find((l) => l.toLowerCase() === key);
  if (level) return { kind: 'standard', level };
  const preset = AGGRESSIVE_PRESETS.find((p) => p.id === key || p.label.toLowerCase() === key);
  return preset ? { kind: 'preset', preset } : null;
}
export const allRiskChoices = () => [...RISK_OPTIONS.map((l) => ({ id: l, label: l, optional: false })), ...AGGRESSIVE_PRESETS.map((p) => ({ id: p.id, label: p.label, optional: true }))];
export const existingAggressiveFloor = () => CONFIG.aggr.minLeg;
