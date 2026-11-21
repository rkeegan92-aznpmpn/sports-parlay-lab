export const SPORTS = ['NFL', 'NBA', 'MLB', 'MMA'] as const;
export type SportId = (typeof SPORTS)[number];

export type MarketDefinition = {
  key: string;
  label: string;
  unit: 'yards' | 'points' | 'count' | 'rounds';
  liveSupported: boolean;
};

export const MARKET_CATALOG: Record<SportId, readonly MarketDefinition[]> = {
  NFL: [
    { key: 'player_pass_yds', label: 'Passing yards', unit: 'yards', liveSupported: false },
    { key: 'player_rush_yds', label: 'Rushing yards', unit: 'yards', liveSupported: false },
    { key: 'player_reception_yds', label: 'Receiving yards', unit: 'yards', liveSupported: false },
  ],
  NBA: [
    { key: 'player_points', label: 'Player points', unit: 'points', liveSupported: false },
    { key: 'player_rebounds', label: 'Player rebounds', unit: 'count', liveSupported: false },
    { key: 'player_assists', label: 'Player assists', unit: 'count', liveSupported: false },
  ],
  MLB: [
    { key: 'batter_hits', label: 'Batter hits', unit: 'count', liveSupported: false },
    { key: 'pitcher_strikeouts', label: 'Pitcher strikeouts', unit: 'count', liveSupported: false },
    { key: 'batter_total_bases', label: 'Total bases', unit: 'count', liveSupported: false },
  ],
  MMA: [
    { key: 'fight_rounds', label: 'Fight rounds', unit: 'rounds', liveSupported: false },
    { key: 'fighter_takedowns', label: 'Takedowns', unit: 'count', liveSupported: false },
  ],
};

export function isSportId(value: string): value is SportId {
  return SPORTS.some((sport) => sport === value);
}
