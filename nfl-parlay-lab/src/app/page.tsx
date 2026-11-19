'use client';
import PaperBettingWorkspace from './components/PaperBettingWorkspace';
import MultiProviderWorkspace from './components/MultiProviderWorkspace';
import MarketExplorer from './components/MarketExplorer';
import FirstQuarterWorkspace from './components/FirstQuarterWorkspace';
import EvaluationDashboard from './components/EvaluationDashboard';
import FreeWorkspace from './components/FreeWorkspace';
import FanDuelWorkspace from './components/FanDuelWorkspace';
import ValidationPanel from './components/ValidationPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildResult, Candidate, FirstQuarterBuildResult, FirstQuarterCandidate, FirstQuarterTicket, GroupedPipelineRejection, Kind, Ticket } from '@/lib/types.ts';
import type { SavedTicket, SaveMessage } from '@/lib/savedTickets.ts';
import type { FirstQuarterPropRow } from '@/lib/providers/oddsApi.ts';
import { eligible, makeTicket, CONFIG, validateLegs } from '@/lib/optimizer.ts';
import { fmtOdds, impliedProb, payout } from '@/lib/odds.ts';

interface Data {
  calibration?: unknown;
  pipelineRejections?: GroupedPipelineRejection[];
  testMode: boolean;
  mode: 'live' | 'demo';
  notes: string[];
  games: { id: string; label: string; kickoff: string; status: 'available' | 'none' | 'unsupported' | 'error' | 'not-scanned'; markets: string[]; returnedMarketKeys: string[]; unsupportedMarketKeys: string[]; props: number }[];
  availableDates: string[];
  selectedDate: string;
  diagnostics: Record<string, number | string>;
  modelValidation: { status: 'validated' | 'unvalidated'; sample: number; warnings: string[]; tracking?: Record<string, string | number> };
  scanned: number;
  staleCount: number;
  pool: Candidate[];
  quotes: Candidate[];
  valueRanking?: { candidate: Candidate; qualifiedFor: Kind[]; warnings: string[] }[];
  rejectedProps?: { candidate: Candidate; reasons: string[]; count: number }[];
  best: BuildResult;
  aggr: BuildResult;
}
interface FirstQuarterData {
  candidates: FirstQuarterCandidate[];
  best: FirstQuarterBuildResult;
  aggressive: FirstQuarterBuildResult;
  missing: string[];
  playerPropsAvailable: boolean;
  totals: ({ game: string } & FirstQuarterPropRow)[];
  oddsApiCreditsRemaining?: string | number;
}
const KINDS: Kind[] = ['best', 'aggr'];
const pc = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const marketLabel = (market: string) => market.replace(/^player_/, '').replace(/_alternate$/, ' (alternate)').replace(/_/g, ' ');
const label = (c: Candidate) => marketLabel(c.market) + (c.line == null ? '' : ` ${c.side} ${c.line}`);
const dateLabel = (date: string) => date === 'ALL' ? 'All upcoming games' : new Date(`${date}T00:00:00Z`).toLocaleDateString();
const confidenceReason = (c: Candidate) =>
  `smoothed empirical estimate from ${c.scored?.historicalHitGames ?? 0} non-push outcomes; observed hit rate is shown separately and is not itself a predictive probability`;

const saveRequestError = (error: unknown, fallback: string) => {
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection and retry.';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'The request timed out. Refresh Saved Tickets to check whether it completed before trying again.';
  return error instanceof Error ? error.message : fallback;
};

export default function Home() {
 const [workspace,setWorkspace]=useState<'free'|'live'|'paper'>('free');
 return <><nav className="flex flex-wrap gap-3 p-3"><button className="rounded border border-line p-3" onClick={()=>setWorkspace('free')}>Free data + manual odds</button><button className="rounded border border-line p-3" onClick={()=>setWorkspace('live')}>Live API workspace (requires credits)</button><button className="rounded border border-line p-3" onClick={()=>setWorkspace('paper')}>Paper Betting</button></nav>{workspace==='paper'?<PaperBettingWorkspace/>:<><MultiProviderWorkspace/><MarketExplorer/><FirstQuarterWorkspace/>{workspace==='free'?<><FanDuelWorkspace/><FreeWorkspace/></>:<LiveHome/>}<EvaluationDashboard/></>}</>;
}
function LiveHome() {
  const [data, setData] = useState<Data | null>(null);
  const [mode, setMode] = useState<'live' | 'demo' | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [game, setGame] = useState('ALL');
  const [date, setDate] = useState('');
  const [idx, setIdx] = useState<Record<Kind, number>>({ best: 0, aggr: 0 });
  const [edit, setEdit] = useState<Partial<Record<Kind, Ticket>>>({});
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedTickets, setSavedTickets] = useState<SavedTicket[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [saving, setSaving] = useState<Record<Kind, boolean>>({ best: false, aggr: false });
  const [saveMessages, setSaveMessages] = useState<Partial<Record<Kind, SaveMessage>>>({});
  const savingRef = useRef(new Set<Kind>());
  const historyRequestRef = useRef(0);
  const [bt, setBt] = useState<any>(null);
  const [firstQuarter, setFirstQuarter] = useState<FirstQuarterData | null>(null);
  const [firstQuarterError, setFirstQuarterError] = useState('');
  const [firstQuarterLoading, setFirstQuarterLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const firstQuarterRequestRef = useRef<AbortController | null>(null);

  const resetFirstQuarter = () => {
    firstQuarterRequestRef.current?.abort();
    firstQuarterRequestRef.current = null;
    setFirstQuarter(null);
    setFirstQuarterLoading(false);
  };

  const load = useCallback(async (refresh = false) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setErr('');
    setNotice('');
    setLoading(true);
    try {
      const params = new URLSearchParams({ game });
      if (date) params.set('date', date);
      if (refresh) params.set('refresh', '1');
      if (testMode) params.set('testMode', '1');
      const r = await fetch(`/api/tickets?${params}`, {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!r.ok) {
        const failure = await r.json().catch(() => null) as { mode?: 'live' | 'demo'; error?: string } | null;
        if (failure?.mode === 'live' || failure?.mode === 'demo') setMode(failure.mode);
        throw new Error(failure?.error || `HTTP ${r.status}`);
      }
      const response = await r.json() as Partial<Data>;
      if (!response.best || !Array.isArray(response.best.options) || !response.aggr || !Array.isArray(response.aggr.options)) {
        throw new Error('Ticket API returned an invalid response.');
      }
      const today = new Date().toISOString().slice(0, 10);
      const next: Data = {
        ...response,
        testMode: response.testMode === true,
        mode: response.mode === 'live' ? 'live' : 'demo',
        notes: Array.isArray(response.notes) ? response.notes : [],
        games: Array.isArray(response.games)
          ? response.games.map((g) => ({
            ...g,
            markets: Array.isArray(g.markets) ? g.markets : [],
            returnedMarketKeys: Array.isArray(g.returnedMarketKeys) ? g.returnedMarketKeys : [],
            unsupportedMarketKeys: Array.isArray(g.unsupportedMarketKeys) ? g.unsupportedMarketKeys : [],
          }))
          : [],
        availableDates: Array.isArray(response.availableDates) ? response.availableDates : [],
        selectedDate: typeof response.selectedDate === 'string' ? response.selectedDate : date || today,
        diagnostics: response.diagnostics && typeof response.diagnostics === 'object' ? response.diagnostics : {},
        modelValidation: response.modelValidation && typeof response.modelValidation.status === 'string'
          ? response.modelValidation as Data['modelValidation']
          : { status: 'unvalidated', sample: 0, warnings: ['Calibration validation status was not returned by the API.'] },
        scanned: typeof response.scanned === 'number' ? response.scanned : 0,
        staleCount: typeof response.staleCount === 'number' ? response.staleCount : 0,
        pool: Array.isArray(response.pool) ? response.pool : [],
        quotes: Array.isArray(response.quotes) ? response.quotes : [],
        valueRanking: Array.isArray(response.valueRanking) ? response.valueRanking : [],
        rejectedProps: Array.isArray(response.rejectedProps) ? response.rejectedProps : [],
        best: { ...response.best, options: response.best.options, missing: Array.isArray(response.best.missing) ? response.best.missing : [] },
        aggr: { ...response.aggr, options: response.aggr.options, missing: Array.isArray(response.aggr.missing) ? response.aggr.missing : [] },
      };
      if (requestRef.current !== request) return;
      setData(next);
      if (next.calibration) setBt(next.calibration);
      setMode(next.mode);
      if (!date) setDate(next.selectedDate);
      setIdx({ best: 0, aggr: 0 });
      setEdit({});
      const available = Number(next.best.options.length > 0) + Number(next.aggr.options.length > 0);
      setNotice(available === 2
        ? 'Both Best Six and Aggressive Six tickets are ready.'
        : `Generation complete: ${available} of 2 tickets available. See the ticket cards for missing-data details.`);
    } catch (e) {
      if (!request.signal.aborted && requestRef.current === request) {
        setErr(e instanceof Error ? e.message : 'Unable to generate tickets.');
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [date, game, testMode]);
  const loadFirstQuarter = async (refresh = false) => {
    firstQuarterRequestRef.current?.abort();
    const request = new AbortController();
    firstQuarterRequestRef.current = request;
    setFirstQuarterError('');
    setFirstQuarterLoading(true);
    try {
      const params = new URLSearchParams({ provider:'odds-api', game, date: date || 'ALL' });
      if (refresh) params.set('refresh', '1');
      const response = await fetch(`/api/first-quarter?${params}`, { cache: 'no-store', signal: request.signal });
      const result = await response.json() as FirstQuarterData & { error?: string };
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      if (!result.best || !result.aggressive || !Array.isArray(result.candidates)) {
        throw new Error('First-quarter API returned an invalid response.');
      }
      if (firstQuarterRequestRef.current !== request) return;
      setFirstQuarter(result);
    } catch (error) {
      if (!request.signal.aborted && firstQuarterRequestRef.current === request) {
        setFirstQuarterError(error instanceof Error ? error.message : 'Unable to load first-quarter markets.');
      }
    } finally {
      if (firstQuarterRequestRef.current === request) {
        firstQuarterRequestRef.current = null;
        setFirstQuarterLoading(false);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
      firstQuarterRequestRef.current?.abort();
    };
  }, [load]);

  const ticket = (k: Kind): Ticket | undefined => {
    if (!data || data.mode !== 'live') return undefined;
    const candidate = edit[k] ?? data[k].options[idx[k] % Math.max(1, data[k].options.length)];
    if (!candidate || validateLegs(candidate.legs).length ||
        candidate.legs.some((leg) => !eligible(k, leg, Date.now()) ||
          leg.eventVerified !== true || leg.quoteVerified !== true || leg.historyVerified !== true)) return undefined;
    return candidate;
  };
  const replace = (k: Kind, i: number) => {
    const t = ticket(k); if (!t || !data) return;
    const used = new Set(t.legs.map((l) => l.name)), now = Date.now();
    const alt = data.pool.filter((c) => c.pos === t.legs[i].pos && !used.has(c.name) && eligible(k, c, now))
      .sort((a, b) => (k === 'best' ? b.scored!.p - a.scored!.p : b.scored!.ev - a.scored!.ev))
      .find((c) => {
        try {
          const replacement = makeTicket(t.legs.map((l, n) => (n === i ? c : l)), k, { pregameResearch: true, testMode: data.testMode, modelValidated: data.modelValidation.status === 'validated' });
          return c.source !== 'live' || replacement.ev > 0;
        } catch { return false; }
      });
    if (!alt) return alert('No eligible replacement for that position.');
    setEdit({ ...edit, [k]: makeTicket(t.legs.map((l, n) => (n === i ? alt : l)), k, { seed: 555, pregameResearch: true, testMode: data.testMode, modelValidated: data.modelValidation.status === 'validated' }) });
  };
  const loadSaved = useCallback(async (before?: number) => {
    const request = ++historyRequestRef.current;
    setHistoryLoading(true); setHistoryError('');
    try {
      const response = await fetch(`/api/saved${before ? `?before=${before}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Unable to load saved tickets (HTTP ${response.status}).`);
      if (!Array.isArray(body)) throw new Error('Saved history returned an invalid response. Retry loading history.');
      if (request !== historyRequestRef.current) return;
      const rows = body as SavedTicket[];
      setSavedTickets((previous) => before ? [...previous, ...rows.filter((row) => !previous.some((item) => item.id === row.id))] : rows);
      setHistoryCursor(rows.length === 50 ? rows[rows.length - 1].id : null);
    } catch (error) {
      if (request === historyRequestRef.current) setHistoryError(saveRequestError(error, 'Unable to load saved tickets. Retry loading history.'));
    } finally { if (request === historyRequestRef.current) setHistoryLoading(false); }
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  const save = async (k: Kind) => {
    if (savingRef.current.has(k)) return;
    const t = ticket(k);
    if (!t) { setSaveMessages((previous) => ({ ...previous, [k]: { type: 'error', text: 'This ticket is no longer eligible. Refresh data and generate again before saving.' } })); return; }
    savingRef.current.add(k);
    setSaving((previous) => ({ ...previous, [k]: true }));
    setSaveMessages((previous) => ({ ...previous, [k]: undefined }));
    try {
      const response = await fetch('/api/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000), body: JSON.stringify({ kind: k, legs: t.legs, jointP: t.jointP, decimal: t.decimal, purpose: t.purpose }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Unable to save ticket (HTTP ${response.status}). Try again.`);
      if (!Number.isSafeInteger(body?.id)) throw new Error('Save could not be confirmed. Reload Saved Tickets before trying again.');
      setSaveMessages((previous) => ({ ...previous, [k]: { type: 'success', text: `${CONFIG[k].label} saved to Saved Tickets (#${body.id}).` } }));
      await loadSaved();
    } catch (error) {
      setSaveMessages((previous) => ({ ...previous, [k]: { type: 'error', text: saveRequestError(error, 'Unable to save ticket. Try again.') } }));
    } finally {
      savingRef.current.delete(k);
      setSaving((previous) => ({ ...previous, [k]: false }));
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-3 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">NFL Parlay <span className="text-neon">Lab</span></h1>
        <span className="rounded border border-amber-400 bg-amber-950/40 px-2 py-1 text-xs font-bold text-amber-200">
          PRE-GAME RESEARCH: {bt?.validationStatus === 'validated' ? 'BACKTESTED' : 'UNVALIDATED MODEL'}
        </span>
        {mode && <span className={`rounded-full border px-2 py-0.5 text-xs ${mode === 'live' ? 'border-neon text-neon' : 'border-amber-400 text-amber-400'}`}>{mode === 'live' ? 'LIVE DATA' : 'DEMO DATA'}</span>}
        {data?.diagnostics.oddsApiCreditsRemaining != null && <span className="text-xs text-slate-400">API credits remaining: {data.diagnostics.oddsApiCreditsRemaining}</span>}
      </header>
      <ValidationPanel />
      <label className="block rounded border border-amber-400 bg-amber-950/40 p-3 text-sm text-amber-200">
        <input type="checkbox" checked={testMode} onChange={(e) => { requestRef.current?.abort(); setTestMode(e.target.checked); setData(null); setEdit({}); setNotice(''); }} />{' '}
        TEST MODE — explicitly label tickets as test research. Not validated recommendations; do not use for real-money wagers. Live data and player checks still apply.
      </label>
      <div className="flex flex-wrap gap-2">
        <select aria-label="NFL game date" className="rounded-lg border border-line bg-card p-2" value={date || data?.selectedDate || ''} onChange={(e) => { setDate(e.target.value); setGame('ALL'); resetFirstQuarter(); }}>
          <option value="ALL">All upcoming games</option>{data?.availableDates.map((day) => <option key={day} value={day}>{dateLabel(day)}</option>)}
        </select>
        <select aria-label="NFL game" className="rounded-lg border border-line bg-card p-2" value={game} onChange={(e) => { setGame(e.target.value); resetFirstQuarter(); }}>
          <option value="ALL">All games</option>{data?.games.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <button className="rounded-lg border border-line bg-card p-2 disabled:cursor-wait disabled:opacity-60" onClick={() => void load(true)} disabled={loading}>Refresh Data</button>
        <button className="rounded-lg border border-neon bg-emerald-950 p-2 font-semibold text-neon disabled:cursor-wait disabled:opacity-60" onClick={() => void load()} disabled={loading}>
          {loading ? 'Generating tickets…' : 'Generate Both Tickets'}
        </button>
        <button className="rounded-lg border border-blue bg-blue-950 p-2 font-semibold text-blue disabled:cursor-wait disabled:opacity-60" onClick={() => void loadFirstQuarter()} disabled={firstQuarterLoading}>
          {firstQuarterLoading ? 'Loading 1Q markets…' : 'Generate 1Q Tickets'}
        </button>
      </div>
      {loading && <div role="status" aria-live="polite" className="rounded border border-line p-2 text-sm">Generating both tickets…</div>}
      {!loading && notice && <div role="status" aria-live="polite" className="rounded border border-neon p-2 text-sm text-neon">{notice}</div>}
      {err && <div role="alert" className="rounded border border-red-500 p-2 text-sm text-red-400">Error: {err}</div>}
      {firstQuarterError && <div role="alert" className="rounded border border-red-500 p-2 text-sm text-red-400">First-quarter error: {firstQuarterError}</div>}
      <section className="rounded-xl border border-blue bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-bold text-blue">First-quarter analysis</h2><p className="text-xs text-slate-400">Only live FanDuel 1Q lines are used. Select Generate 1Q Tickets to make the separate, cached quarter-market request.</p></div>
          {firstQuarter?.oddsApiCreditsRemaining != null && <span className="text-xs text-slate-400">API credits remaining: {firstQuarter.oddsApiCreditsRemaining}</span>}
        </div>
        {!firstQuarter && <div className="mt-2 text-sm text-slate-400">First-quarter markets have not been requested. No full-game lines or averages will be substituted.</div>}
        {firstQuarter?.missing.map((reason, index) => <div key={index} className="mt-2 text-sm text-amber-300">{reason}</div>)}
        {firstQuarter && !firstQuarter.playerPropsAvailable && <div className="mt-2 rounded border border-amber-400 bg-amber-950/30 p-2 text-sm text-amber-200">
          FanDuel Q1 player props are unavailable for these games. Full-game player markets were not substituted.
          {firstQuarter.totals.length > 0 && ' Available first-quarter totals are shown separately below and are not player props.'}
        </div>}
        {firstQuarter && firstQuarter.totals.length > 0 && <section className="mt-3 rounded border border-line p-2">
          <h3 className="font-semibold">First-quarter totals only — not player props</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {firstQuarter.totals.map((total, index) => <article key={`${total.game}:${total.market}:${total.participant}:${total.side}:${total.line}:${index}`} className="rounded bg-bg p-2 text-sm">
              <b>{total.game}</b>
              <div>{total.market === 'totals_q1' ? '1Q game total' : '1Q team total'} · {total.participant}</div>
              <div>{total.side} {total.line} · FanDuel {fmtOdds(total.odds)}</div>
            </article>)}
          </div>
        </section>}
        {firstQuarter && <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <FirstQuarterTicketCard title="Best 1Q Triple" description="Three selections ranked by estimated combined probability." result={firstQuarter.best} />
          <FirstQuarterTicketCard title="Aggressive 1Q Triple" description="Higher payout combinations; every selection requires at least four verified first-quarter games and supporting probability." result={firstQuarter.aggressive} />
        </div>}
        {firstQuarter && firstQuarter.candidates.length > 0 && <div className="mt-3">
          <h3 className="font-semibold">Available FanDuel first-quarter selections</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {firstQuarter.candidates.map((candidate) => <article key={candidate.id} className="rounded border border-line p-2 text-sm">
              <div className="flex justify-between gap-2"><b>{candidate.player}</b><b>{fmtOdds(candidate.odds)}</b></div>
              <div className="text-xs text-slate-400">{candidate.matchup}</div>
              <div>{candidate.market} {candidate.side} {candidate.line}</div>
              <div className="text-xs text-slate-400">Estimated probability {pc(candidate.probability)} · {candidate.sample ? `Q1 history n=${candidate.sample}, avg ${candidate.mean?.toFixed(1)}, hit ${candidate.hitRate == null ? 'n/a' : pc(candidate.hitRate)}` : 'Q1 historical split unavailable; odds-based estimate only'}.</div>
              {candidate.last5 && <div className="text-xs text-slate-300">
                Last 5 Q1 games: avg {candidate.last5.average.toFixed(1)}, hit {candidate.last5.hitRate == null ? 'n/a (pushes)' : `${pc(candidate.last5.hitRate)} (${candidate.last5.hits}/${candidate.last5.hitGames} non-push games)`}.
              </div>}
              {candidate.last10 && <div className="text-xs text-slate-300">
                Last 10 Q1 games: avg {candidate.last10.average.toFixed(1)}, hit {candidate.last10.hitRate == null ? 'n/a (pushes)' : `${pc(candidate.last10.hitRate)} (${candidate.last10.hits}/${candidate.last10.hitGames} non-push games)`}.
              </div>}
              {candidate.opportunityLabel && <div className="text-xs text-slate-400">
                Projected Q1 {candidate.opportunityLabel}/game: {candidate.projectedOpportunities == null ? 'unavailable' : candidate.projectedOpportunities.toFixed(1)} (historical Q1 opportunities only).
              </div>}
              {candidate.opportunityLabel && <div className="text-xs text-slate-400">
                {candidate.defense
                  ? `Opponent Q1 defense: ${candidate.defense.averageAllowed.toFixed(1)} ${candidate.market.replace(/^1Q /, '')} allowed/game, rank ${candidate.defense.rank}/${candidate.defense.teams} (${candidate.defense.games} games in ${candidate.defense.season}; rank 1 allows least).`
                  : 'Opponent Q1 defensive trend unavailable (fewer than 4 verified games or missing historical data).'}
              </div>}
            </article>)}
          </div>
        </div>}
        {(firstQuarter || firstQuarterError) && <button className="mt-3 rounded border border-line px-2 py-1 text-sm disabled:opacity-60" disabled={firstQuarterLoading} onClick={() => void loadFirstQuarter(true)}>Refresh 1Q Markets</button>}
      </section>
      {data && <div className="rounded border-l-4 border-amber-400 bg-amber-950/30 p-2 text-sm">
        <b>{data.modelValidation.status === 'validated' && data.mode === 'live' ? 'Probability calibration passed' : data.testMode ? 'TEST MODE — unvalidated research tickets only' : 'PRE-GAME RESEARCH — unvalidated estimates; real-money recommendations locked'}</b>
        <div>Chronological settled sample: {data.modelValidation.sample}. {data.mode === 'demo' ? 'Demo quotes and fictional players cannot qualify for tickets.' : data.modelValidation.warnings.join(' ')}</div>
        {data.modelValidation.tracking && <div>Forecast tracking: {data.modelValidation.tracking.captured} captured quotes · {data.modelValidation.tracking.upcoming} awaiting kickoff · {data.modelValidation.tracking.awaitingResults} awaiting final matching results · {data.modelValidation.tracking.pushes} pushes. Refreshed quotes do not count as independent validation outcomes.</div>}
        <div>Settlement is a separate background process. Calibration does not block pregame research. Missing tickets reflect data, player eligibility, position counts, game limits, or estimated EV checks.</div>
        {data.notes.map((n, i) => <div key={i}>{n}</div>)}
        <div>Scanned {data.scanned} props · {data.staleCount} with stale odds or invalid timestamps (over 30 min old or more than 5 min future-dated are excluded from tickets).</div>
      </div>}
      {!!data?.pipelineRejections?.length && <details className="rounded border border-amber-400 p-2 text-sm">
        <summary>Player matching and availability exclusions ({data.pipelineRejections.length})</summary>
        {data.pipelineRejections.map((item, index) => <div key={index}>
          {item.eventLabel} · {item.gameId} · {new Date(item.kickoff).toLocaleString()} · {item.player} · {marketLabel(item.market)} {item.side} {item.line ?? 'no line'} — {item.reason} (×{item.count})
        </div>)}
      </details>}
      {data && data.games.length > 0 && <section className="rounded-xl border border-line bg-card p-3">
        <h2 className="font-bold">FanDuel markets · {dateLabel(data.selectedDate)}</h2>
        <p className="text-xs text-amber-200">Markets available means FanDuel returned lines, not that every quote qualifies. Tickets require exact verified quotes within 30 minutes. Missing, stale, unsupported, and failed markets are never filled with substitutes.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.games.map((g) => <article key={g.id} className="rounded border border-line p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <b>{g.label}</b>
              <span className={g.status === 'available' ? 'text-neon' : g.status === 'error' ? 'text-red-400' : g.status === 'unsupported' ? 'text-amber-300' : 'text-slate-400'}>
                {g.status === 'available' ? 'Markets available' : g.status === 'none' ? 'No markets returned' : g.status === 'unsupported' ? 'Only unsupported player markets returned' : g.status === 'error' ? 'Lookup failed' : 'Not scanned'}
              </span>
            </div>
            <div className="text-xs text-slate-400">{new Date(g.kickoff).toLocaleString()} · {g.props} props</div>
            {g.markets.length > 0 && <div className="mt-1 text-xs">{g.markets.map(marketLabel).join(', ')}</div>}
            {g.returnedMarketKeys.length > 0 && <div className="mt-1 text-xs text-slate-400">FanDuel returned market keys: {g.returnedMarketKeys.join(', ')}</div>}
            {g.unsupportedMarketKeys.length > 0 && <div className="mt-1 text-xs text-amber-300">Unmapped player markets rejected: {g.unsupportedMarketKeys.join(', ')}</div>}
          </article>)}
        </div>
      </section>}
      <div className="grid gap-3 lg:grid-cols-2">{KINDS.map((k) => <TicketCard key={k} kind={k} t={ticket(k)} miss={data?.[k].missing ?? []} counts={data?.[k].counts} onRegen={() => { setEdit({ ...edit, [k]: undefined }); setIdx({ ...idx, [k]: idx[k] + 1 }); }} onReplace={(i) => replace(k, i)} onSave={() => void save(k)} saving={saving[k]} saveMessage={saveMessages[k]} />)}</div>
      <section aria-labelledby="saved-history-title" className="rounded-xl border border-line bg-card p-3">
        <div className="flex items-center justify-between gap-2"><h2 id="saved-history-title" className="font-bold">Saved Tickets</h2>
          <button className="rounded border border-line px-2 py-1 disabled:opacity-50" disabled={historyLoading} onClick={() => void loadSaved()}>Refresh saved history</button></div>
        <p className="text-xs text-slate-400">Historical research snapshots. Prices and estimates are from the time of saving; saving does not validate a recommendation or place a wager.</p>
        {historyLoading && <div role="status">Loading saved tickets…</div>}
        {historyError && <div role="alert" className="text-red-400">{historyError}</div>}
        {!historyLoading && !historyError && savedTickets.length === 0 && <p>No saved tickets yet. Save a generated ticket to keep it here.</p>}
        {savedTickets.map((savedTicket) => <details key={savedTicket.id} className="mt-2 rounded border border-line p-2">
          <summary className="cursor-pointer">#{savedTicket.id} · {savedTicket.strategy ?? CONFIG[savedTicket.kind]?.label ?? savedTicket.kind} · {new Date(savedTicket.created_at).toLocaleString()} · {savedTicket.purpose === 'test-research' ? 'TEST MODE — research only' : savedTicket.purpose === 'pregame-research' ? 'PRE-GAME RESEARCH — unvalidated archive' : 'Research archive — not a validated recommendation'}</summary>
          <div className="mt-1 text-xs text-amber-200">Saved snapshot only. No real-money recommendation. {savedTicket.source === 'live' ? 'Saved from live data.' : 'Legacy source: ' + savedTicket.source}</div>
          <div className="text-sm">Theoretical product odds: {savedTicket.decimal != null && Number.isFinite(savedTicket.decimal) ? `×${savedTicket.decimal.toFixed(2)}` : 'unavailable'} · saved joint estimate: {savedTicket.joint_p != null && Number.isFinite(savedTicket.joint_p) ? pc(savedTicket.joint_p, 2) : 'unavailable'}</div>
          {savedTicket.detailsUnavailable && <div className="text-amber-200">Some leg details are unavailable for this older record.</div>}
          <ol className="list-inside list-decimal text-sm">{(savedTicket.legs ?? []).map((leg, index) => <li key={`${leg.id}-${index}`}>{leg.pos} · {leg.name} · {leg.team} vs {leg.opp} · {marketLabel(leg.market)} {leg.side} {leg.line ?? ''} · {fmtOdds(leg.odds)}</li>)}</ol>
        </details>)}
        {historyCursor && <button className="mt-2 rounded border border-line px-2 py-1 disabled:opacity-50" disabled={historyLoading} onClick={() => void loadSaved(historyCursor)}>Load older saved tickets</button>}
      </section>
      {data && <ValueRanking rows={data.valueRanking ?? []} rejected={data.rejectedProps ?? []} mode={data.mode} />}
      {data && data.quotes.length > 0 && <section className="rounded-xl border border-line bg-card p-3">
        <h2 className="font-bold">Available {data.mode === 'live' ? 'FanDuel live' : 'demo'} props</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.quotes.map((q) => <article key={q.id} className="rounded border border-line p-2 text-sm">
            <div className="flex justify-between gap-2"><b>{q.name}</b><b>{fmtOdds(q.odds)}</b></div>
            <div className="text-xs text-slate-400">{q.pos} · {q.team} vs {q.opp} · {new Date(q.kickoff).toLocaleString()}</div>
            <div>{label(q)}</div>
            <div className="text-xs text-slate-400">Current ESPN roster: {q.rosterVerified ? `${q.team} verified (${q.rosterStatus})` : 'unverified'} · expected availability: {q.injury ? `Free-source injury listing: ${q.injury}` : 'no injury designation; final inactive status is not yet verified'}.</div>
            {q.history?.last5 && <div className="text-xs text-slate-300">
              Recent history (n={q.history.last5.games}): avg {q.history.last5.average.toFixed(1)}, median {q.history.last5.median.toFixed(1)}, line hit {q.history.last5.hitRate == null ? 'unavailable (pushes)' : `${pc(q.history.last5.hitRate)} (${q.history.last5.hits}/${q.history.last5.hitGames})`}
              {q.history.last10 && ` · last 10 avg ${q.history.last10.average.toFixed(1)}, hit ${q.history.last10.hitRate == null ? 'unavailable (pushes)' : pc(q.history.last10.hitRate)}`}
            </div>}
            {q.history?.last10 && <details className="text-xs text-slate-300">
              <summary className="cursor-pointer">Last {q.history.last10.games} verified game results</summary>
              <ul className="mt-1">{q.history.last10.results.map((result, index) => <li key={`${result.season}:${result.week}:${index}`}>
                {result.date ? new Date(result.date).toLocaleDateString() : `Week ${result.week}, ${result.season}`} vs {result.opponent}: {result.value}
              </li>)}</ul>
            </details>}
            {!q.history?.last5 && <div className="text-xs text-slate-400">Historical player statistics unavailable.</div>}
            <div className="text-xs text-slate-400">Verified history source: {q.historySource === 'espn' ? 'ESPN box scores' : q.historySource === 'nflverse' ? 'nflverse' : 'unavailable'}.</div>
            <div className={q.scored?.stale ? 'text-xs text-amber-300' : 'text-xs text-slate-400'}>
              FanDuel odds updated {Number.isFinite(Date.parse(q.oddsAt)) ? new Date(q.oddsAt).toLocaleString() : 'time unavailable'}
              {q.scored?.stale ? ' · STALE OR FUTURE-DATED — refresh odds before relying on this line.' : ''}
            </div>
          </article>)}
        </div>
      </section>}
      {ticket('best') && ticket('aggr') && <Compare a={ticket('best')!} b={ticket('aggr')!} />}
      <section className="rounded-xl border border-line bg-card p-3 text-sm">
        <b>Chronological historical backtest</b> <span className="text-slate-400">(only this app's stored pregame FanDuel quotes/predictions are included; no external historical odds are fabricated, and ambiguous settlements stay unresolved)</span>
        <div className={`mt-1 font-bold ${bt?.validationStatus === 'validated' ? 'text-neon' : 'text-amber-300'}`}>
          {bt?.validationStatus === 'validated' ? 'BACKTEST SUPPORT THRESHOLD MET' : 'UNVALIDATED MODEL'}
        </div>
        {!bt || bt.n === 0 ? <div className="text-slate-400">No settled validation outcomes yet. Check collection status and pending reasons above; more completed games or verified missing results may be required. No profitability claim is made.
          {(bt?.validationWarnings ?? ['No historical odds and results have been captured yet.']).map((warning: string) => <div key={warning} className="mt-2 text-amber-300">{warning}</div>)}
        </div> :
          <div>Legs {bt.n}, hit rate {bt.legHitRate}%, single-leg ROI {bt.legRoiPct}%. Six-leg tickets: {bt.parlays.hits}/{bt.parlays.n}.
            <div className="mt-2">Brier {bt.modelBrier?.toFixed(3) ?? 'n/a'} · paired model Brier {bt.pairedModelBrier?.toFixed(3) ?? 'n/a'} · no-vig market baseline {bt.marketBrier?.toFixed(3) ?? 'n/a'} · log loss {bt.logLoss?.toFixed(3) ?? 'n/a'} · calibration error {bt.expectedCalibrationError == null ? 'n/a' : `${bt.expectedCalibrationError}%`}.</div>
            {(bt.validationWarnings ?? []).map((warning: string) => <div key={warning} className="text-amber-300">{warning}</div>)}
            <div className="mt-2 rounded border border-line p-2"><b>Walk-forward periods (oldest to newest)</b>
              {(bt.walkForward ?? []).map((period: any) => <div key={period.period}>Period {period.period}: {period.firstKickoff?.slice(0, 10)}–{period.lastKickoff?.slice(0, 10)} · n={period.n} · hit {period.hitRate}% · Brier {period.brier?.toFixed(3) ?? 'n/a'} · ROI {period.roiPct}%</div>)}
            </div>
            <div className="mt-2 rounded border border-line p-2">
              <b>Above-90% forecast calibration</b>
              <div>{bt.highProbabilityCalibration?.n ?? 0} settled out-of-sample forecasts · predicted {bt.highProbabilityCalibration?.predicted == null ? 'n/a' : `${bt.highProbabilityCalibration.predicted}%`} · observed {bt.highProbabilityCalibration?.actual == null ? 'n/a' : `${bt.highProbabilityCalibration.actual}%`}</div>
              {(bt.highProbabilityCalibration?.warnings ?? ['Calibration data unavailable.']).map((warning: string) => <div key={warning} className="text-amber-300">{warning}</div>)}
            </div>
            <pre className="overflow-x-auto text-xs">{JSON.stringify({ byPosition: bt.byPosition, byMarket: bt.byMarket, calibration: bt.calibration }, null, 1)}</pre></div>}
      </section>
      <p className="text-xs text-slate-400">Research tool only: no wagers are placed, no pick is guaranteed, and estimated payouts are products of leg odds, not FanDuel-confirmed prices.</p>
    </main>
  );
}

function ValueRanking({ rows, rejected, mode }: {
  rows: { candidate: Candidate; qualifiedFor: Kind[]; warnings: string[] }[];
  rejected: { candidate: Candidate; reasons: string[]; count: number }[];
  mode: 'live' | 'demo';
}) {
  return <section className="rounded-xl border border-line bg-card p-3 text-sm">
    <h2 className="font-bold">Top pregame research props — ranked by estimated EV</h2>
    <p className="text-xs text-amber-200">UNVALIDATED MODEL. Estimates use historical results independently of FanDuel prices; positive estimated EV is not proof of value or profitability.</p>
    {mode === 'demo' ? <div className="mt-2 text-amber-200">Value ranking is disabled in demo mode; fictional odds and statistics are not presented as value.</div>
      : !rows.length ? <div className="mt-2 text-amber-200">No props currently qualify for a ticket. Review data availability and per-leg reasons below.</div> :
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead><tr className="border-b border-line"><th className="p-2">Player</th><th>Market</th><th>Odds</th><th>Last-10 hit rate</th><th>Historical estimate</th><th>EV</th><th>Fair odds</th><th>Qualified</th><th>Warnings</th></tr></thead>
          <tbody>{rows.map(({ candidate, qualifiedFor, warnings }) => <tr key={candidate.id} className="border-b border-line align-top">
            <td className="p-2"><b>{candidate.name}</b><div>{candidate.pos} · {candidate.team} vs {candidate.opp}</div><div>{new Date(candidate.kickoff).toLocaleString()}</div><div>{candidate.historySource ?? 'history unavailable'} · n={candidate.sample} · ESPN roster {candidate.rosterVerified ? candidate.rosterStatus : 'unverified'} · role {candidate.roleGames ?? 0}/5</div></td>
            <td>{label(candidate)}</td>
            <td>FanDuel {fmtOdds(candidate.odds)}</td>
            <td>{candidate.history?.last10?.hitRate == null ? 'n/a' : `${pc(candidate.history.last10.hitRate)} (${candidate.history.last10.hits}/${candidate.history.last10.hitGames})`}<div>n={candidate.history?.last10?.games ?? 0}</div></td>
            <td>{candidate.scored ? pc(candidate.scored.p) : 'n/a'}<div>smoothed historical estimate (not a raw hit rate)</div><div>market {candidate.scored ? pc(candidate.scored.marketP) : 'n/a'} ({candidate.marketPSource === 'no-vig' ? 'no-vig' : 'vig included'})</div></td>
            <td>{candidate.scored ? pc(candidate.scored.ev) : 'n/a'}</td>
            <td>{candidate.scored ? fmtOdds(candidate.scored.fairOdds) : 'n/a'}</td>
            <td>{qualifiedFor.map((kind) => CONFIG[kind].label).join(', ')}</td>
            <td>{warnings.join(' ') || 'No additional flags.'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {rejected.length > 0 && <details className="mt-2">
      <summary className="cursor-pointer text-amber-200">Rejection warnings for {rejected.length} grouped selections</summary>
      <ul className="mt-1 space-y-1 text-xs text-slate-300">{rejected.map(({ candidate, reasons, count }, index) =>
        <li key={`${candidate.id}-${index}`}><b>{candidate.name} ({candidate.pos}) {label(candidate)} (×{count}):</b>
          <div className="text-slate-400">Event {candidate.gameId} · {candidate.eventLabel ?? 'event label unavailable'} · kickoff {new Date(candidate.kickoff).toLocaleString()} · history {candidate.historySource ?? 'unavailable'} player ID {candidate.historyPlayerId ?? 'unavailable'}.</div>
          <div>{reasons.join(' ')}</div>
        </li>,
      )}</ul>
    </details>}
  </section>;
}

function TicketCard({ kind, t, miss, counts, onRegen, onReplace, onSave, saving, saveMessage }: { kind: Kind; t?: Ticket; miss: string[]; counts?: BuildResult['counts']; onRegen: () => void; onReplace: (i: number) => void; onSave: () => void; saving: boolean; saveMessage?: SaveMessage }) {
  return (
    <section className="rounded-xl border border-line bg-card p-3">
      <b className="text-neon">{CONFIG[kind].label}</b>{t&&<p>Status: Pending — save for automatic grading.</p>}
      {t?.purpose === 'pregame-research' && <div className="font-bold text-amber-200">PRE-GAME RESEARCH — unvalidated estimates. Real-money recommendations locked.</div>}
      {t?.purpose === 'test-research' && <div className="font-bold text-amber-200">TEST MODE — research only; not a validated recommendation. No real-money use.</div>}
      <div className="text-xs text-slate-400">{kind === 'best' ? 'Higher-probability, history-supported selections with observed matchup ranking' : 'Higher-payout selections subject to probability, history and matchup checks'}</div>
      {!t ? <div className="mt-2 rounded border border-amber-400 bg-amber-950/30 p-2 text-sm text-amber-200">
        <b>Incomplete ticket — no six-pick ticket generated.</b>
        <div>Leg-qualified pool: QB {counts?.QB ?? 0}/1 · RB {counts?.RB ?? 0}/2 · WR {counts?.WR ?? 0}/2 · TE {counts?.TE ?? 0}/1 (before whole-ticket checks).</div>
        <div>Missing: {miss.join(', ') || 'qualified, current FanDuel selections'}.</div>
        {miss.some((reason) => reason.includes('calibration')) && <div>Historical hit rates are not treated as calibrated predictive probabilities; no payout, joint probability, or EV is shown until chronological validation passes.</div>}
        <div>No unsupported or placeholder picks were added.</div>
      </div> : <>
        {t.legs.map((l, i) => (
          <div key={l.id} className="mt-2 border-t border-line pt-2">
            <div className="flex justify-between"><div><span className="font-bold text-blue">{l.pos}</span> <b>{l.name}</b><div className="text-xs text-slate-400">{l.team} vs {l.opp} · {new Date(l.kickoff).toLocaleString()}</div></div><b>FanDuel {fmtOdds(l.odds)}</b></div>
            <div className="text-sm">{label(l)}</div>
            <div className="text-xs text-slate-400">FanDuel event ID {l.gameId} · {l.eventLabel ?? `${l.team} vs ${l.opp}`} · exact event/teams/kickoff verified: {l.eventVerified ? 'yes' : 'no'} · market key {l.market} · quote verified: {l.quoteVerified ? 'yes' : 'no'}.</div>
            <div className={l.scored!.stale ? 'text-xs text-amber-300' : 'text-xs text-slate-400'}>
              Odds updated {Number.isFinite(Date.parse(l.oddsAt)) ? new Date(l.oddsAt).toLocaleString() : 'time unavailable'}
              {l.scored!.stale ? ' · STALE OR FUTURE-DATED — refresh odds before relying on this line.' : ' · VERIFIED LIVE QUOTE — within the 30-minute freshness window.'}
            </div>
            <div className="text-xs text-slate-400">Verified history: {l.historySource === 'espn' ? 'ESPN box scores' : l.historySource === 'nflverse' ? 'nflverse' : 'unavailable'} player ID {l.historyPlayerId ?? 'unavailable'} (n={l.sample}); ID/game/team/opponent/stat match: {l.historyVerified ? 'verified' : 'unverified'}. Current team: {l.rosterVerified ? `${l.team} roster verified by ESPN` : 'unverified'} · roster status: {l.rosterStatus ?? 'unavailable'} · expected availability: {l.injury ? `Free-source injury listing: ${l.injury}` : 'no injury designation reported; final inactive status is not yet verified'}.</div>
            {l.scored!.suspiciousLongShot && <div className="text-xs text-amber-300">
              Risk flag: unusually high model probability for a long-shot price ({pc(l.scored!.p)} modeled vs {pc(impliedProb(l.odds))} odds-implied); Best Six excludes this pick.
            </div>}
            <div className="text-xs text-slate-400">
              Smoothed historical estimate <b className="text-neon">{pc(l.scored!.p)}</b>{l.scored!.conditionalOnNoPush ? ' (conditional on no push)' : ''} · observed last-10 hit rate {l.scored!.historicalHitRate == null ? 'n/a' : `${pc(l.scored!.historicalHitRate)} (${l.scored!.historicalHitGames} non-push outcomes)`} · FanDuel {l.marketPSource === 'no-vig' ? 'no-vig' : 'quoted-side implied'} probability {pc(l.scored!.marketP)} · edge {pc(l.scored!.edge)} · estimated EV {pc(l.scored!.ev)} · fair odds {fmtOdds(l.scored!.fairOdds)} · confidence {l.scored!.confidence}.
              {' '}Projection {l.mean.toFixed(1)} · history n={l.sample} · recent role support {l.roleGames ?? 0}/5 games.
            </div>
            {l.history?.last5 && <div className="mt-1 text-xs text-slate-300">
              Last 5 (n={l.history.last5.games}): avg {l.history.last5.average.toFixed(1)}, median {l.history.last5.median.toFixed(1)}, hit {l.history.last5.hitRate == null ? 'n/a (pushes)' : `${pc(l.history.last5.hitRate)} (${l.history.last5.hits}/${l.history.last5.hitGames})`}
              {l.history.last10 && <> · Last 10 (n={l.history.last10.games}): avg {l.history.last10.average.toFixed(1)}, median {l.history.last10.median.toFixed(1)}, hit {l.history.last10.hitRate == null ? 'n/a (pushes)' : `${pc(l.history.last10.hitRate)} (${l.history.last10.hits}/${l.history.last10.hitGames})`}</>}
              {l.history.last5.consistency != null && <> · volatility {pc(l.history.last5.consistency, 0)} CV</>}
              {l.history.last10 && l.history.trend != null && <> · 5-vs-10 trend {l.history.trend > 0 ? '+' : ''}{l.history.trend.toFixed(1)}</>}
            </div>}
            {l.history?.last10 && <details className="text-xs text-slate-300">
              <summary className="cursor-pointer">Last {l.history.last10.games} verified game results for {marketLabel(l.market)}</summary>
              <ul className="mt-1">
                {l.history.last10.results.map((result, index) => <li key={`${result.season}:${result.week}:${index}`}>
                  {result.date ? new Date(result.date).toLocaleDateString() : `Week ${result.week}, ${result.season}`} · game {result.gameId} · player ID {result.playerId} · {result.team} vs {result.opponent}: {result.value}
                </li>)}
              </ul>
            </details>}
            <div className="text-xs text-slate-400">
              {l.history?.defense
                ? `Vs ${l.opp}: defense rank ${l.history.defense.rank}/${l.history.defense.teams}, allowing ${l.history.defense.averageAllowed.toFixed(1)} ${marketLabel(l.market)} per game (${l.history.defense.games} games; rank 1 allows least, highest rank most).`
                : `Vs ${l.opp}: defensive rank unavailable or fewer than 4 completed games.`}
              {' '}Last-five carries/targets/pass attempts {l.history?.opportunityAverage?.toFixed(1) ?? 'unavailable'} per game; nflverse offense snaps {l.history?.snapAverage == null ? 'unavailable from source' : `${l.history.snapAverage.toFixed(1)} per game (${l.history.snapCounts?.length ?? 0} games)`}. Home/away averages: {l.history?.homeAverage?.toFixed(1) ?? 'n/a'} / {l.history?.awayAverage?.toFixed(1) ?? 'n/a'}.
            </div>
            <div className="text-xs text-slate-300">
              {confidenceReason(l)}. Selection rationale: {kind === 'best'
                ? `Best Six prioritizes the smoothed historical estimate (${pc(l.scored!.p)}) and historical support (${l.sample} games).`
                : `Aggressive Six considers payout (FanDuel ${fmtOdds(l.odds)}) only after history, market support, and odds-freshness checks.`}
              {l.history?.last5?.hitRate != null && ` Hit ${pc(l.history.last5.hitRate)} of the last ${l.history.last5.hitGames} non-push games against this line.`}
              {l.injury ? ` Injury report: ${l.injury}.` : ' No injury status was available for this player in the current report; not listed is not a healthy designation.'}
            </div>
            <button className="mt-1 rounded border border-line px-2 py-1 text-sm" onClick={() => onReplace(i)}>Replace Player</button>
          </div>))}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded bg-bg p-2"><b className="block text-lg">{fmtOdds(t.american)}</b>theoretical product odds · ×{t.decimal.toFixed(2)}</div>
          <div className="rounded bg-bg p-2"><b className="block text-lg text-neon">{pc(t.jointP, 2)}</b>assumption-based joint estimate (UNVALIDATED)<span className="mt-1 block text-xs text-slate-400">95% simulation interval {pc(t.jointLower95, 2)}–{pc(t.jointUpper95, 2)}</span><span className="mt-1 block text-xs text-slate-400">Independent-leg baseline only {pc(t.indepP, 2)} · correlation adjustment {pc(t.jointP - t.indepP, 2)}</span></div>
          <div className="rounded bg-bg p-2"><b className="block text-lg">{pc(t.ev)}</b>theoretical model EV*<span className="mt-1 block text-xs text-slate-400">simulation-only EV interval {pc(t.evLower95)} to {pc(t.jointUpper95 * t.decimal - 1)}</span></div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">{[5, 10, 20].map((s) => { const p = payout(s, t.decimal); return <div key={s} className="rounded bg-bg p-2">${s}<b className="block">+${p.profit.toFixed(2)}</b><span className="text-xs text-slate-400">${p.total.toFixed(2)} theoretical return</span></div>; })}</div>
        <div className="text-xs text-slate-400">*Ticket EV uses the assumption-based joint estimate × product of individual leg decimal prices − 1. It is not a calibrated forecast. Returns assume that product price; FanDuel has not confirmed ticket acceptance or combined pricing. Correlation factors are assumptions, not empirically fitted. The EV range reflects simulation sampling error only, not model or odds uncertainty. Integer count-line probabilities condition on no push; void-leg repricing is not modeled.</div>
        {t.warnings.length > 0 && <div className="mt-2 rounded border-l-4 border-amber-400 bg-amber-950/30 p-2 text-xs">{t.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
        <div className="mt-2 flex gap-2"><button className="rounded border border-line p-2" onClick={onRegen}>Regenerate</button><button aria-label={`Save ${CONFIG[kind].label} ticket`} className="rounded border border-neon p-2 text-neon disabled:opacity-50" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save Ticket'}</button></div>
      </>}
      {saveMessage && <div role={saveMessage.type === 'error' ? 'alert' : 'status'} aria-live="polite" className={saveMessage.type === 'error' ? 'mt-2 text-sm text-red-400' : 'mt-2 text-sm text-neon'}>{saveMessage.text}</div>}
    </section>
  );
}
function Compare({ a, b }: { a: Ticket; b: Ticket }) {
  const avg = (t: Ticket) => t.legs.reduce((s, l) => s + l.scored!.p, 0) / 6, min = (t: Ticket) => Math.min(...t.legs.map((l) => l.scored!.p));
  const shared = a.legs.filter((l) => b.legs.some((m) => m.name === l.name)).length;
  const rows: [string, string, string][] = [['Modeled joint probability', pc(a.jointP, 2), pc(b.jointP, 2)], ['Theoretical product odds (not a quote)', `×${a.decimal.toFixed(1)}`, `×${b.decimal.toFixed(1)}`], ['$10 theoretical return', `$${payout(10, a.decimal).total}`, `$${payout(10, b.decimal).total}`], ['Theoretical model EV vs product odds', pc(a.ev), pc(b.ev)], ['Avg / min leg', `${pc(avg(a), 0)} / ${pc(min(a), 0)}`, `${pc(avg(b), 0)} / ${pc(min(b), 0)}`], ['Players shared', `${shared}`, `${shared}`]];
  return <section className="rounded-xl border border-line bg-card p-3 text-sm"><b>Comparison</b><table className="mt-1 w-full text-left"><thead><tr><th></th><th>Best</th><th>Aggressive</th></tr></thead><tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-line"><td className="py-1">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table></section>;
}
function FirstQuarterTicketCard({ title, description, result }: { title: string; description: string; result: FirstQuarterBuildResult }) {
  const chosen: FirstQuarterTicket | undefined = result.options[0];
  return <section className="rounded-lg border border-line p-3">
    <b className="text-blue">{title}</b>
    <div className="text-xs text-slate-400">{description}</div>
    {!chosen ? <div className="mt-2 text-sm text-amber-300">Unavailable. Missing: {result.missing.join(', ') || 'verified first-quarter data'}.</div> : <>
      {chosen.legs.map((leg) => <div key={leg.id} className="mt-2 border-t border-line pt-2">
        <div className="flex justify-between gap-2"><b>{leg.player}</b><b>FanDuel {fmtOdds(leg.odds)}</b></div>
        <div className="text-xs text-slate-400">{leg.matchup}</div>
        <div>{leg.market} {leg.side} {leg.line}</div>
        <div className="text-xs text-slate-400">Estimated probability {pc(leg.probability)} · {leg.sample
          ? `verified Q1 history: ${leg.sample} games, avg ${leg.mean?.toFixed(1)}, hit ${leg.hitRate == null ? 'n/a' : pc(leg.hitRate)}`
          : 'verified Q1 history unavailable; estimated from live quarter-market odds only'}.</div>
      </div>)}
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded bg-bg p-2"><b className="block text-lg">{fmtOdds(chosen.american)}</b>theoretical product odds, not a FanDuel quote · ×{chosen.decimal.toFixed(2)}</div>
        <div className="rounded bg-bg p-2"><b className="block text-lg text-neon">{pc(chosen.probability, 2)}</b>independent combined-probability estimate</div>
      </div>
      {chosen.warnings.map((warning) => <div key={warning} className="mt-2 rounded border-l-4 border-amber-400 bg-amber-950/30 p-2 text-xs">{warning}</div>)}
      {result.options.length > 1 && <div className="mt-2 text-xs text-slate-400">{result.options.length - 1} other valid combinations available in this ranking.</div>}
    </>}
  </section>;
}
