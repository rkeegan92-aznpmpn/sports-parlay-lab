'use client';
import { useEffect, useState } from 'react';
import type { validationDashboard } from '../../server/validationDashboard.ts';
import type { liveHealth } from '../../server/liveHealth.ts';
type Health = ReturnType<typeof liveHealth>;
type Dashboard = ReturnType<typeof validationDashboard>;
const time = (value: number | null | undefined) => value ? new Date(value).toLocaleString() : 'not yet';
export default function ValidationPanel() {
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    const load = async () => {
      request?.abort(); request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 8000);
      if (active) setLoading(true);
      try {
        const response = await fetch('/api/validation', { cache: 'no-store', signal: request.signal });
        const body = await response.json();
        if (!response.ok || !body.collector || !Array.isArray(body.validationProgress)) throw new Error('Validation status unavailable. The app or Codespace may be stopped.');
        if (active) { setData(body); setError(''); }
      } catch { if (active) setError('Validation details are unavailable. Collector health is checked separately below; inspect /api/validation for database or timeout errors.'); }
      finally { clearTimeout(timeout); if (active) setLoading(false); }
    };
    void load(); const interval = setInterval(() => void load(), 15000);
    return () => { active = false; request?.abort(); clearInterval(interval); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/health', {cache:'no-store', signal:AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])});
        const body = await response.json();
        if (!response.ok || !body.collector || typeof body.oddsApiKeyConfigured !== 'boolean') throw new Error('Health unavailable');
        if (active) setHealth(body);
      } catch { if (active) setHealth(null); }
    };
    void load(); const timer = setInterval(() => void load(),15000);
    return () => { active=false; controller.abort(); clearInterval(timer); };
  }, [refresh]);
  return <section aria-labelledby="validation-title" className="rounded-xl border border-amber-400 bg-card p-3 text-sm">
    <div className="flex items-center justify-between gap-2"><h2 id="validation-title" className="font-bold">Forecast collection &amp; validation</h2>
      <button className="rounded border border-line px-2 py-1 disabled:opacity-50" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh validation status</button></div>
    <p className="text-xs text-slate-400">Automatic collection runs with the app process only while the Codespace is active. A stopped Codespace cannot collect forecasts. This panel checks status every 15 seconds.</p>
    <p className="text-xs"><a className="underline" href="/api/readiness" target="_blank" rel="noreferrer">Read-only forward readiness audit — dates, eligibility, saved-ticket samples</a></p>
    {error && <div role="alert" className="text-red-400">{error}</div>}
    {!data && !error && <div role="status">Loading validation progress…</div>}
    <div className="mt-2 font-bold">Collector: {health ? health.collector.status.toUpperCase() : 'UNKNOWN — health endpoint unavailable'}</div>
    {health ? <>
      <div>{health.collector.reason}</div>
      <div className="text-xs text-slate-400">Last heartbeat: {time(health.collector.lastHeartbeat)} · last attempt: {time(health.collector.lastAttempt)} · last successful check: {time(health.collector.lastSuccess)} · next run: {time(health.collector.nextRun)}</div>
      {health.collectionPhases?.map(p=><div key={p.phase} className="mt-1 text-xs"><b>{p.phase}: {p.status.toUpperCase()}</b> · checked {time(p.checkedAt)} · last success {time(p.lastSuccess)}{p.messages.map((m,i)=><div key={i}>{m}</div>)}</div>)}
      {health.oddsCooldown && <div className="text-amber-200">Odds requests paused until {time(health.oddsCooldown.until)}: HTTP {health.oddsCooldown.status} {health.oddsCooldown.code ?? 'unclassified'}. Refresh does not bypass the cooldown.</div>}
      {health.collectorCredentialMismatch && <div className="text-red-400">Collector and web process use different credentials. Stop the stale worker and restart the app with the intended environment.</div>}
      <div className="text-xs text-slate-400">Web credential fingerprint: {health.credentialFingerprint ?? 'missing'} · collector fingerprint: {health.collector.credentialFingerprint ?? 'unknown — restart worker'}. Compare with verify:live; never share the key.</div>
      <div>Odds API credentials: {health.oddsApiKeyConfigured ? 'configured — provider access not yet verified by this health check' : 'MISSING — live odds blocked'}. Automatic collector: {health.collectorEnabled ? 'enabled' : 'disabled'}.</div>
      {health.collector.lastError && <div className="text-red-400">Last collector error: {health.collector.lastError}</div>}
      <div className="text-xs text-amber-200">{health.nextAction}</div>
    </> : <div className="text-amber-200">Open /api/health in this same port preview. A login redirect, stopped app, database error or unreachable preview cannot establish collector state.</div>}
    {data && <>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {[['Captured quote forecasts', data.tracking.captured], ['Settled quote forecasts', data.tracking.settledQuotes], ['Calibration sample (deduplicated)', data.n], ['Awaiting kickoff', data.tracking.upcoming], ['Awaiting results', data.tracking.awaitingResults], ['Pushes excluded', data.tracking.pushes]].map(([label, value]) => <div key={label} className="rounded border border-line p-2"><b className="block text-lg">{value}</b>{label}</div>)}
      </div>
      <div className="mt-2 font-bold">{data.validationStatus === 'validated' ? 'Calibration passed — generate tickets to apply current data and selection checks.' : 'Real-money recommendations remain locked by calibration; pregame research tickets remain available:'}</div>
      <table className="mt-2 w-full text-left"><thead><tr><th>Requirement</th><th>Current</th><th>Required</th><th>Status</th></tr></thead>
        <tbody>{data.validationProgress.map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.current == null ? 'unavailable' : Number.isInteger(item.current) ? item.current : item.current.toFixed(4)}</td><td>{item.comparison === 'at-least' ? '≥' : item.comparison === 'at-most' ? '≤' : '<'} {item.required == null ? 'market baseline unavailable' : Number.isInteger(item.required) ? item.required : item.required.toFixed(4)}</td><td>{item.met ? 'Met' : 'Not met'}</td></tr>)}</tbody>
      </table>
      <ul className="mt-2 list-inside list-disc text-amber-200">{data.validationWarnings.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      {!!data.tracking.pendingReasons.length && <div className="mt-2">Pending forecast reasons: {data.tracking.pendingReasons.map((item) => `${item.reason}: ${item.count}`).join(' · ')}</div>}
      {!!data.tracking.incompleteMetadata && <div className="text-amber-200">{data.tracking.incompleteMetadata} legacy quotes lack original event metadata. Missing IDs are not invented; settlement needs an authoritative unique result match.</div>}
      <div className="text-xs text-slate-400">Model: {data.tracking.modelVersion} · first captured: {time(data.tracking.firstCaptured)} · latest captured: {time(data.tracking.lastCaptured)}</div>
      {!!data.tracking.legacySnapshots && <div>{data.tracking.legacySnapshots} legacy snapshot rows are retained, but quote-only records without this model's pregame identity/provenance cannot create a calibration sample.</div>}
      {!!data.tracking.postKickoffExcluded && <div className="text-amber-200">{data.tracking.postKickoffExcluded} records at/after kickoff are excluded from validation.</div>}
      {!!data.tracking.otherModels && <div>{data.tracking.otherModels} quotes from other model versions cannot validate this model.</div>}
      {data.settlementAudit && <details className="mt-2 rounded border border-line p-2">
        <summary>Settlement readiness audit</summary>
        <div>{data.settlementAudit.buckets.futureKickoff} before kickoff · {data.settlementAudit.buckets.waitingSixHours} in the six-hour window · {data.settlementAudit.dueForSettlement} due · {data.settlementAudit.buckets.invalidProvenance} invalid provenance.</div>
        <div>Next eligibility (UTC): {data.settlementAudit.nextEligibleAtUTC ?? 'none pending before the check window'} · {data.settlementAudit.buckets.dueUnchecked} due records never checked.</div>
        {data.settlementAudit.conclusions.map((text)=><p key={text}>{text}</p>)}
        <div>Database path fingerprint: {data.settlementAudit.databasePathFingerprint} (compare app and CLI audits).</div>
      </details>}
      {!!data.recentForecasts?.length && <details className="mt-2 rounded border border-line p-2">
        <summary className="cursor-pointer">Recent forecast audit (latest {data.recentForecasts.length})</summary>
        {data.recentForecasts.map((item)=><div key={item.id} className="mt-2 border-t border-line pt-2 text-xs">
          <b>#{item.id} {item.player}</b> · {item.market} {item.side} {item.line} · odds {item.odds} · captured estimate {(item.p*100).toFixed(2)}% (not a recommendation)
          <div>Player ID: {item.playerId || 'missing'} · original event: {item.eventId || 'not recorded (legacy)'} · NFL result event: {item.resultGameId || 'unmatched'} · ESPN event: {item.espnEventId || 'unmatched'}</div>
          <div>Captured: {time(item.capturedAt)} · quote timestamp: {item.oddsAt} · original kickoff: {time(item.kickoffAt)}</div>
          <div>{item.status} · {item.reason} · result source/date: {item.resultSource ?? 'pending'} / {item.resultDate ?? 'pending'}</div>
        </div>)}
      </details>}
      <p className="mt-2 text-xs text-slate-400">Real pregame forecasts must be captured before kickoff and matched to final results. More quotes are not more settled outcomes. TEST MODE and saved research archives do not unlock regular recommendations. Passing calibration still requires the 1 QB / 2 RB / 2 WR / 1 TE structure, no more than 3 picks per game, supported live data and estimated value.</p>
    </>}
  </section>;
}
