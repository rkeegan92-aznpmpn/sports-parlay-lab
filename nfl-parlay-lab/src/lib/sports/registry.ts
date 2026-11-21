import { SPORT_IDS, type SportId, type SportModule } from './types.ts';
import { nfl } from './nfl.ts';
import { nba, mlb, nhl, mma } from './planned.ts';
const MODULES: Record<SportId, SportModule> = { nfl, nba, mlb, nhl, mma };
export const DEFAULT_SPORT: SportId = 'nfl';
export const isSportId = (v: unknown): v is SportId => typeof v === 'string' && (SPORT_IDS as readonly string[]).includes(v);
export const getSport = (id: SportId): SportModule => MODULES[id];
export const listSports = (): SportModule[] => SPORT_IDS.map((id) => MODULES[id]);
export const implementedSports = (): SportModule[] => listSports().filter((s) => s.status === 'implemented');
/** Unknown or missing input falls back to NFL so existing links/clients keep working. */
export const resolveSport = (v: unknown): SportModule => (isSportId(v) ? MODULES[v] : MODULES[DEFAULT_SPORT]);
