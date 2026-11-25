'use client';

import Link from 'next/link';
import { MARKET_CATALOG, type SportId } from '@/lib/sports/catalog';
import { useEffect, useState } from 'react';

type Sport = SportId;
type Leg = {event:string; market:string; name:string; price:number; point?:number; player?:string; starts:string};
type Ticket = {id:string; sport:Sport; legs:Leg[]; created:string; stake:number};
function available(data:unknown, now=Date.now()):Leg[] {
 if(!Array.isArray(data)) return [];
 const open=(x:any)=>x && !x.redacted && !x.suspended && !x.live && x.active!==false && x.suspended_at==null && [x.status,x.market_status].every(v=>v==null||['open','active'].includes(String(v).toLowerCase()));
 const result:Leg[]=[];
 for(const e of data){if(!open(e)||!Number.isFinite(Date.parse(e.commence_time))||Date.parse(e.commence_time)<=now)continue;
 for(const b of Array.isArray(e.bookmakers)?e.bookmakers:[]){if(!open(b)||b.key!=='fanduel')continue;
 for(const m of Array.isArray(b.markets)?b.markets:[]){if(!open(m)||m.period!=null||typeof m.key!=='string')continue;
 for(const o of Array.isArray(m.outcomes)?m.outcomes:[]){const at=Date.parse(o.last_seen_at??m.last_update);
 if(!open(o)||typeof o.name!=='string'||!Number.isInteger(o.price)||Math.abs(o.price)<100||Math.abs(o.price)>100000||!Number.isFinite(at)||now-at>1800000||at>now+60000)continue;
 result.push({event:String(e.away_team)+' @ '+String(e.home_team),market:m.key,name:o.name,price:o.price,point:typeof o.point==='number'?o.point:undefined,player:typeof o.description==='string'?o.description:undefined,starts:e.commence_time});
 }}}}
 return result;
}
function options(rows:Leg[], count:number):Leg[][] {
 const groups=new Map<string,Leg[]>();for(const l of rows){const k=l.event+'|'+l.starts;const g=groups.get(k)??[];if(!g.some(x=>JSON.stringify(x)===JSON.stringify(l)))g.push(l);groups.set(k,g);}
 const events=[...groups.values()];if(events.length<count)return [];
 const out:Leg[][]=[];for(let i=0;i<4;i++){const legs=Array.from({length:count},(_,j)=>{const g=events[(j+i)%events.length];return g[i%g.length];});const key=(ls:Leg[])=>ls.map(l=>JSON.stringify(l)).sort().join('|');if(!out.some(x=>key(x)===key(legs)))out.push(legs);}return out;
}
const sports: { id: Sport; title: string; detail: string }[] = [
  { id: 'NFL', title: 'Football', detail: 'Existing NFL workspace is available.' },
  { id: 'NBA', title: 'Basketball', detail: 'NBA snapshot and simulated tickets.' },
  { id: 'MLB', title: 'Baseball', detail: 'MLB snapshot and simulated tickets.' },
  { id: 'MMA', title: 'Mixed Martial Arts', detail: 'MMA snapshot and simulated tickets.' },
];

export default function SportsHome() {
  const [selected, setSelected] = useState<Sport>('NFL');
  const [feed, setFeed] = useState<{status: string; fetchedAt?: string | null; quotaRemaining?: string | null; data?: unknown; error?: string} | null>(null);
  const [count,setCount]=useState(6);
  const [generated,setGenerated]=useState<Leg[][]>([]);
  const [tickets,setTickets]=useState<Ticket[]>([]);
  const [notice,setNotice]=useState('');
  useEffect(()=>{try{const raw=JSON.parse(localStorage.getItem('sports-paper-v1')??'[]');if(Array.isArray(raw))setTickets(raw);}catch{setNotice('Saved tickets could not be read.');}},[]);
  function save(legs:Leg[]){try{if(legs.some(l=>Date.parse(l.starts)<=Date.now())||!legs.every(l=>available(feed?.data).some(x=>JSON.stringify(x)===JSON.stringify(l)))){setNotice('Prices expired; generate again from a fresh snapshot.');return;}const ticket:Ticket={id:crypto.randomUUID(),sport:selected,legs,created:new Date().toISOString(),stake:10};const next=[...tickets,ticket];localStorage.setItem('sports-paper-v1',JSON.stringify(next));setTickets(next);setNotice('Simulated $10 ticket saved locally.');}catch{setNotice('Ticket could not be saved.');}}
  useEffect(() => {
    let active = true;
    setFeed(null); setGenerated([]); setNotice('');
    fetch(`/api/sports/odds?sport=${selected}`, { cache: 'no-store' })
      .then(async response => response.json())
      .then(result => { if (active) setFeed(result); })
      .catch(() => { if (active) setFeed({ status: 'unavailable', error: 'Could not load odds feed' }); });
    return () => { active = false; };
  }, [selected]);
  const current = sports.find((sport) => sport.id === selected)!;
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Sports Parlay Lab</h1>
        <p>Choose a sport. Availability is labeled clearly; no demo odds are represented as live prices.</p>
      </header>
      <nav aria-label="Sports" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {sports.map((sport) => (
          <button key={sport.id} type="button" aria-pressed={selected === sport.id}
            onClick={() => setSelected(sport.id)}
            className={`rounded-lg border p-4 text-left ${selected === sport.id ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-400'}`}>
            <strong className="block">{sport.id}</strong><span>{sport.title}</span>
          </button>
        ))}
      </nav>
      <section aria-live="polite" className="rounded-lg border p-5 space-y-3">
        <h2 className="text-xl font-semibold">{current.id} — {current.title}</h2>
        <p>{current.detail}</p>
        <div className="rounded border p-3 space-y-1">
          <strong>PropLine daily odds snapshot</strong>
          <p role="status">Status: {feed?.status ?? 'Loading'}</p>
          <p>Last fetched: {feed?.fetchedAt ? new Date(feed.fetchedAt).toLocaleString() : 'Not yet'}</p>
          {feed?.quotaRemaining != null && <p>API requests remaining today: {feed.quotaRemaining}</p>}
          {feed?.error && <p>{feed.error}</p>}
          {Array.isArray(feed?.data) && <p>Events returned: {feed.data.length}</p>}
          <p className="text-sm">Odds are snapshots, not guaranteed current prices. Refreshes after 24 hours while the app is running and accessed; scheduled unattended collection requires separate hosting.</p>
        </div>
        <h3 className="font-semibold">Planned markets (not connected to live odds)</h3>
        <ul className="list-disc pl-5">{MARKET_CATALOG[selected].map((market) => <li key={market.key}>{market.label}</li>)}</ul>
        {selected === 'NFL' ? (
          <Link href="/" className="inline-block rounded bg-blue-700 px-4 py-2 text-white">Open NFL Parlay Lab</Link>
        ) : (
          <div className="space-y-3">
            <p>Paper-only research combinations from available FanDuel quotes; one leg per event. No probability or edge model is implied.</p>
            <label>Leg count <select className="border rounded p-2 text-black" value={count} onChange={e=>{setCount(Number(e.target.value));setGenerated([]);}}>{[4,5,6,7,8].map(n=><option key={n}>{n}</option>)}</select></label>
            <button className="rounded bg-blue-700 px-4 py-2 text-white" disabled={!['cached','updated'].includes(feed?.status??'')} onClick={()=>{const next=options(available(feed?.data),count);setGenerated(next);setNotice(next.length?next.length+' distinct options generated.':'Not enough distinct upcoming events with fresh FanDuel prices. No fabricated picks.');}}>Generate options</button>
            <p role="status">{notice}</p>
            {generated.map((legs,i)=><article key={i} className="border rounded p-3"><h3>Option {i+1}</h3><ul>{legs.map((l,j)=><li key={j}>{l.event} — {l.player??''} {l.market} {l.name} {l.point??''} ({l.price>0?'+':''}{l.price})</li>)}</ul><button className="rounded border p-2" onClick={()=>save(legs)}>Save $10 paper ticket</button></article>)}
            <h3>Saved paper tickets (this browser)</h3>
            {tickets.filter(t=>t.sport===selected).map(t=><article key={t.id} className="border rounded p-3"><p>{new Date(t.created).toLocaleString()} — simulated ${t.stake} — ungraded</p><ul>{t.legs.map((l,i)=><li key={i}>{l.event} — {l.player??''} {l.market} {l.name} {l.point??''} ({l.price})</li>)}</ul></article>)}
          </div>
        )}
      </section>
      <p className="text-sm">Paper betting is simulated. This application does not place real wagers.</p>
    </main>
  );
}
