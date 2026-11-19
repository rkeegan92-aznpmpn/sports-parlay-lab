import {availabilityWarnings} from './availability.ts';
import type { BuildResult, Candidate, Kind, Pos, Ticket } from './types.ts';
import { americanToDecimal, decimalToAmerican, parlayDecimal } from './odds.ts';
import { DEFAULT_SIMULATIONS, simulate } from './sim.ts';
import { isPushLine } from './model.ts';
import { SUPPORTED_MARKETS } from './providers/oddsApi.ts';

export const SLOTS: Record<Pos, number> = { QB: 1, RB: 2, WR: 2, TE: 1 };
export const MAX_ODDS_AGE_MIN = 30;
export const MAX_LEGS_PER_GAME = 3;
const MAX_RANKED_TICKET_DECIMAL = 100;
export const CONFIG: Record<Kind, { minLeg: number; minSample: number; label: string }> = {
  best: { minLeg: 0.5, minSample: 5, label: 'Best Six' },
  aggr: { minLeg: 0.3, minSample: 6, label: 'Aggressive Six' },
};
const normalizedTeam = (team: string) => ({ LAR: 'LA', JAC: 'JAX', WSH: 'WAS' }[team.toUpperCase()] ?? team.toUpperCase());
const playerIdentity = (candidate: Candidate) => candidate.espnPlayerId
  ? `espn:${candidate.espnPlayerId.replace(/^espn:/, '')}`
  : candidate.historySource && candidate.historyPlayerId
    ? `${candidate.historySource}:${candidate.historyPlayerId}`
    : `${candidate.name.trim().toLowerCase()}|${normalizedTeam(candidate.team)}`;
const normalizedName=(name:string)=>name.toLowerCase().replace(/[.'’]/g,'').replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/\s+/g,' ').trim();
const samePlayer=(a:Candidate,b:Candidate)=>
  !!a.historyPlayerId&&a.historySource===b.historySource&&a.historyPlayerId===b.historyPlayerId ||
  !!a.espnPlayerId&&a.espnPlayerId.replace(/^espn:/,'')===b.espnPlayerId?.replace(/^espn:/,'') ||
  normalizedName(a.name)===normalizedName(b.name)&&normalizedTeam(a.team)===normalizedTeam(b.team);

/** Returns a list of problems; empty means valid. */
export function validateLegs(legs: Candidate[]): string[] {
  const errs: string[] = [];
  if (legs.length !== 6) errs.push(`Expected 6 legs, got ${legs.length}`);
  (Object.keys(SLOTS) as Pos[]).forEach((p) => {
    const n = legs.filter((l) => l.pos === p).length;
    if (n !== SLOTS[p]) errs.push(`Expected ${SLOTS[p]} ${p}, got ${n}`);
  });
  const names = legs.map((l) => `${l.name}|${l.team}`);
  if (new Set(names).size !== names.length) errs.push('Duplicate player');
  const identities = legs.map(playerIdentity);
  if (new Set(identities).size !== identities.length || legs.some((leg,i)=>legs.slice(i+1).some(other=>samePlayer(leg,other)))) errs.push('Duplicate verified player identity');
  const playerMarkets = legs.map((leg) => `${playerIdentity(leg)}|${leg.market}`);
  if (new Set(playerMarkets).size !== playerMarkets.length) errs.push('Duplicate player/market identity');
  if (legs.some((leg) => !leg.id.trim() || !leg.name.trim() || !leg.team.trim() || !leg.gameId.trim() ||
      !SUPPORTED_MARKETS.includes(leg.market) ||
      (leg.market === 'player_anytime_td'
        ? leg.side !== 'Yes' || leg.line !== null
        : !['Over', 'Under','AtLeast'].includes(leg.side) || leg.line == null || !Number.isFinite(leg.line)))) {
    errs.push('Invalid player/market identity');
  }
  const g: Record<string, number> = {};
  legs.forEach((l) => (g[l.gameId] = (g[l.gameId] || 0) + 1));
  if (Math.max(0, ...Object.values(g)) > MAX_LEGS_PER_GAME) errs.push(`More than ${MAX_LEGS_PER_GAME} legs from one game`);
  return errs;
}
export function eligible(kind: Kind, c: Candidate, now = Date.now()): boolean {
  return eligibilityWarnings(kind, c, now).length === 0;
}
export function eligibilityWarnings(kind: Kind, c: Candidate, now = Date.now()): string[] {
  const s = c.scored, cfg = CONFIG[kind], warnings: string[] = [];
  if (!s || !Number.isFinite(s.p) || s.p <= 0 || s.p >= 1) warnings.push('No valid probability estimate.');
  if (!Number.isFinite(c.odds) || Math.abs(c.odds) < 100) warnings.push('FanDuel American odds are invalid.');
  if (!SUPPORTED_MARKETS.includes(c.market)) warnings.push(`Unsupported FanDuel market key: ${c.market}.`);
  if (c.side === 'Yes' ? c.market !== 'player_anytime_td' : c.line == null || !Number.isFinite(c.line)) {
    warnings.push('FanDuel market side/line does not match a supported player-prop format.');
  }
  if (!c.gameId || !c.team || !c.opp || c.team === c.opp) warnings.push('FanDuel event or player-team mapping is invalid.');
  const eventTeams = c.eventLabel?.split(/\s+@\s+/);
  if (c.source !== 'demo' && (!eventTeams || eventTeams.length !== 2 ||
      new Set(eventTeams.map(normalizedTeam)).size !== 2 ||
      !eventTeams.map(normalizedTeam).includes(normalizedTeam(c.team)) ||
      !eventTeams.map(normalizedTeam).includes(normalizedTeam(c.opp)))) {
    warnings.push('Verified event label does not match the player team and opponent.');
  }
  warnings.push(...availabilityWarnings(c,now));
  if(c.oddsProvider==='fanduelapi'&&(s?.estimateBasis!=='verified-game-outcomes'||s.historicalHitGames<cfg.minSample))warnings.push('Insufficient verified line-specific outcomes for the historical probability estimate.');
  const oddsTs = Date.parse(c.oddsAt);
  const ageMin = (now - oddsTs) / 60000;
  if(c.oddsProvider==='fanduelapi' && (!c.providerPropId || !c.providerEventId || !c.providerAsOf || !(now-Date.parse(c.providerAsOf)>=-60000 && now-Date.parse(c.providerAsOf)<=MAX_ODDS_AGE_MIN*60000) ||
    c.providerDelaySeconds==null || !Number.isFinite(c.providerDelaySeconds) || c.providerDelaySeconds<0 || c.providerDelaySeconds>MAX_ODDS_AGE_MIN*60 || !['ok','delayed'].includes(c.providerSourceStatus??''))) warnings.push('Independent FanDuel feed provenance is stale, delayed beyond the freshness limit, or unverified.');
  if (!(ageMin >= -5 && ageMin <= MAX_ODDS_AGE_MIN)) warnings.push('FanDuel odds are stale, future-dated, or have an invalid timestamp.');
  if (!(Date.parse(c.kickoff) > now)) warnings.push('No valid upcoming kickoff.');
  if (!s || s.p < cfg.minLeg) warnings.push(`Estimated probability is below the ${Math.round(cfg.minLeg * 100)}% ticket threshold.`);
  if (c.sample < cfg.minSample) warnings.push(`Insufficient historical game sample (${c.sample}; requires ${cfg.minSample}).`);
  if (c.source !== 'demo' && (!c.history?.last10 || c.history.last10.hitGames < cfg.minSample || c.history.last10.hits == null)) {
    warnings.push(`Insufficient line-specific historical outcomes (${c.history?.last10?.hitGames ?? 0}; requires ${cfg.minSample}).`);
  }
  if (c.source !== 'demo' && (!c.historySource || !c.historyPlayerId)) warnings.push('Verified player identity/history is missing.');
  const proof = c.verification;
  if (c.source !== 'demo' && (
    c.eventVerified !== true || !proof || proof.event.id !== c.gameId ||
    proof.event.kickoff !== c.kickoff || proof.event.label !== c.eventLabel
  )) warnings.push('Exact FanDuel event ID, teams, or kickoff was not verified.');
  if (c.source !== 'demo' && (
    (c.source === 'manual' ? c.manualQuoteConfirmed !== true || c.quoteVerified !== false : c.quoteVerified !== true) || !proof || proof.quote.bookmaker !== 'fanduel' ||
    proof.quote.player !== c.name || proof.quote.market !== c.market ||
    proof.quote.side !== c.side || proof.quote.line !== c.line ||
    proof.quote.odds !== c.odds || proof.quote.updatedAt !== c.oddsAt
  )) warnings.push('Exact FanDuel player/market/line/odds/timestamp quote was not verified.');
  const historyIds = c.history?.last10?.results.map((result) => result.gameId) ?? [];
  if (c.source !== 'demo' && (
    c.historyVerified !== true || !proof || proof.history.playerId !== c.historyPlayerId ||
    proof.history.source !== c.historySource || proof.history.market !== c.market ||
    proof.history.line !== c.line || proof.history.gameIds.length < cfg.minSample ||
    historyIds.length < cfg.minSample ||
    historyIds.some((gameId) => !proof.history.gameIds.includes(gameId)) ||
    c.history?.last10?.results.some((result) => result.playerId !== c.historyPlayerId)
  )) warnings.push('Historical games were not verified against the matched player ID, market, line, and game IDs.');
  if (c.source !== 'demo' && c.rosterVerified !== true) warnings.push('Current NFL roster/team identity is unverified.');
  if (c.source !== 'demo' && c.odds >= 200 && c.marketPSource !== 'no-vig') {
    warnings.push('Long-shot price has no paired same-line FanDuel side for vig removal.');
  }
  if (c.source !== 'demo' && (c.roleSupported !== true || (c.roleGames ?? 0) < 3)) {
    warnings.push(`Recent expected role is unsupported (${c.roleGames ?? 0}/5 games with role usage; requires 3).`);
  }
  if (s?.suspiciousLongShot) warnings.push('Long-shot probability is materially unsupported by historical outcomes.');
  if (c.source !== 'demo' && s && (!Number.isFinite(s.ev) || s.ev <= 0)) warnings.push('Estimated EV is not positive at the current FanDuel price.');
  return warnings;
}
export function warningsFor(legs: Candidate[], now = Date.now()): string[] {
  const w: string[] = [
    'Combined price and return are theoretical products of individual leg prices; FanDuel acceptance and its combined quote are unverified.',
    'All probabilities are unvalidated research estimates, not calibrated forecasts. Joint probability uses assumed Gaussian-copula correlation loadings (team 0.30, game 0.12), not correlations fitted to settled outcomes.',
  ];
  if (legs.some((leg) => leg.scored?.conditionalOnNoPush || isPushLine(leg))) {
    w.push('Integer-line probabilities are conditional on no push; theoretical joint probability, EV, and returns do not model FanDuel void-leg repricing when a selection pushes.');
  }
  legs.forEach((l) => {
    if(l.oddsProvider==='fanduelapi') w.push(`${l.name}: independent fanduelapi.com snapshot, as of ${l.providerAsOf}; reported delay ${l.providerDelaySeconds} seconds. This does not establish current sportsbook availability or an accepted combined price.`);
    if (l.source === 'manual') w.push(`${l.name}: MANUAL FANDUEL QUOTE — user-entered, not independently verified live odds. Recheck against FanDuel before use.`);
    if (l.source === 'demo') w.push(`${l.name}: Demo Data`);
    if (l.injury) w.push(`${l.name}: listed ${l.injury}`);
    if (l.scored?.stale) {
      const ageMin = (now - Date.parse(l.oddsAt)) / 60000;
      const age = !Number.isFinite(ageMin) ? 'timestamp unavailable'
        : ageMin < -5 ? `${Math.round(-ageMin)} min in the future`
          : `${Math.round(ageMin)} min old`;
      w.push(`${l.name}: odds are stale or have an invalid timestamp (${age}); refresh before relying on this ticket.`);
    }
    if (l.scored?.suspiciousLongShot) w.push(`${l.name}: modeled probability is unusually high relative to its long-shot price (${Math.round(l.scored.p * 100)}% model vs ${Math.round(l.scored.marketP * 100)}% market-implied).`);
    if (!l.sample) w.push(`${l.name}: player history is missing; the pick is not supported by historical statistics.`);
    if (l.sample < 6) w.push(`${l.name}: small sample (${l.sample} games)`);
  });
  if (legs.some((leg) => (leg.scored?.p ?? 0) >= 0.9)) {
    w.push('One or more leg forecasts are at least 90%; treat these as unverified model estimates and review calibration.');
  }
  const g: Record<string, number> = {};
  legs.forEach((l) => (g[l.gameId] = (g[l.gameId] || 0) + 1));
  if (Object.values(g).some((n) => n > 1)) w.push('Same-game parlay pricing is especially dependent on correlation and is not estimated from an actual FanDuel quote.');
  return w;
}
export function makeTicket(legs: Candidate[], kind: Kind, o: { seed?: number; avoid?: Set<string>; now?: number; testMode?: boolean; modelValidated?: boolean; pregameResearch?: boolean } = {}): Ticket {
  const errs = validateLegs(legs);
  if (errs.length) throw new Error(`Invalid ticket: ${errs.join('; ')}`);
  const now = o.now ?? Date.now();
  const selectionErrors = legs.flatMap((leg) => eligibilityWarnings(kind, leg, now).map((warning) => `${leg.name}: ${warning}`));
  if (selectionErrors.length) throw new Error(`Invalid ticket selections: ${selectionErrors.join('; ')}`);
  if (legs.some((leg) => leg.source === 'demo')) {
    throw new Error('Invalid ticket: demo or non-live picks do not have verifiable FanDuel quotes.');
  }
  if(legs.some(l=>l.oddsProvider==='fanduelapi') && !o.pregameResearch && !o.testMode) throw new Error('Independent FanDuel feed selections are research only.');
  if (o.modelValidated !== true && o.testMode !== true && o.pregameResearch !== true) {
    throw new Error('Invalid ticket: the probability model has not passed chronological calibration validation.');
  }
  const manual=legs.some(l=>l.source==='manual');
  if(manual && !o.pregameResearch && !o.testMode) throw new Error('Manual quotes are research only; never validated recommendations.');
  const decimal = parlayDecimal(legs.map((leg) => leg.odds));
  const indepP = legs.reduce((a, l) => a * (l.scored?.p ?? 0), 1);
  const { jointP, se: jointSe, lower95: jointLower95, upper95: jointUpper95 } = simulate(legs, { seed: o.seed ?? 1 });
  const ev = jointP * decimal - 1;
  const evLower95 = jointLower95 * decimal - 1;
  const overlap = o.avoid ? legs.filter((l) => o.avoid!.has(l.id)).length : 0;
  const averageLegEv = legs.reduce((sum, leg) => sum + (leg.scored?.ev ?? -1), 0) / legs.length;
  const score = kind === 'best'
    ? 0.75 * jointP + 0.25 * Math.max(-1, Math.min(1, averageLegEv))
    : 0.3 * Math.max(-1, Math.min(1, evLower95)) +
      0.7 * Math.min(Math.log(decimal), Math.log(MAX_RANKED_TICKET_DECIMAL)) / Math.log(MAX_RANKED_TICKET_DECIMAL) -
      0.04 * overlap;
  const warnings = warningsFor(legs, now);
  if (o.modelValidated !== true && o.testMode !== true) warnings.unshift('PRE-GAME RESEARCH — estimated probabilities and EV are unvalidated. Real-money recommendations remain locked until calibration passes.');
  if (o.testMode === true) warnings.unshift('TEST MODE — research only. Not a validated recommendation. Do not use for real-money wagers.');
  if (jointP * DEFAULT_SIMULATIONS < 25) {
    warnings.push('The joint-probability estimate is based on fewer than 25 simulated wins and is noisy; its interval does not include model or pricing uncertainty.');
  }
  return {
    status: 'pending',
    purpose: o.testMode === true ? 'test-research' : manual ? 'manual-research' : o.modelValidated === true ? 'validated-research' : 'pregame-research',
    legs,
    decimal,
    american: decimalToAmerican(decimal),
    jointP,
    jointSe,
    jointLower95,
    jointUpper95,
    indepP,
    ev, evLower95,
    score,
    priceBasis: 'product-of-individual-leg-prices',
    sportsbookQuoteVerified: false,
    warnings,
  };
}
const pairs = <T,>(a: T[]) => a.flatMap((x, i) => a.slice(i + 1).map((y): [T, T] => [x, y]));

/** Observed opponent allowance rank is a small ranking signal, never a fabricated probability adjustment. */
export function matchupSupport(c: Candidate): number {
  const d = c.history?.defense;
  if (!d || d.games < 4 || d.teams < 2 || !Number.isFinite(d.rank) || d.rank < 1 || d.rank > d.teams) return 0;
  const allowance = (d.rank - 1) / (d.teams - 1);
  return (c.side === 'Under' ? 1 - allowance : allowance) - 0.5;
}

export function build(kind: Kind, pool: Candidate[], o: { now?: number; avoid?: Set<string>; top?: number; testMode?: boolean; modelValidated?: boolean; pregameResearch?: boolean; minDecimal?: number } = {}): BuildResult {
  const now = o.now ?? Date.now();
  const rank = (c: Candidate) => kind === 'best'
    ? 0.55 * c.scored!.p + 0.25 * Math.max(-1, Math.min(1, c.scored!.ev)) + 0.2 * Math.min(c.sample, 10) / 10 + 0.02 * matchupSupport(c)
    : 0.25 * Math.max(-1, Math.min(1, c.scored!.ev)) +
      0.75 * Math.min(Math.log(americanToDecimal(c.odds)), Math.log(10)) / Math.log(10) + 0.02 * matchupSupport(c);
  const counts: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const best = new Map<string, Candidate>(); // one candidate per verified player so slots are not wasted
  for (const c of pool.filter((x) => eligible(kind, x, now))) {
    let k = playerIdentity(c), cur = best.get(k);
    if(!cur){const alias=[...best.entries()].find(([,old])=>samePlayer(c,old));if(alias)[k,cur]=alias;}
    if (!cur || rank(c) > rank(cur)) best.set(k, c);
  }
  const by = (p: Pos, n: number) => [...best.values()].filter((c) => c.pos === p).sort((a, b) => rank(b) - rank(a)).slice(0, n);
  const Q = by('QB', 6), R = by('RB', 8), W = by('WR', 10), T = by('TE', 6);
  counts.QB = Q.length; counts.RB = R.length; counts.WR = W.length; counts.TE = T.length;
  const missing = (Object.keys(SLOTS) as Pos[]).filter((p) => counts[p] < SLOTS[p]).map((p) => `${SLOTS[p]} ${p} (have ${counts[p]})`);
  if (missing.length) {
    if (o.modelValidated !== true && o.testMode !== true && o.pregameResearch !== true) missing.push('chronological probability calibration has not met the validation thresholds');
    if (pool.some((candidate) => candidate.source === 'demo')) missing.push('live FanDuel event, quote, and player-history verification (demo data cannot qualify)');
    return { options: [], missing, counts };
  }
  if (pool.some((candidate) => candidate.source === 'demo')) {
    return { options: [], missing: ['live FanDuel event, quote, and player-history verification (demo data cannot qualify)'], counts };
  }
  if (o.modelValidated !== true && o.testMode !== true && o.pregameResearch !== true) {
    return { options: [], missing: ['chronological probability calibration has not met the validation thresholds'], counts };
  }
  const supportingGames = new Set([...best.values()].map((candidate) => candidate.gameId));
  if (supportingGames.size < 2) {
    return { options: [], missing: ['eligible props from at least 2 games (maximum 3 picks per game)'], counts };
  }
  const cand: { legs: Candidate[]; q: number }[] = [];
  for (const q of Q) for (const r of pairs(R)) for (const w of pairs(W)) for (const t of T) {
    const legs = [q, ...r, ...w, t];
    if (validateLegs(legs).length) continue;
    const dec = parlayDecimal(legs.map((leg) => leg.odds));
    if (o.minDecimal != null && dec <= o.minDecimal) continue;
    const ov = o.avoid ? legs.filter((l) => o.avoid!.has(l.id)).length : 0;
    const meanLegScore = legs.reduce((sum, leg) => sum + rank(leg), 0) / legs.length;
    cand.push({ legs, q: kind === 'best'
      ? meanLegScore
      : 0.25 * legs.reduce((sum, leg) => sum + rank(leg), 0) / legs.length +
        0.75 * Math.min(Math.log(dec), Math.log(MAX_RANKED_TICKET_DECIMAL)) / Math.log(MAX_RANKED_TICKET_DECIMAL) -
        0.04 * ov });
  }
  cand.sort((a, b) => b.q - a.q);
  const evaluated = cand.slice(0, o.top ?? 50).map((c, i) => makeTicket(c.legs, kind, { seed: 100 + i, avoid: o.avoid, now, testMode: o.testMode, modelValidated: o.modelValidated, pregameResearch: o.pregameResearch }));
  const options = evaluated
    .filter((ticket) => ticket.evLower95 > 0)
    .sort((a, b) => b.score - a.score);
  return {
    options,
    missing: options.length ? [] : [
      ...(o.minDecimal != null ? ['no Aggressive Six combination has a higher theoretical price than Best Six'] : []),
      'no six-leg combination has positive EV even at the simulation 95% lower bound (model uncertainty is not included)',
    ],
    counts,
  };
}
/** Best Six first; Aggressive Six then avoids its players unless alternatives are clearly worse. */
export function generate(pool: Candidate[], now = Date.now(), options: { testMode?: boolean; modelValidated?: boolean; pregameResearch?: boolean } = {}) {
  const best = build('best', pool, { now, testMode: options.testMode, modelValidated: options.modelValidated, pregameResearch: options.pregameResearch });
  const avoid = new Set(best.options[0]?.legs.map((l) => l.id) ?? []);
  return {
    best,
    aggr: build('aggr', pool, {
      now, avoid, testMode: options.testMode, modelValidated: options.modelValidated, pregameResearch: options.pregameResearch, minDecimal: best.options[0]?.decimal,
    }),
  };
}
