import type { SportModule, MarketCategory } from './types.ts';
const u = (id: string, label: string, scope: MarketCategory['scope']): MarketCategory => ({ id, label, scope, coverage: 'unverified' });
const note = 'Descriptor only (Stage 1). Provider sport key, market keys and stats source are UNVERIFIED and must be confirmed against real provider responses before any pipeline is built; none are guessed here.';
const generic = { legs: 6, maxLegsPerGame: 3, slots: null, provisional: true } as const;

export const nba: SportModule = { id: 'nba', label: 'NBA', status: 'planned', participantNoun: 'player', providerSportKey: null,
  ticketRules: { ...generic }, notes: [note],
  markets: [u('points', 'points', 'player'), u('rebounds', 'rebounds', 'player'), u('assists', 'assists', 'player'), u('threes', 'three-pointers made', 'player')] };
export const mlb: SportModule = { id: 'mlb', label: 'MLB', status: 'planned', participantNoun: 'player', providerSportKey: null,
  ticketRules: { ...generic }, notes: [note],
  markets: [u('hits', 'hits', 'player'), u('total_bases', 'total bases', 'player'), u('strikeouts', 'pitcher strikeouts', 'player'), u('home_runs', 'home runs', 'player')] };
export const nhl: SportModule = { id: 'nhl', label: 'NHL', status: 'planned', participantNoun: 'player', providerSportKey: null,
  ticketRules: { ...generic }, notes: [note],
  markets: [u('points', 'points', 'player'), u('shots_on_goal', 'shots on goal', 'player'), u('goals', 'anytime goal', 'player'), u('saves', 'goalie saves', 'player')] };
/** MMA/UFC: only markets with actual provider odds may ever be offered; every category stays 'unverified' until proven. */
export const mma: SportModule = { id: 'mma', label: 'MMA/UFC', status: 'planned', participantNoun: 'fighter', providerSportKey: null,
  ticketRules: { legs: 6, maxLegsPerGame: 1, slots: null, provisional: true },
  notes: [note, 'A fight card is the event; at most one leg per fight by default because same-fight legs are strongly correlated.'],
  markets: [u('fight_winner', 'fight winner', 'fight'), u('round_total', 'round total (over/under)', 'fight'), u('method_of_victory', 'method of victory', 'fight'),
    u('ko_tko', 'win by KO/TKO', 'fight'), u('submission', 'win by submission', 'fight'), u('decision', 'win by decision', 'fight'),
    u('fighter_significant_strikes', 'fighter significant strikes', 'fighter'), u('fighter_takedowns', 'fighter takedowns', 'fighter')] };
