import { PAPER_STAKE_CENTS } from './paper.ts';
/** Paper-bet stake is adjustable; $10 is the default. Cents are always integers. */
export const DEFAULT_PAPER_STAKE_CENTS = PAPER_STAKE_CENTS;
export const MIN_PAPER_STAKE_CENTS = 100;     // $1.00
export const MAX_PAPER_STAKE_CENTS = 100000;  // $1,000.00 (the starting virtual bankroll)
export type StakeResult = { ok: true; cents: number } | { ok: false; error: string };
export function parseStake(input: unknown): StakeResult {
  const raw = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim().replace(/^\$/, '') : '';
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) return { ok: false, error: 'Enter a dollar amount with at most two decimals, e.g. 10 or 12.50.' };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  if (cents < MIN_PAPER_STAKE_CENTS) return { ok: false, error: 'Minimum paper stake is $1.00.' };
  if (cents > MAX_PAPER_STAKE_CENTS) return { ok: false, error: 'Maximum paper stake is $1,000.00.' };
  return { ok: true, cents };
}
/** Stored/unset value -> effective stake; invalid or missing values fall back to $10. */
export const effectiveStakeCents = (stored: unknown): number =>
  typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= MIN_PAPER_STAKE_CENTS && stored <= MAX_PAPER_STAKE_CENTS ? stored : DEFAULT_PAPER_STAKE_CENTS;
