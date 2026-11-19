import type {NormalizedQuote} from './normalizedOdds.ts';
export type Pos = 'QB' | 'RB' | 'WR' | 'TE';
export type Side = 'Over' | 'Under' | 'Yes' | 'AtLeast';
export type Kind = 'best' | 'aggr';
export interface PipelineRejection {
  player: string;
  market: string;
  side: Side;
  line: number | null;
  gameId: string;
  eventLabel: string;
  kickoff: string;
  reason: string;
}
export interface GroupedPipelineRejection extends PipelineRejection {
  count: number;
}
export interface Scored {
  historicalInterval?: {lower:number;upper:number;method:'Wilson 95% historical hit-rate interval'};
  estimateBasis?: 'verified-game-outcomes';
  raw: number;
  p: number;
  weight: number;
  confidence: 'Unvalidated' | 'Backtested';
  ev: number;
  edge: number;
  fairOdds: number;
  historicalHitRate: number | null;
  historicalHitGames: number;
  stale: boolean;
  suspiciousLongShot: boolean;
  marketP: number;
  conditionalOnNoPush: boolean;
}
export interface HistoryWindow {
  games: number;
  average: number;
  median: number;
  consistency: number | null;
  hits: number | null;
  hitRate: number | null;
  hitGames: number;
  results: { date?: string; season: number; week: number; team: string; opponent: string; value: number; gameId: string; playerId: string }[];
}
export interface PlayerHistory {
  last5: HistoryWindow | null;
  last10: HistoryWindow | null;
  trend: number | null;
  homeAverage: number | null;
  awayAverage: number | null;
  opportunityAverage: number | null;
  roleGames: number;
  snapAverage: number | null;
  snapCounts: number[] | null;
  defense: { rank: number; teams: number; games: number; averageAllowed: number } | null;
  playingTime: 'nflverse' | 'unavailable';
}
export interface Candidate {
  quoteEvidence?:NormalizedQuote;
  availability?: {injurySnapshotAt:string|null;injuryTeamCovered:boolean;checkedAt:number};
  oddsProvider?: 'fanduelapi'; providerPropId?: string; providerEventId?: string; providerAsOf?: string; providerDelaySeconds?: number; providerSourceStatus?: string;
  id: string; name: string; pos: Pos; team: string; opp: string; gameId: string; kickoff: string;
  eventLabel?: string;
  resultGameId?: string; espnEventId?: string; espnPlayerId?: string;
  market: string; side: Side; line: number | null; odds: number; oddsAt: string;
  sample: number; mean: number; sd: number; injury?: string; source: 'live' | 'manual' | 'demo'; manualQuoteConfirmed?: boolean; historySource?: 'nflverse' | 'espn'; historyPlayerId?: string;
  marketP?: number; marketPSource?: 'no-vig' | 'single-side'; rosterVerified?: boolean; rosterStatus?: string;
  roleSupported?: boolean; roleGames?: number; scored?: Scored;
  eventVerified?: boolean; quoteVerified?: boolean; historyVerified?: boolean;
  verification?: {
    event: { id: string; kickoff: string; label: string };
    quote: { bookmaker: 'fanduel'; player: string; market: string; side: Side; line: number | null; odds: number; updatedAt: string };
    history: { source: 'nflverse' | 'espn'; playerId: string; market: string; line: number | null; gameIds: string[] };
  };
  history?: PlayerHistory;
}
export interface Ticket {
  status?: 'pending';
  purpose: 'test-research' | 'validated-research' | 'pregame-research' | 'manual-research';
  legs: Candidate[];
  decimal: number;
  american: number;
  jointP: number;
  jointSe: number;
  jointLower95: number;
  jointUpper95: number;
  indepP: number;
  ev: number;
  evLower95: number;
  score: number;
  priceBasis: 'product-of-individual-leg-prices';
  sportsbookQuoteVerified: false;
  warnings: string[];
}
export interface BuildResult { options: Ticket[]; missing: string[]; counts: Record<Pos, number> }
export interface FirstQuarterCandidate {
  quoteEvidence?:NormalizedQuote;
  position?:string;
  espnPlayerId?:string; rosterVerified?:boolean; rosterStatus?:string; injuryStatus?:string; injurySnapshotAt?:string|null;
  provider?:'fanduelapi'|'odds-api'|'propline'|'manual'; providerAsOf?:string; providerDelaySeconds?:number; historyPlayerId?:string;
  id: string;
  player: string;
  team: string;
  opponent: string;
  matchup: string;
  gameId: string;
  kickoff: string;
  market: string;
  side: 'Over' | 'Under' | 'AtLeast';
  line: number;
  odds: number;
  oddsAt: string;
  probability: number;
  sample: number;
  mean: number | null;
  hitRate: number | null;
  last5: { games: number; average: number; hits: number | null; hitRate: number | null; hitGames: number } | null;
  last10: { games: number; average: number; hits: number | null; hitRate: number | null; hitGames: number } | null;
  opportunityLabel: 'pass attempts' | 'rush attempts' | 'targets' | null;
  projectedOpportunities: number | null;
  defense: { rank: number; teams: number; games: number; averageAllowed: number; season: number } | null;
}
export interface FirstQuarterTicket {
  legs: FirstQuarterCandidate[];
  decimal: number;
  american: number;
  probability: number;
  warnings: string[];
}
export interface FirstQuarterBuildResult {
  options: FirstQuarterTicket[];
  missing: string[];
}
