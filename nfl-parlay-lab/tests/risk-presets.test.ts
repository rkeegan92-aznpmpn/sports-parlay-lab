import test from 'node:test';
import assert from 'node:assert/strict';
import { RISK_OPTIONS } from '../src/lib/fourOptions.ts';
import { STANDARD_RISK_LEVELS, AGGRESSIVE_PRESETS, resolveRisk, allRiskChoices, existingAggressiveFloor, DEFAULT_RISK_SELECTION } from '../src/lib/riskPresets.ts';

test('the four existing risk levels are preserved, unchanged and in order', () => {
  assert.deepEqual([...STANDARD_RISK_LEVELS], ['Safer', 'Balanced', 'Aggressive', 'Long Shot']);
  assert.equal(STANDARD_RISK_LEVELS, RISK_OPTIONS);
  assert.deepEqual(DEFAULT_RISK_SELECTION, { kind: 'standard', level: 'Balanced' });
});
test('every optional preset is strictly more aggressive than the existing Aggressive floor and monotonic', () => {
  const floor = existingAggressiveFloor();
  let prev = floor;
  for (const p of AGGRESSIVE_PRESETS) { assert.ok(p.minLegProbability < prev, p.id); prev = p.minLegProbability; assert.ok(p.minTicketDecimal >= 20); assert.ok(p.warning.length > 0); }
  assert.equal(new Set(AGGRESSIVE_PRESETS.map((p) => p.id)).size, AGGRESSIVE_PRESETS.length);
});
test('resolveRisk accepts ids/labels case-insensitively and rejects unknown input without substituting', () => {
  assert.deepEqual(resolveRisk('long shot'), { kind: 'standard', level: 'Long Shot' });
  assert.equal(resolveRisk('Moonshot')?.kind, 'preset');
  assert.equal(resolveRisk('high-roller')?.kind, 'preset');
  assert.equal(resolveRisk('yolo'), null);
  assert.equal(resolveRisk(7), null);
});
test('choices list the four standard levels first and flag presets as optional', () => {
  const c = allRiskChoices();
  assert.deepEqual(c.slice(0, 4).map((x) => x.id), ['Safer', 'Balanced', 'Aggressive', 'Long Shot']);
  assert.ok(c.slice(0, 4).every((x) => !x.optional));
  assert.ok(c.slice(4).every((x) => x.optional));
});
