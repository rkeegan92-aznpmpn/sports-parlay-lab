import test from 'node:test';
import assert from 'node:assert/strict';
import { poissonCdf, rawProbability, scoreAll, scoreCandidate } from '../src/lib/model.ts';
import { simulate } from '../src/lib/sim.ts';
import { build, generate, validateLegs, makeTicket, eligible, eligibilityWarnings, matchupSupport } from '../src/lib/optimizer.ts';
import { americanToDecimal, decimalToAmerican } from '../src/lib/odds.ts';
import { demoResult } from '../src/lib/service.ts';
import type { Candidate } from '../src/lib/types.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const demo = () => demoResult(NOW).candidates;
const pick = (ids: string[]) => ids.map((i) => demo().find((c) => c.id === i)!);
const verifiedLivePool = () => demo().map((candidate) => {
  const gameResults = Array.from({ length: 10 }, (_, index) => ({
    date: new Date(NOW - (index + 1) * 864e5).toISOString(),
    season: 2026, week: index + 1, team: candidate.team, opponent: candidate.opp, value: candidate.mean,
    gameId: `${candidate.id}-history-${index}`, playerId: `gsis-${candidate.id}`,
  }));
  const history = {
    last5: null,
    last10: { games: 10, average: candidate.mean, median: candidate.mean, consistency: null, hits: 8, hitRate: 0.8, hitGames: 10, results: gameResults },
    trend: null, homeAverage: null, awayAverage: null, opportunityAverage: 10,
    roleGames: 5, snapAverage: null, snapCounts: null, defense: null, playingTime: 'unavailable' as const,
  };
  const live = {
    ...candidate, source: 'live' as const, history, sample: 10,
    historySource: 'nflverse' as const, historyPlayerId: `gsis-${candidate.id}`,
    eventLabel: `${candidate.team} @ ${candidate.opp}`,
    rosterVerified: true, rosterStatus: 'Active', roleSupported: true, roleGames: 5,
    eventVerified: true, quoteVerified: true, historyVerified: true,
    marketP: 0.5, marketPSource: 'no-vig' as const,
    oddsAt: new Date(NOW).toISOString(), kickoff: new Date(NOW + 3600_000).toISOString(),
    verification: {
      event: { id: candidate.gameId, kickoff: new Date(NOW + 3600_000).toISOString(), label: `${candidate.team} @ ${candidate.opp}` },
      quote: { bookmaker: 'fanduel' as const, player: candidate.name, market: candidate.market, side: candidate.side, line: candidate.line, odds: candidate.odds, updatedAt: new Date(NOW).toISOString() },
      history: { source: 'nflverse' as const, playerId: `gsis-${candidate.id}`, market: candidate.market, line: candidate.line, gameIds: gameResults.map((result) => result.gameId) },
    },
  };
  return { ...live, scored: scoreCandidate(live, NOW) };
});
const livePick = (ids: string[]) => ids.map((id) => verifiedLivePool().find((candidate) => candidate.id === id)!);

test('poisson and normal sanity', () => {
  assert.ok(Math.abs(poissonCdf(0, 1) - Math.exp(-1)) < 1e-9);
  const over = rawProbability({ market: 'player_rush_yds', side: 'Over', line: 50, mean: 50, sd: 20 });
  assert.ok(Math.abs(over - 0.5) < 0.01);
  const u = rawProbability({ market: 'player_rush_yds', side: 'Under', line: 50, mean: 50, sd: 20 });
  assert.ok(Math.abs(over + u - 1) < 1e-9);
});
test('integer count-line probabilities condition on non-push outcomes', () => {
  const underOne = rawProbability({
    market: 'player_receptions',
    side: 'Under',
    line: 1,
    mean: 1,
    sd: 1,
  });
  assert.ok(Math.abs(underOne - Math.exp(-1) / (1 - Math.exp(-1))) < 1e-9);
});
test('integer count-line estimates and ticket returns disclose push limitations', () => {
  const base = demo()[0];
  const scored = scoreCandidate({ ...base, market: 'player_receptions', line: 1, side: 'Under', mean: 1 }, NOW);
  assert.equal(scored.conditionalOnNoPush, true);
  const legs = livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']);
  legs[3] = {
    ...legs[3],
    market: 'player_receptions',
    line: 4,
    side: 'Under',
    mean: 4,
    verification: {
      ...legs[3].verification!,
      quote: { ...legs[3].verification!.quote, market: 'player_receptions', line: 4, side: 'Under' },
      history: { ...legs[3].verification!.history, market: 'player_receptions', line: 4 },
    },
    scored: scoreCandidate({ ...legs[3], market: 'player_receptions', line: 4, side: 'Under', mean: 4 }, NOW),
  };
  assert.ok(makeTicket(legs, 'best', { seed: 3, now: NOW, modelValidated: true }).warnings.some((warning) => warning.includes('void-leg repricing')));
});
test('historical-only probability is independent from market price and exposes EV, edge, and fair odds', () => {
  const base = demo()[0];
  const history = {
    last5: null,
    last10: { games: 10, average: 80, median: 80, consistency: null, hits: 8, hitRate: 0.8, hitGames: 10, results: [] },
    trend: null, homeAverage: null, awayAverage: null, opportunityAverage: null,
    roleGames: 5, snapAverage: null, snapCounts: null, defense: null, playingTime: 'unavailable' as const,
  };
  const score = scoreCandidate({ ...base, marketP: 0.5, history, sample: 10, mean: 80, sd: 10 }, NOW);
  const anotherMarket = scoreCandidate({ ...base, marketP: 0.9, history, sample: 10, mean: 80, sd: 10 }, NOW);
  assert.equal(score.marketP, 0.5);
  assert.equal(score.p, 10 / 14, 'Beta(2,2)-smoothed hit rate is estimated without odds input');
  assert.equal(score.historicalHitRate, 0.8, 'raw historical hit rate is exposed separately from the smoothed estimate');
  assert.equal(score.historicalHitGames, 10);
  assert.equal(score.p, anotherMarket.p);
  assert.ok(Math.abs(score.edge - (score.p - score.marketP)) < 1e-12);
  assert.ok(Math.abs(score.ev - (score.p * (1 + 100 / 114) - 1)) < 1e-12);
  assert.equal(score.fairOdds, decimalToAmerican(1 / score.p));
  assert.equal(score.confidence, 'Unvalidated');
});
test('historical smoothing is independent of price and unavailable players are ineligible', () => {
  const base = demo().find((c) => c.id === 'q1')!;
  const small = scoreCandidate({ ...base, sample: 1 }, NOW), big = scoreCandidate({ ...base, sample: 40 }, NOW);
  assert.equal(small.p, big.p);
  assert.equal(scoreCandidate({ ...base, injury: 'Questionable' }, NOW).p, big.p);
  assert.equal(eligible('best', { ...base, injury: 'Out' }, NOW), false);
});
test('extreme model inputs cannot produce certainty or invalid probabilities', () => {
  const base = demo()[0];
  const extremeOver = scoreCandidate({ ...base, mean: 1e9, sd: 0.1, sample: 1000 }, NOW);
  const extremeUnder = scoreCandidate({ ...base, mean: -1e9, sd: 0.1, sample: 1000 }, NOW);
  assert.ok(extremeOver.raw > 0.99);
  assert.ok(extremeOver.p < 1 && extremeOver.p > extremeOver.marketP);
  assert.ok(extremeUnder.raw < 0.01);
  assert.ok(extremeUnder.p > 0 && extremeUnder.p < extremeUnder.marketP);
  assert.throws(() => scoreCandidate({ ...base, sd: -1 }, NOW), RangeError);
  assert.throws(() => scoreCandidate({ ...base, mean: Infinity }, NOW), RangeError);
});
test('stale odds are flagged and excluded', () => {
  const c = demo().find((x) => x.id === 'q3')!;
  assert.equal(c.scored!.stale, true);
  assert.equal(eligible('best', c, NOW), false);
  assert.equal(eligible('aggr', c, NOW), false);
});
test('live eligibility requires positive independent EV, verified roster, and recent role support', () => {
  const base = demo()[0];
  const historyGameIds = Array.from({ length: 10 }, (_, index) => `history-${index}`);
  const history = {
    last5: null,
    last10: {
      games: 10, average: 80, median: 80, consistency: null, hits: 9, hitRate: 0.9, hitGames: 10,
      results: historyGameIds.map((gameId, index) => ({
        date: new Date(NOW - (index + 1) * 864e5).toISOString(),
        season: 2026, week: index + 1, team: base.team, opponent: base.opp, value: 80, gameId, playerId: 'player-1',
      })),
    },
    trend: null, homeAverage: null, awayAverage: null, opportunityAverage: 12,
    roleGames: 5, snapAverage: null, snapCounts: null, defense: null, playingTime: 'unavailable' as const,
  };
  const live = {
    ...base, source: 'live' as const, history, sample: 10, historySource: 'nflverse' as const, historyPlayerId: 'player-1',
    rosterVerified: true, rosterStatus: 'Active', roleSupported: true, roleGames: 5,
    eventVerified: true, quoteVerified: true, historyVerified: true,
    eventLabel: `${base.team} @ ${base.opp}`,
    oddsAt: new Date(NOW).toISOString(), kickoff: new Date(NOW + 3600_000).toISOString(),
    marketP: 0.5,
    verification: {
      event: { id: base.gameId, kickoff: new Date(NOW + 3600_000).toISOString(), label: `${base.team} @ ${base.opp}` },
      quote: { bookmaker: 'fanduel' as const, player: base.name, market: base.market, side: base.side, line: base.line, odds: -110, updatedAt: new Date(NOW).toISOString() },
      history: { source: 'nflverse' as const, playerId: 'player-1', market: base.market, line: base.line, gameIds: historyGameIds },
    },
  };
  const alternate = { ...live, odds: -1400, scored: scoreCandidate({ ...live, odds: -1400 }, NOW) };
  const standard = {
    ...live, odds: -110,
    verification: { ...live.verification, quote: { ...live.verification.quote, odds: -110 } },
    scored: scoreCandidate({ ...live, odds: -110 }, NOW),
  };
  assert.ok(alternate.scored.ev < 0);
  assert.equal(eligible('best', alternate, NOW), false);
  assert.equal(eligible('best', standard, NOW), true);
  assert.equal(eligible('best', { ...standard, rosterStatus: 'Inactive' }, NOW), false);
  assert.equal(eligible('best', { ...standard, roleSupported: false }, NOW), false);
  assert.equal(eligible('best', { ...standard, eventVerified: false }, NOW), false);
  assert.equal(eligible('best', { ...standard, quoteVerified: false }, NOW), false);
  assert.equal(eligible('best', { ...standard, historyVerified: false }, NOW), false);
  assert.equal(eligible('best', { ...standard, market: 'player_pass_yds_q1' }, NOW), false);
  assert.equal(eligible('best', { ...standard, line: null }, NOW), false);
  assert.ok(eligibilityWarnings('best', { ...standard, eventVerified: false }, NOW).some((warning) => warning.includes('event ID')));
  assert.ok(eligibilityWarnings('best', { ...standard, history: undefined }, NOW).some((warning) => warning.includes('line-specific historical outcomes')));
  const oneSidedLongShot = {
    ...standard,
    odds: 200,
    marketP: 0.4,
    marketPSource: 'single-side' as const,
    history: {
      ...standard.history,
      last10: { ...standard.history.last10!, hits: 4, hitRate: 0.4 },
    },
    verification: {
      ...standard.verification!,
      quote: { ...standard.verification!.quote, odds: 200 },
    },
  };
  oneSidedLongShot.scored = scoreCandidate(oneSidedLongShot, NOW);
  assert.ok(eligibilityWarnings('aggr', oneSidedLongShot, NOW).some((warning) => warning.includes('paired same-line')));
});
test('high model probability on a long-shot price is flagged and excluded from Best Six', () => {
  const base = demo()[0];
  const longShot = {
    ...base,
    odds: 500,
    sample: 100,
    mean: 1e9,
    sd: 0.1,
    scored: scoreCandidate({ ...base, odds: 500, sample: 100, mean: 1e9, sd: 0.1 }, NOW),
  };
  assert.ok(longShot.scored.p > longShot.scored.marketP);
  assert.equal(longShot.scored.suspiciousLongShot, true);
  assert.equal(eligible('best', longShot, NOW), false);
  assert.equal(eligible('aggr', longShot, NOW), false);
  const moderateLongShot = { ...base, odds: 200, sample: 100, mean: 1e9, sd: 0.1 };
  assert.equal(scoreCandidate(moderateLongShot, NOW).suspiciousLongShot, true);
  assert.throws(() => makeTicket([
    ...pick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']).slice(0, 5),
    { ...longShot, pos: 'TE', gameId: 'other-game', name: 'Long Shot TE' },
  ], 'aggr', { seed: 2, now: NOW, modelValidated: true }), /Long-shot probability is materially unsupported/);
});
test('correlated legs raise joint probability above the independent product', () => {
  const mk = (id: string, team: string): Candidate => ({ ...demo()[0], id, team, scored: { ...demo()[0].scored!, p: 0.5 } });
  const legs = [mk('a', 'X'), mk('b', 'X')];
  const corr = simulate(legs, { n: 40000, seed: 7, teamLoad: 0.8, gameLoad: 0.1 }).jointP;
  const indep = simulate(legs, { n: 40000, seed: 7, teamLoad: 0.001, gameLoad: 0.001 }).jointP;
  assert.ok(Math.abs(indep - 0.25) < 0.02);
  assert.ok(corr > indep + 0.05, `${corr} vs ${indep}`);
  const gameCorr = simulate([mk('c', 'X'), mk('d', 'Y')], { n: 40000, seed: 7, teamLoad: 0.001, gameLoad: 0.8 }).jointP;
  assert.ok(gameCorr > indep + 0.05, `${gameCorr} vs ${indep}`);
});
test('copula simulation preserves an individual leg probability', () => {
  const leg = { ...demo()[0], scored: { ...demo()[0].scored!, p: 0.8 } };
  const result = simulate([leg], { n: 50_000, seed: 912 });
  assert.ok(Math.abs(result.jointP - 0.8) < 0.015, `${result.jointP}`);
  assert.ok(result.se > 0 && result.se < 0.01);
  assert.ok(result.lower95 < result.jointP && result.upper95 > result.jointP);
  const noObservedHits = simulate([{ ...leg, scored: { ...leg.scored!, p: 0 } }], { n: 1000, seed: 912 });
  assert.equal(noObservedHits.jointP, 0);
  assert.equal(noObservedHits.lower95, 0);
  assert.ok(noObservedHits.upper95 > 0, 'zero simulated wins still has a non-zero upper confidence bound');
});
test('exact six-position composition and no duplicates in generated tickets', () => {
  const g = generate(verifiedLivePool(), NOW, { modelValidated: true });
  for (const k of ['best', 'aggr'] as const) {
    assert.ok(g[k].options.length > 0, `${k} produced no options`);
    for (const t of g[k].options) {
      assert.deepEqual(validateLegs(t.legs), []);
      const c = (p: string) => t.legs.filter((l) => l.pos === p).length;
      assert.deepEqual([c('QB'), c('RB'), c('WR'), c('TE')], [1, 2, 2, 1]);
      assert.equal(new Set(t.legs.map((l) => l.name)).size, 6);
      assert.ok(t.jointP >= 0 && t.jointP <= 1);
    }
  }
});
test('six-pick tickets are blocked until calibration is validated and live provenance is complete', () => {
  const pool = verifiedLivePool();
  for (const kind of ['best', 'aggr'] as const) {
    const result = build(kind, pool, { now: NOW });
    assert.equal(result.options.length, 0);
    assert.ok(result.missing.some((reason) => reason.includes('calibration')));
  }
  const unverified = livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']).map((candidate) => ({
    ...candidate,
    historyVerified: false,
  }));
  assert.throws(() => makeTicket(unverified, 'best', { now: NOW, modelValidated: true }), /Historical games were not verified/);
  assert.throws(() => makeTicket(livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']), 'best', { now: NOW }), /calibration validation/);
});
test('Best ranks by joint probability; Aggressive pays more', () => {
  const g = generate(verifiedLivePool(), NOW, { modelValidated: true });
  assert.ok(g.best.options[0].jointP >= g.aggr.options[0].jointP - 0.005);
  assert.ok(g.aggr.options[0].decimal >= g.best.options[0].decimal);
  const samePrice = verifiedLivePool().map((candidate) => {
    const odds = -110;
    const updated = {
      ...candidate,
      odds,
      verification: { ...candidate.verification!, quote: { ...candidate.verification!.quote, odds } },
    };
    return { ...updated, scored: scoreCandidate(updated, NOW) };
  });
  const noHigherPrice = generate(samePrice, NOW, { modelValidated: true });
  assert.ok(noHigherPrice.best.options.length > 0);
  assert.equal(noHigherPrice.aggr.options.length, 0);
  assert.ok(noHigherPrice.aggr.missing.some((reason) => reason.includes('higher theoretical price')));
});
test('invalid combinations rejected', () => {
  assert.ok(validateLegs(pick(['q1', 'r1', 'r2', 'w1', 'w2'])).length > 0, 'five legs');
  assert.ok(validateLegs(pick(['q1', 'r1', 'r2', 'r4', 'w1', 'w2'])).some((e) => e.includes('RB')), 'three RBs');
  const dup = pick(['q1', 'r1', 'r1', 'w1', 'w2', 't1']);
  assert.ok(validateLegs(dup).includes('Duplicate player'));
  assert.throws(() => makeTicket(dup, 'best'), /Invalid ticket/);
  assert.ok(validateLegs(pick(['q1', 'r1', 'r3', 'w1', 'w3', 't1'])).some((e) => e.includes('game')), 'four legs in one game');
});
test('tickets reject duplicate verified players and event labels that do not match player teams', () => {
  const legs = livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']);
  const duplicate = [...legs];
  duplicate[5] = { ...duplicate[5], historyPlayerId: duplicate[0].historyPlayerId };
  assert.ok(validateLegs(duplicate).includes('Duplicate verified player identity'));
  assert.throws(() => makeTicket(duplicate, 'best', { now: NOW, modelValidated: true }), /Duplicate verified player identity/);
  const mixed=[...legs];mixed[5]={...mixed[5],historyPlayerId:mixed[0].historyPlayerId,espnPlayerId:'espn:separate-primary-id'};
  assert.ok(validateLegs(mixed).includes('Duplicate verified player identity'),'Shared history identity must still match when one primary ESPN ID is missing');
  assert.equal(eligible('best',{...legs[0],rosterStatus:undefined},NOW),false);

  const mismatch = { ...legs[0], eventLabel: 'BUF @ BUF' };
  assert.ok(eligibilityWarnings('best', mismatch, NOW).some((warning) => warning.includes('event label')));
  assert.equal(eligible('best', mismatch, NOW), false);
});
test('missing data reports missing positions instead of padding', () => {
  const noTE = verifiedLivePool().filter((c) => c.pos !== 'TE');
  const r = build('best', noTE, { now: NOW, modelValidated: true });
  assert.equal(r.options.length, 0);
  assert.ok(r.missing.some((m) => m.includes('TE')));
  assert.equal(build('aggr', [], { now: NOW }).options.length, 0);
});
test('six-pick tickets require supported props from at least two games', () => {
  const oneGame = verifiedLivePool().map((candidate) => ({
    ...candidate,
    gameId: 'only-game',
    verification: { ...candidate.verification!, event: { ...candidate.verification!.event, id: 'only-game' } },
  }));
  for (const kind of ['best', 'aggr'] as const) {
    const result = build(kind, oneGame, { now: NOW, modelValidated: true });
    assert.equal(result.options.length, 0);
    assert.ok(result.missing.some((reason) => reason.includes('at least 2 games')));
  }
});
test('same-game warning and demo label present', () => {
  const t = makeTicket(livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']), 'best', { now: NOW, modelValidated: true });
  assert.ok(t.warnings.some((w) => w.includes('Same-game parlay pricing')));
});
test('ticket pricing and EV are explicitly unverified theoretical leg products', () => {
  const legs = livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']);
  const expectedDecimal = legs.reduce((product, leg) => product * americanToDecimal(leg.odds), 1);
  const expectedIndependentProbability = legs.reduce((product, leg) => product * leg.scored!.p, 1);
  for (const kind of ['best', 'aggr'] as const) {
    const ticket = makeTicket(legs, kind, { seed: 17, now: NOW, modelValidated: true });
    assert.equal(ticket.priceBasis, 'product-of-individual-leg-prices');
    assert.equal(ticket.sportsbookQuoteVerified, false);
    assert.ok(Math.abs(ticket.decimal - expectedDecimal) < 1e-12);
    assert.equal(ticket.american, decimalToAmerican(expectedDecimal));
    assert.ok(Math.abs(ticket.indepP - expectedIndependentProbability) < 1e-12);
    assert.ok(Math.abs(ticket.ev - (ticket.jointP * ticket.decimal - 1)) < 1e-12);
    assert.ok(Math.abs(ticket.evLower95 - (ticket.jointLower95 * ticket.decimal - 1)) < 1e-12);
    assert.ok(ticket.jointLower95 <= ticket.jointP && ticket.jointP <= ticket.jointUpper95);
    assert.ok(ticket.warnings.some((warning) => warning.includes('FanDuel acceptance and its combined quote are unverified')));
    assert.ok(ticket.warnings.some((warning) => warning.includes('assumed Gaussian-copula correlation loadings')));
    assert.ok(ticket.warnings.some((warning) => warning.includes('Same-game parlay pricing')));
  }
});
test('very high individual estimates are flagged rather than presented as certain', () => {
  const legs = livePick(['q1', 'r1', 'r5', 'w1', 'w2', 't2']).map((leg) => ({
    ...leg,
    scored: { ...leg.scored!, p: 0.95 },
  }));
  const ticket = makeTicket(legs, 'best', { seed: 17, now: NOW, modelValidated: true });
  assert.equal(ticket.indepP, 0.95 ** 6);
  assert.ok(ticket.warnings.some((warning) => warning.includes('at least 90%')));
});


test('TEST MODE bypasses only calibration and labels every research ticket', () => {
  const pool = verifiedLivePool();
  assert.equal(generate(pool, NOW).best.options.length, 0);
  const result = generate(pool, NOW, { testMode: true });
  assert.ok(result.best.options.length > 0);
  for (const ticket of [...result.best.options, ...result.aggr.options]) {
    assert.equal(ticket.purpose, 'test-research');
    assert.equal(ticket.legs.length, 6);
    assert.ok(ticket.warnings.some((warning) => warning.includes('TEST MODE')));
  }
  assert.equal(generate(demo(), NOW, { testMode: true }).best.options.length, 0);
  for (const patch of [{ injury: 'Out' }, { rosterVerified: false }, { historyVerified: false }, { quoteVerified: false }, { oddsAt: new Date(NOW - 3600_000).toISOString() }]) {
    assert.equal(generate(pool.map((leg) => ({ ...leg, ...patch })), NOW, { testMode: true }).best.options.length, 0);
  }
  assert.equal(generate(pool, NOW).best.options.length, 0);
});


test('pregame research generates distinct structured tickets without settlement and retains data safeguards', () => {
  const pool = verifiedLivePool(); // Synthetic verification fixture; never installed as live data.
  const result = generate(pool, NOW, { pregameResearch: true, modelValidated: false });
  assert.ok(result.best.options.length > 0);
  assert.ok(result.aggr.options.length > 0);
  const best = result.best.options[0], aggressive = result.aggr.options[0];
  assert.ok(aggressive.decimal > best.decimal);
  assert.notDeepEqual(best.legs.map(l => l.id).sort(), aggressive.legs.map(l => l.id).sort());
  for (const t of [...result.best.options, ...result.aggr.options]) {
    assert.equal(t.purpose, 'pregame-research');
    assert.deepEqual(validateLegs(t.legs), []);
    assert.equal(new Set(t.legs.map((leg) => leg.historyPlayerId)).size, 6);
    assert.ok(t.legs.every((leg) => leg.eventVerified && leg.quoteVerified && leg.historyVerified &&
      leg.verification?.event.id === leg.gameId && leg.verification.event.kickoff === leg.kickoff &&
      leg.verification.quote.odds === leg.odds && leg.verification.quote.updatedAt === leg.oddsAt));
    assert.ok(t.warnings.some(w => w.includes('Real-money recommendations remain locked')));
    assert.equal(t.sportsbookQuoteVerified, false);
  }
  assert.equal(generate(pool, NOW).best.options.length, 0, 'recommendation path retains validation lock');
  assert.equal(generate(demo(), NOW, { pregameResearch: true }).best.options.length, 0);
  for (const patch of [{injury:'Out'}, {rosterVerified:false}, {historyVerified:false}, {quoteVerified:false},
    {eventVerified:false}, {history:undefined}, {oddsAt:'invalid'}, {oddsAt:new Date(NOW-31*60000).toISOString()},
    {kickoff:new Date(NOW-1).toISOString()}]) {
    assert.equal(generate(pool.map(c => ({...c,...patch})), NOW, {pregameResearch:true}).best.options.length, 0);
  }
  const testResult = generate(pool, NOW, {pregameResearch:true, testMode:true});
  assert.ok(testResult.best.options.every(t => t.purpose === 'test-research'));
});

test('nonfinite probability and EV cannot qualify for pregame research', () => {
  const c = verifiedLivePool()[0];
  for (const patch of [{p:NaN},{p:Infinity},{ev:NaN},{ev:Infinity}]) {
    assert.equal(eligible('best', {...c, scored:{...c.scored!,...patch}}, NOW), false);
  }
});


test('observed matchup allowance ranks guide selection without changing estimated probabilities', () => {
  const c = verifiedLivePool()[0];
  const p = c.scored!.p;
  const defense = {rank:32, teams:32, games:6, averageAllowed:250};
  const favorable = {...c, side:'Over' as const, history:{...c.history!, defense}};
  assert.equal(matchupSupport(favorable), 0.5);
  assert.equal(matchupSupport({...favorable, side:'Under'}), -0.5);
  assert.equal(matchupSupport({...favorable, history:{...favorable.history, defense:{...defense,games:3}}}), 0);
  assert.equal(matchupSupport(c), 0);
  assert.equal(favorable.scored!.p, p);
});
