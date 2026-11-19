'use client';
import {useEffect,useState} from 'react';
import type {ComparisonTarget} from '../../lib/researchPreview.ts';
import {comparisonKey,compareObservation,type ManualComparison} from '../../lib/quoteComparison.ts';
let historyRequest:Promise<{checks:ManualComparison[]}>|null=null;
function history():Promise<{checks:ManualComparison[]}>{return historyRequest??=fetch('/api/quote-comparisons',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Manual checks could not be loaded.');return r.json();}).catch(e=>{historyRequest=null;throw e;});}
export default function QuoteComparison({target}:{target:ComparisonTarget}){
 const [check,setCheck]=useState<ManualComparison|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const key=comparisonKey(target);
 useEffect(()=>{let active=true;void history().then(b=>{if(active)setCheck(b.checks.find(c=>comparisonKey(c.expected)===key)??null);}).catch(e=>{if(active)setError(e.message);});const timer=setInterval(()=>setClock(Date.now()),15000);return()=>{active=false;clearInterval(timer);};},[key]);
 const current=check?compareObservation(target,check.observation,clock):null;
 async function submit(form:HTMLFormElement){
  setBusy(true);setError('');const data=new FormData(form);
  try{
   const local=String(data.get('observedAt')??''),date=new Date(local);if(!local||!Number.isFinite(date.getTime()))throw new Error('Enter the time you observed this market in FanDuel.');
   const observation={player:data.get('player'),gameId:data.get('gameId'),market:data.get('market'),side:data.get('side'),line:Number(data.get('line')),odds:Number(data.get('odds')),observedAt:date.toISOString(),available:data.get('available')==='on',comparedInFanDuel:data.get('confirmed')==='on',provenance:'manual-fanduel-app'};
   const r=await fetch('/api/quote-comparisons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,observation})}),b=await r.json();if(!r.ok)throw new Error(b.error??'Comparison save failed.');setCheck(b.check);setClock(Date.now());historyRequest=null;
  }catch(e){setError(e instanceof Error?e.message:'Comparison failed.');}finally{setBusy(false);}
 }
 return <details className="mt-2 rounded border border-line p-2" aria-label={`Manual comparison ${target.player} ${target.side}`}>
  <summary className="cursor-pointer p-2">Compare {target.player} {target.side} in FanDuel — {current?.label??'NOT CHECKED'}</summary>
  <p>User observation only — never API VERIFIED. Compare this exact game, athlete, period, side, line and price. A check expires after 30 minutes and at kickoff. Recheck just before any wager; no automatic betting.</p>
  <p>Captured selection: {target.gameId} · {target.player} · {target.period==='q1'?'FIRST QUARTER':'FULL GAME'} · {target.market} {target.side} {target.line} · {target.odds}</p>
  {check&&current&&<div role="status"><p>{current.label} · observed {new Date(check.observation.observedAt).toLocaleString()} · recorded {new Date(check.recordedAt).toLocaleString()}</p><p>Recorded user observation: {check.observation.player} · {check.observation.gameId} · {check.observation.market} {check.observation.side} {check.observation.line} · {check.observation.odds} · {check.observation.available?'reported available':'reported unavailable'} · manual-fanduel-app</p>{current.reasons.map(r=><p key={r}>{r}</p>)}</div>}
  <form className="grid min-w-0 gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void submit(e.currentTarget);}}>
   {(['player','gameId','market','side','line','odds'] as const).map(field=><label key={field} className="min-w-0">Observed {field}<input className="block min-h-12 w-full min-w-0 rounded bg-bg p-2" name={field} defaultValue={target[field]} required type={field==='line'||field==='odds'?'number':'text'} step={field==='line'?'any':'1'}/></label>)}
   <label className="min-w-0">Observed time (your local timezone)<input className="block min-h-12 w-full min-w-0 rounded bg-bg p-2" name="observedAt" type="datetime-local" required/></label>
   <label><input name="available" type="checkbox" defaultChecked/> Prop is available in FanDuel</label>
   <label className="sm:col-span-2"><input name="confirmed" type="checkbox" required/> I compared the actual market in the FanDuel app; these are my observed values.</label>
   <button className="min-h-12 rounded border border-neon p-3" disabled={busy}>Save manual comparison / recheck</button>
  </form>{error&&<p role="alert">{error}</p>}
 </details>;
}
