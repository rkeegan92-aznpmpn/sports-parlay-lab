'use client';
import type {PreviewResult} from '../../lib/researchPreview.ts';
import QuoteComparison from './QuoteComparison.tsx';
export default function ResearchPreview({preview,now}:{preview:PreviewResult|null|undefined;now:number}){
 if(!preview)return null;
 return <section aria-label="Stale research previews" className="space-y-3 rounded border-2 border-amber-300 p-3">
  <h3 className="font-bold text-amber-200">{preview.label}</h3><p>NON-ACTIONABLE comparison worksheet. Not live, not bet-ready, not an API-verified recommendation. Manual checks do not unlock calibration or change captured odds.</p>
  {preview.missing.map(m=><p key={m}>{m}</p>)}
  <div className="grid gap-3 lg:grid-cols-2">{preview.options.map(t=><article key={t.kind} aria-label={`${t.kind} stale preview`} className="min-w-0 rounded border border-line p-3">
   <h4 className="font-bold">{t.kind} — {t.label}</h4>
   {t.legs.map(l=><div key={l.quoteId} className="break-words border-t border-line py-3"><b>{l.position??''} {l.player}</b><p>{l.team} vs {l.opponent} · kickoff {new Date(l.kickoff).toLocaleString()}</p><p>{l.market} {l.side} {l.line} · captured price {l.odds>0?'+':''}{l.odds}</p><p>{l.source} · captured at {l.capturedAt} · as of {l.asOf??'missing'} · evidence age at least {Math.max(0,Math.round((l.ageSeconds+(now-Date.parse(l.checkedAt))/1000)/60))} minutes; source evidence may be older.</p>{l.reasons.map(r=><p key={r}>Rejected: {r}</p>)}<p>{l.probability==null?'Probability unavailable':`Uncalibrated estimate at captured line: ${(l.probability*100).toFixed(1)}% · ${l.sample} historical games`}. Current-price EV unavailable.</p>{Date.parse(l.kickoff)<=now&&<p role="alert">Kickoff reached — pregame worksheet expired.</p>}<QuoteComparison target={l}/></div>)}
   {t.limitations.map(m=><p className="text-sm text-amber-200" key={m}>{m}</p>)}
  </article>)}</div>
 </section>;
}
