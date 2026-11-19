'use client';
import type {DiscoveredProp} from '../../server/marketDiscovery.ts';
import {playerHeading,periodLabel} from '../../lib/propPresentation.ts';
export default function ExplorerPropCard({row:r,clock,gameLabel}:{row:DiscoveredProp;clock:number;gameLabel?:string}){
 const expired=r.fresh&&r.expiresAt&&Date.parse(r.expiresAt)<clock,validation=r.validation;
 const eligibility=r.period==='game'?validation?.eligibility.best:r.period==='q1'?validation?.quarter?.best:undefined;
 const excluded=expired?['Quote/source expired since this analysis; recheck freshness.']:(eligibility??r.limitations);
 return <article className="break-words rounded border border-line p-3" aria-label={`Prop ${r.player} ${r.period} ${r.side} ${r.line}`}>
  <h3 className="font-bold">{playerHeading(r)}</h3>
  <p>{gameLabel??'Game match needed'} · {r.audit.eventMatched&&r.kickoff?new Date(r.kickoff).toLocaleString():'Kickoff verification needed'}</p>
  <p>{r.category==='passing_rushing'?'Passing + rushing':r.category.replace(/_/g,' ')} · {periodLabel(r.period)} · {r.stat==='passing_rushing_yards'?'Passing + rushing yards':r.stat.replace(/_/g,' ')} · {r.side==='AtLeast'?`${r.line}+`:r.side==='unavailable'?'Line/side unavailable':`${r.side} ${r.line??'unavailable'}`} · {r.odds===null?'Odds unavailable':`${r.odds>0?'+':''}${r.odds}`}</p>
  <p>{r.source==='manual'?'Manually observed by user':'Independent API snapshot'} — not sportsbook-verified. {expired?'STALE — research only':r.freshness}</p>
  <p>Quote: {r.observedAt?new Date(r.observedAt).toLocaleString():'Timestamp missing'}{r.asOf?' · source as of '+new Date(r.asOf).toLocaleString():''}</p>
  <p className={excluded.length?'text-amber-200':'text-neon'}>{eligibility===undefined?'Period research':r.period==='game'?'Best Six':'Best Q1'}: {excluded.length?'Excluded / limited — '+excluded[0]:'Eligible research selection; not a validated recommendation.'}</p>
  {r.period==='game'&&validation&&<p>Aggressive Six: {expired?'Quote/source expired':validation.eligibility.aggr.length?validation.eligibility.aggr[0]:'Eligible research selection'}</p>}
  {r.analysis&&<p>Uncalibrated estimate {(100*('name'in r.analysis?r.analysis.scored!.p:r.analysis.probability)).toFixed(1)}% · {r.analysis.sample} historical games · last-5 hit rate {('name'in r.analysis?r.analysis.history?.last5?.hitRate:r.analysis.last5?.hitRate)??'unavailable'}. No validated EV or guaranteed outcome.</p>}
  <details className="mt-2"><summary className="cursor-pointer p-2">Verification details, exclusions and original provider record</summary>
   <p>Roster source: ESPN · checked {r.roster?.checkedAt??'not checked'} · player ID {r.roster?.playerId??'unresolved'} · status {r.roster?.status??'unknown'} · {r.roster?.reason??'No roster result'}</p>
   <p>Injury check: {validation?.injury.status??'not listed; not proof of health'} · covered {validation?.injury.covered?'yes':'no'} · snapshot {validation?.injury.snapshotAt??'missing'}.</p>
   <p>Opponent context: {r.analysis?('name'in r.analysis?r.analysis.history?.defense?.rank:r.analysis.defense?.rank)??'unavailable':'unavailable'} · historic identity {r.analysis?.historyPlayerId??'unverified'}.</p>
   {Object.entries(validation?.checks??{}).map(([name,c])=><p key={name}>{name}: {c.passed?'passed':`${c.state}: ${c.reasons.join(' ')}`}</p>)}
   {[...new Set([...excluded,...(validation?.eligibility.aggr??[]),...r.limitations,...(validation?.pipelineReasons??[])])].map((reason,i)=><p key={i}>{reason}</p>)}
   <p>Source {r.source} · provider quote {r.providerId} · provider athlete ID {r.providerPlayerId??'not supplied'} · provider event {r.providerEventId||'manual'} · verified event {r.gameId||'unmatched'}</p>
   <p>Original player: {r.audit.reportedPlayer}; team: {r.audit.reportedTeam??'not supplied'}; position: {r.audit.reportedPosition??'not supplied'}; stat: {r.audit.reportedStat}; period: {r.audit.reportedPeriod}; line: {r.audit.reportedLine??'missing'}; kickoff: {r.audit.reportedKickoff??'missing'}.</p>
   {(r.roster?.matches??[]).map((a,i)=><p key={i}>Roster match {a.id} · {a.name} · {a.team} · {a.position} · {a.status??'unknown'}</p>)}
  </details>
 </article>;
}
