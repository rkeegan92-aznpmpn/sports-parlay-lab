'use client';

import Link from 'next/link';
import { MARKET_CATALOG, type SportId } from '@/lib/sports/catalog';
import { useState } from 'react';

type Sport = SportId;
const sports: { id: Sport; title: string; detail: string }[] = [
  { id: 'NFL', title: 'Football', detail: 'Existing NFL workspace is available.' },
  { id: 'NBA', title: 'Basketball', detail: 'NBA markets and providers are not connected yet.' },
  { id: 'MLB', title: 'Baseball', detail: 'MLB markets and providers are not connected yet.' },
  { id: 'MMA', title: 'Mixed Martial Arts', detail: 'MMA markets and providers are not connected yet.' },
];

export default function SportsHome() {
  const [selected, setSelected] = useState<Sport>('NFL');
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
        <h3 className="font-semibold">Planned markets (not connected to live odds)</h3>
        <ul className="list-disc pl-5">{MARKET_CATALOG[selected].map((market) => <li key={market.key}>{market.label}</li>)}</ul>
        {selected === 'NFL' ? (
          <Link href="/" className="inline-block rounded bg-blue-700 px-4 py-2 text-white">Open NFL Parlay Lab</Link>
        ) : (
          <p role="status">Coming soon: verified events, supported player props, six-pick generation, and saved paper tickets. No betting or ticket generation is enabled for this sport yet.</p>
        )}
      </section>
      <p className="text-sm">Paper betting is simulated. This application does not place real wagers.</p>
    </main>
  );
}
