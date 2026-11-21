import type { SportModule, MarketCategory } from './types.ts';
import { SLOTS, MAX_LEGS_PER_GAME } from '../optimizer.ts';
import { PROP_STATS } from '../propMarkets.ts';

/** Descriptor over the EXISTING NFL code: values are read from the live constants, not copied, so they cannot drift. */
const markets: MarketCategory[] = [
  ...Object.entries(PROP_STATS).map(([id, d]) => ({ id: d.market, label: id.replace(/_/g, ' '), scope: 'player' as const, coverage: 'verified-in-app' as const })),
  { id: 'player_anytime_td', label: 'anytime touchdown', scope: 'player', coverage: 'verified-in-app' },
];
export const nfl: SportModule = {
  id: 'nfl', label: 'NFL', status: 'implemented', participantNoun: 'player',
  providerSportKey: 'football_nfl',
  ticketRules: { legs: 6, maxLegsPerGame: MAX_LEGS_PER_GAME, slots: { ...SLOTS }, provisional: false },
  markets,
  notes: ['Wraps the existing optimizer, PropLine adapter, paper ledger and grading unchanged.'],
};
