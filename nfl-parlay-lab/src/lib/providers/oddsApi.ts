// The Odds API v4. Docs: https://the-odds-api.com/liveapi/guides/v4/
export const BASE = 'https://api.the-odds-api.com/v4';
export const SPORT = 'americanfootball_nfl';
export const BOOKMAKER = 'fanduel';
export const DEFAULT_MARKETS = [
  'player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_reception_yds', 'player_receptions',
  'player_pass_yds_alternate', 'player_pass_tds_alternate', 'player_rush_yds_alternate', 'player_rush_attempts_alternate',
  'player_reception_yds_alternate', 'player_receptions_alternate', 'player_rush_attempts', 'player_anytime_td',
];
export const SUPPORTED_MARKETS=[...DEFAULT_MARKETS,'player_pass_rush_yds','player_pass_rush_yds_alternate',
  'player_pass_attempts','player_pass_completions','player_pass_interceptions','player_rush_tds','player_receiving_tds',
  'player_pass_attempts_alternate','player_pass_completions_alternate','player_pass_interceptions_alternate','player_rush_tds_alternate','player_receiving_tds_alternate',
];
export const FIRST_QUARTER_PLAYER_MARKETS = [
  'player_pass_yds_q1', 'player_rush_yds_q1', 'player_reception_yds_q1',
];
// Public NFL market list documents Q1 passing yards; do not probe guessed rushing/receiving keys.
export const DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS=['player_pass_yds_q1'];
export const FIRST_QUARTER_TOTAL_MARKETS = ['team_totals_q1', 'totals_q1'];
export const FIRST_QUARTER_MARKETS = [...FIRST_QUARTER_PLAYER_MARKETS, ...FIRST_QUARTER_TOTAL_MARKETS];
export class OddsApiError extends Error {
  status: number;
  code?: string;
  remaining?: string;
  retryAfterMs?: number;
  constructor(message: string, status: number) { super(message); this.name = 'OddsApiError'; this.status = status; }
}
export interface ApiEvent { id: string; commence_time: string; home_team: string; away_team: string }
export interface PropRow { player: string; market: string; side: 'Over' | 'Under' | 'Yes' | 'AtLeast'; line: number | null; odds: number; updatedAt: string }
export interface FirstQuarterPropRow { participant: string; market: string; side: 'Over' | 'Under' | 'AtLeast'; line: number; odds: number; updatedAt: string }
export interface EventSchedule { events: ApiEvent[]; remaining: string | null }
export interface FirstQuarterMarkets {
  playerRows: FirstQuarterPropRow[];
  totalRows: FirstQuarterPropRow[];
  requestedMarketKeys: string[];
  availableMarketKeys: string[];
  unmappedPlayerMarketKeys: string[];
  playerStatus: 'available' | 'none' | 'unsupported';
  totalStatus: 'available' | 'none' | 'unsupported' | 'not-requested';
  remaining: string | null;
}
type Fetch = typeof fetch;

async function get(path: string, params: Record<string, string>, key: string, f: Fetch) {
  const url = `${BASE}${path}?${new URLSearchParams({ ...params, apiKey: key })}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let res: Response;
    try { res = await f(url, { signal: controller.signal, cache: 'no-store' }); }
    catch { throw new OddsApiError(controller.signal.aborted ? 'Odds API request timed out' : 'Odds API network request failed', 0); }
    if (!res.ok) {
      // Never echo provider message text: it can contain the credential-bearing URL.
      let body: {error_code?:unknown} = {};
      try { body = await res.json(); } catch { /* Status alone still diagnoses the failure. */ }
      const allowed=['INVALID_KEY','MISSING_KEY','DEACTIVATED_KEY','OUT_OF_USAGE_CREDITS','EXCEEDED_FREQ_LIMIT','INVALID_MARKET','INVALID_MARKETS','INVALID_BOOKMAKERS','INVALID_REGIONS'];
      const code=typeof body?.error_code==='string' && allowed.includes(body.error_code)?body.error_code:undefined;
      const why=code==='OUT_OF_USAGE_CREDITS'?'Odds API subscription credits exhausted; restore credits or wait for the subscription reset'
        :code==='DEACTIVATED_KEY'?'Odds API key is deactivated; verify the subscription'
        :code==='INVALID_KEY'||code==='MISSING_KEY'?'Invalid or missing Odds API key'
        :res.status===401?'Odds API authentication/subscription request rejected (401); inspect the provider error code and account credits'
        :res.status===403?'Odds API subscription or endpoint access denied (403)'
        :res.status===422?'Market or parameters not available on this endpoint/plan'
        :res.status===429?'Odds API rate or quota limit reached (429)'
        :`Odds API HTTP ${res.status}`;
      const error=new OddsApiError(why,res.status);error.code=code;
      const remaining=res.headers.get('x-requests-remaining');
      if(remaining && /^\d+(?:\.\d+)?$/.test(remaining)) error.remaining=remaining;
      const retry=res.headers.get('retry-after');
      const retryMs=retry && /^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-Date.now():NaN;
      // Preserve valid provider deadlines beyond one day; never shorten an explicit Retry-After.
      error.retryAfterMs=Number.isSafeInteger(retryMs)&&retryMs>0&&retryMs<=8640000000000000-Date.now()?retryMs:60_000;
      throw error;
    }
    let data: unknown;
    try { data = await res.json(); } catch { throw new OddsApiError('Malformed or interrupted JSON from Odds API', res.status); }
    return { data, remaining: res.headers?.get?.('x-requests-remaining') ?? null };
  } finally {
    clearTimeout(timeout);
  }
}
export async function fetchEvents(key: string, f: Fetch = fetch): Promise<EventSchedule> {
  const r = await get(`/sports/${SPORT}/events`, {}, key, f);
  if (!Array.isArray(r.data)) throw new OddsApiError('Unexpected events response', 200);
  return { events: r.data as ApiEvent[], remaining: r.remaining };
}
export async function fetchEventProps(key: string, eventId: string, markets: string[] = DEFAULT_MARKETS, f: Fetch = fetch) {
  const r = await get(`/sports/${SPORT}/events/${eventId}/odds`, { regions: 'us', markets: markets.join(','), bookmakers: BOOKMAKER, oddsFormat: 'american' }, key, f);
  return { rows: parseProps(r.data), marketKeys: returnedMarketKeys(r.data), remaining: r.remaining };
}
export async function fetchFirstQuarterProps(
  key: string,
  eventId: string,
  f: Fetch = fetch,
  markets: string[] = FIRST_QUARTER_MARKETS,
) {
  const r = await get(`/sports/${SPORT}/events/${eventId}/odds`, {
    regions: 'us', markets: markets.join(','), bookmakers: BOOKMAKER, oddsFormat: 'american',
  }, key, f);
  return { rows: parseFirstQuarterProps(r.data), marketKeys: returnedMarketKeys(r.data), remaining: r.remaining };
}
/** Player markets are prioritized; Q1 totals are queried separately only when no player lines are returned. */
export async function fetchFirstQuarterMarkets(key: string, eventId: string, f: Fetch = fetch): Promise<FirstQuarterMarkets> {
  let playerRows: FirstQuarterPropRow[] = [];
  let remaining: string | null = null;
  const requestedMarketKeys = new Set<string>();
  const availableMarketKeys = new Set<string>();
  let playerStatus: FirstQuarterMarkets['playerStatus'] = 'none';
  DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS.forEach((market) => requestedMarketKeys.add(market));
  try {
    const result = await fetchFirstQuarterProps(key, eventId, f, DOCUMENTED_FIRST_QUARTER_PLAYER_MARKETS);
    result.marketKeys.forEach((market) => availableMarketKeys.add(market));
    playerRows = result.rows.filter((row) => FIRST_QUARTER_PLAYER_MARKETS.includes(row.market));
    remaining = result.remaining;
    playerStatus = playerRows.length ? 'available' : 'none';
  } catch (error) {
    if (!(error instanceof OddsApiError && error.status === 422)) throw error;
    playerStatus = 'unsupported'; // Do not repeat the same rejected request or guess additional keys.
  }
  if (playerRows.length) {
    const keys = [...availableMarketKeys].sort();
    return {
      playerRows,
      totalRows: [],
      requestedMarketKeys: [...requestedMarketKeys],
      availableMarketKeys: keys,
      unmappedPlayerMarketKeys: unmappedQuarterPlayerKeys(keys),
      playerStatus,
      totalStatus: 'not-requested',
      remaining,
    };
  }

  const totalRows: FirstQuarterPropRow[] = [];
  let successfulTotalRequests = 0;
  for (const market of FIRST_QUARTER_TOTAL_MARKETS) {
    requestedMarketKeys.add(market);
    try {
      const result = await fetchFirstQuarterProps(key, eventId, f, [market]);
      result.marketKeys.forEach((key) => availableMarketKeys.add(key));
      totalRows.push(...result.rows.filter((row) => row.market === market));
      remaining = result.remaining ?? remaining;
      successfulTotalRequests += 1;
    } catch (error) {
      if (!(error instanceof OddsApiError && error.status === 422)) throw error;
    }
  }
  const totalStatus: FirstQuarterMarkets['totalStatus'] = totalRows.length
    ? 'available'
    : successfulTotalRequests ? 'none' : 'unsupported';
  const keys = [...availableMarketKeys].sort();
  return {
    playerRows,
    totalRows,
    requestedMarketKeys: [...requestedMarketKeys],
    availableMarketKeys: keys,
    unmappedPlayerMarketKeys: unmappedQuarterPlayerKeys(keys),
    playerStatus,
    totalStatus,
    remaining,
  };
}
function returnedMarketKeys(json: any): string[] {
  const keys: string[] = (json?.bookmakers ?? [])
    .filter((bookmaker: any) => bookmaker?.key === BOOKMAKER)
    .flatMap((bookmaker: any) => bookmaker.markets ?? [])
    .map((market: any) => market?.key)
    .filter((market: unknown): market is string => typeof market === 'string');
  return [...new Set<string>(keys)].sort();
}
function unmappedQuarterPlayerKeys(keys: string[]): string[] {
  return keys.filter((market) =>
    market.startsWith('player_') && /_(?:q1|1q|qtr1|quarter_?1|1st_q(?:tr|uarter)|1stquarter|first_quarter|firstquarter)(?:_alternate)?$/i.test(market) &&
    !canonicalQuarterPlayerMarket(market),
  );
}
function canonicalQuarterPlayerMarket(market: string): string | undefined {
  const match = /^(player_(?:pass_yds|rush_yds|reception_yds))_(?:q1|1q|qtr1|quarter_?1|1st_q(?:tr|uarter)|1stquarter|first_quarter|firstquarter)(?:_alternate)?$/i.exec(market);
  if (!match) return undefined;
  const key = `${match[1].toLowerCase()}_q1`;
  return FIRST_QUARTER_PLAYER_MARKETS.includes(key) ? key : undefined;
}
/** Parses only explicitly quarter-scoped FanDuel markets; full-game markets are never considered. */
export function parseFirstQuarterProps(json: any): FirstQuarterPropRow[] {
  const rows: FirstQuarterPropRow[] = [];
  for (const bookmaker of json?.bookmakers ?? []) {
    if (bookmaker.key !== BOOKMAKER) continue;
    for (const market of bookmaker.markets ?? []) {
      const canonicalPlayerMarket = canonicalQuarterPlayerMarket(market.key);
      const canonicalMarket = canonicalPlayerMarket ??
        (FIRST_QUARTER_TOTAL_MARKETS.includes(market.key) ? market.key : undefined);
      if (!canonicalMarket) continue;
      for (const outcome of market.outcomes ?? []) {
        const side = outcome.name;
        const participant = canonicalMarket === 'totals_q1'
          ? 'Game total'
          : typeof outcome.description === 'string' ? outcome.description.trim() : '';
        const updatedAt = market.last_update ?? bookmaker.last_update;
        if (!['Over', 'Under'].includes(side) || !participant || typeof outcome.point !== 'number' ||
            !Number.isFinite(outcome.point) || typeof outcome.price !== 'number' ||
            !Number.isFinite(outcome.price) || Math.abs(outcome.price) < 100 || typeof updatedAt !== 'string' ||
            !Number.isFinite(Date.parse(updatedAt))) continue;
        rows.push({ participant, market: canonicalMarket, side, line: outcome.point, odds: outcome.price, updatedAt });
      }
    }
  }
  return rows;
}
/** Keeps FanDuel only; silently drops malformed outcomes rather than guessing. */
export function parseProps(json: any): PropRow[] {
  const rows: PropRow[] = [];
  for (const b of json?.bookmakers ?? []) {
    if (b.key !== BOOKMAKER) continue;
    for (const m of b.markets ?? []) {
      if (!SUPPORTED_MARKETS.includes(m.key)) continue;
      for (const o of m.outcomes ?? []) {
      const side = o.name;
      const updatedAt = m.last_update ?? b.last_update;
      if (!['Over', 'Under', 'Yes','AtLeast'].includes(side) || typeof o.price !== 'number' || !Number.isFinite(o.price) ||
          Math.abs(o.price) < 100 || !o.description ||
          typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) continue;
      if (side !== 'Yes' && (typeof o.point !== 'number' || !Number.isFinite(o.point))) continue;
      rows.push({ player: o.description, market: m.key, side, line: typeof o.point === 'number' ? o.point : null, odds: o.price, updatedAt });
      }
    }
  }
  return rows;
}
