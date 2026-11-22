import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
const SPORTS = {
  NFL: { key: 'americanfootball_nfl', markets: 'h2h,spreads,totals,player_pass_yds,player_rush_yds,player_reception_yds' },
  NBA: { key: 'basketball_nba', markets: 'h2h,spreads,totals,player_points,player_rebounds,player_assists' },
  MLB: { key: 'baseball_mlb', markets: 'h2h,spreads,totals,batter_hits,pitcher_strikeouts,batter_total_bases' },
  MMA: { key: 'mma_mixed_martial_arts', markets: 'h2h,totals' },
} as const;
type Sport = keyof typeof SPORTS;
type Snapshot = { fetchedAt: string; data: unknown; quotaRemaining: string | null };
const snapshots = new Map<Sport, Snapshot>();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const sportParam = request.nextUrl.searchParams.get('sport')?.toUpperCase() ?? '';
  if (!(sportParam in SPORTS)) return NextResponse.json({ error: 'Unsupported sport' }, { status: 400 });
  const sport = sportParam as Sport;
  const cached = snapshots.get(sport);
  const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS;
  if (fresh) return NextResponse.json({ sport, source: 'PropLine', status: 'cached', ...cached });
  const key = process.env.PROPLINE_API_KEY;
  if (!key) return NextResponse.json({ sport, source: 'PropLine', status: 'not_configured', fetchedAt: cached?.fetchedAt ?? null, data: cached?.data ?? null, error: 'Add PROPLINE_API_KEY to server environment' });
  const config = SPORTS[sport];
  const url = new URL(`https://api.prop-line.com/v1/sports/${config.key}/odds`);
  url.searchParams.set('markets', config.markets);
  try {
    const response = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!response.ok) return NextResponse.json({ sport, source: 'PropLine', status: 'upstream_error', fetchedAt: cached?.fetchedAt ?? null, data: cached?.data ?? null, error: `Provider returned HTTP ${response.status}` }, { status: 502 });
    const data: unknown = await response.json();
    const snapshot = { fetchedAt: new Date().toISOString(), data, quotaRemaining: response.headers.get('x-daily-remaining') };
    snapshots.set(sport, snapshot);
    return NextResponse.json({ sport, source: 'PropLine', status: 'updated', ...snapshot });
  } catch {
    return NextResponse.json({ sport, source: 'PropLine', status: 'unavailable', fetchedAt: cached?.fetchedAt ?? null, data: cached?.data ?? null, error: 'Provider request failed' }, { status: 502 });
  }
}
