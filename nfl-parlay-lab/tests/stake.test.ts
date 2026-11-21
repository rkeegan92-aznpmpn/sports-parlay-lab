import test from 'node:test';
import assert from 'node:assert/strict';
import { PAPER_STAKE_CENTS } from '../src/lib/paper.ts';
import { DEFAULT_PAPER_STAKE_CENTS, parseStake, effectiveStakeCents } from '../src/lib/stake.ts';

test('default paper stake is $10 and equals the existing NFL constant', () => {
  assert.equal(DEFAULT_PAPER_STAKE_CENTS, 1000);
  assert.equal(DEFAULT_PAPER_STAKE_CENTS, PAPER_STAKE_CENTS);
});
test('parseStake accepts dollars, $-prefixed text and cents without float error', () => {
  assert.deepEqual(parseStake('10'), { ok: true, cents: 1000 });
  assert.deepEqual(parseStake(' $12.5 '), { ok: true, cents: 1250 });
  assert.deepEqual(parseStake(0.1 + 0.2 > 0 ? '19.99' : ''), { ok: true, cents: 1999 });
  assert.deepEqual(parseStake(25), { ok: true, cents: 2500 });
  assert.deepEqual(parseStake('1000'), { ok: true, cents: 100000 });
});
test('parseStake rejects invalid, too small/large, negative and over-precise input', () => {
  for (const bad of ['', 'abc', '-5', '0', '0.50', '1000.01', '10.001', '1e3', null, undefined, NaN, {}]) assert.equal(parseStake(bad).ok, false, String(bad));
});
test('effectiveStakeCents falls back to $10 for missing or invalid stored values', () => {
  assert.equal(effectiveStakeCents(2500), 2500);
  for (const bad of [undefined, null, 0, 99, 100001, 12.5, '1000', NaN]) assert.equal(effectiveStakeCents(bad), 1000, String(bad));
});
