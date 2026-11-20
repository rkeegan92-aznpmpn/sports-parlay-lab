/** Shared multi-sport contracts (Stage 1). Pure types/data: no network, no database, no secrets. */
export const SPORT_IDS = ['nfl', 'nba', 'mlb', 'nhl', 'mma'] as const;
export type SportId = (typeof SPORT_IDS)[number];
/** 'implemented' = working end to end in this app today. 'planned' = descriptor only; no data pipeline yet. */
export type ModuleStatus = 'implemented' | 'planned';
/** 'verified-in-app' = the existing app already parses real odds for it. 'unverified' = must be confirmed against a real provider response before use. */
export type CoverageStatus = 'verified-in-app' | 'unverified';
export type MarketScope = 'player' | 'fighter' | 'fight' | 'game';
export interface MarketCategory { id: string; label: string; scope: MarketScope; coverage: CoverageStatus }
export interface TicketRules {
  legs: number;
  maxLegsPerGame: number;
  /** Positional slot counts (e.g. NFL 1 QB/2 RB/2 WR/1 TE). null = no positional constraint. */
  slots: Record<string, number> | null;
  /** True when the value is a proposed default, not behavior carried over from verified NFL code. */
  provisional: boolean;
}
export interface SportModule {
  id: SportId;
  label: string;
  status: ModuleStatus;
  participantNoun: 'player' | 'fighter';
  /** Odds-provider sport key. null until confirmed against the real provider (never guessed). */
  providerSportKey: string | null;
  ticketRules: TicketRules;
  markets: MarketCategory[];
  notes: string[];
}
