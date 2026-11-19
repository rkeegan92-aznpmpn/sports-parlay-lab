import type { Candidate, Kind } from './types.ts';
export type SavedLeg = Pick<Candidate, 'id' | 'name' | 'pos' | 'team' | 'opp' | 'gameId' | 'kickoff' | 'market' | 'side' | 'line' | 'odds' | 'oddsAt' | 'source' | 'oddsProvider' | 'providerDelaySeconds' | 'providerAsOf'>;
export interface SavedTicket {
  id: number; strategy?: string | null; kind: Kind; created_at: number; purpose: string; source: string;
  joint_p: number | null; decimal: number | null; legs_json: string; legs: SavedLeg[]; detailsUnavailable: boolean;
}
export interface SaveMessage { type: 'success' | 'error'; text: string }
