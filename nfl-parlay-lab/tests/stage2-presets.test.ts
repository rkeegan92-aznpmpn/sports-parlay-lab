import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW, verifiedLivePool } from './poolFixtures.ts';
import { build, eligibilityWarnings, CONFIG } from '../src/lib/optimizer.ts';
import { AGGRESSIVE_PRESETS } from '../src/lib/riskPresets.ts';
import { presetSlot, presetSlots, standardSlots, generateForRisk, LOOSEST_PRESET_THRESHOLDS } from '../src/lib/presetGeneration.ts';

/** Same verified fixture, repriced consistently (leg odds AND the verified quote record) at a given per-leg probability. */
const repriced = (p: number, odds: number) => verifiedLivePool().map((c) => ({ ...c, odds, scored: { ...c.scored!, p, ev: p * (1 + odds / 100) - 1 },
  verification: { ...c.verification!, quote: { ...c.verification!.quote, odds } } }));

test('default eligibility is unchanged; a threshold override relaxes only the probability/sample floor', () => {
  const low = repriced(0.25, 400)[0];
  assert.ok(eligibilityWarnings('aggr', low, NOW).length > 0, 'existing Aggressive floor (0.30) still rejects p=0.25');
  assert.equal(eligibilityWarnings('aggr', low, NOW, { minLeg: 0.2, minSample: 6 }).length, 0);
  assert.deepEqual(CONFIG.aggr, { minLeg: 0.3, minSample: 6, label: 'Aggressive Six' });
});
test('existing four options are identical with and without the preset code path', () => {
  const pool = verifiedLivePool();
  const std = standardSlots(pool, { now: NOW });
  assert.deepEqual(std.map((s) => s.risk), ['Safer', 'Balanced', 'Aggressive', 'Long Shot']);
  assert.ok(std.every((s) => !s.optional));
  assert.equal(build('aggr', pool, { now: NOW, pregameResearch: true }).options.length > 0, true);
});
test('presets produce valid six-leg tickets only where the standard Aggressive floor would reject every leg', () => {
  const pool = repriced(0.28, 400);
  assert.ok(standardSlots(pool, { now: NOW }).every((s) => s.ticket === null), 'p=0.28 < 0.30: standard options cannot build');
  const slots = presetSlots(pool, { now: NOW });
  const aggPlus = slots.find((s) => s.risk === 'Aggressive+')!;
  assert.ok(aggPlus.ticket, aggPlus.missing.join(';'));
  assert.equal(aggPlus.ticket!.legs.length, 6);
  assert.ok(aggPlus.ticket!.decimal >= 20);
  assert.ok(aggPlus.ticket!.warnings[0].startsWith('Aggressive+ preset'));
  assert.ok(aggPlus.optional);
});
test('a preset below its own probability floor yields no ticket and an honest reason', () => {
  const pool = repriced(0.12, 900); // below even Moonshot (0.15)
  for (const s of presetSlots(pool, { now: NOW })) { assert.equal(s.ticket, null); assert.ok(s.missing.length > 0); }
});
test('loosest preset thresholds match the preset table', () => {
  assert.equal(LOOSEST_PRESET_THRESHOLDS.minLeg, Math.min(...AGGRESSIVE_PRESETS.map((p) => p.minLegProbability)));
});
test('generateForRisk: sport-aware, explicit about unimplemented sports and unknown risks', () => {
  const pool = verifiedLivePool();
  for (const sport of ['nba', 'mlb', 'nhl', 'mma'] as const) { const r = generateForRisk(sport, pool, 'Safer', { now: NOW }); assert.equal(r.slots.length, 0); assert.match(r.error!, /not implemented/); }
  assert.equal(generateForRisk('nfl', pool, 'Safer', { now: NOW }).slots.length, 1);
  assert.equal(generateForRisk('nfl', pool, 'moonshot', { now: NOW }).slots[0].risk, 'Moonshot');
  assert.equal(generateForRisk('nfl', pool, undefined, { now: NOW }).slots.length, 7);
  assert.match(generateForRisk('nfl', pool, 'yolo', { now: NOW }).error!, /Unknown risk option/);
  assert.equal(presetSlot(pool, AGGRESSIVE_PRESETS[0], { now: NOW }).risk, 'Aggressive+');
});
