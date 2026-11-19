import test from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, decimalToAmerican, parlayDecimal, payout, impliedProb } from '../src/lib/odds.ts';

test('American to decimal conversion', () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(150), 2.5);
  assert.ok(Math.abs(americanToDecimal(-110) - 1.90909) < 1e-4);
  assert.equal(americanToDecimal(-200), 1.5);
});
test('round trip and implied probability', () => {
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.ok(Math.abs(impliedProb(-110) - 0.5238) < 1e-3);
  assert.equal(impliedProb(100), 0.5);
  assert.equal(impliedProb(250), 2 / 7);
  assert.equal(impliedProb(-200), 2 / 3);
  for (const odds of [-10000, -500, -110, 100, 250, 10000]) {
    assert.ok(Math.abs(americanToDecimal(odds) - 1 / impliedProb(odds)) < 1e-12);
  }
});
test('invalid odds throw', () => {
  for (const bad of [0, 50, -50, NaN, Infinity]) assert.throws(() => americanToDecimal(bad), RangeError);
  assert.throws(() => decimalToAmerican(1), RangeError);
});
test('parlay product and payout', () => {
  assert.equal(parlayDecimal([100, 100, 100]), 8);
  assert.deepEqual(payout(10, 8), { profit: 70, total: 80 });
  assert.deepEqual(payout(5, 1.90909), { profit: 4.55, total: 9.55 });
});
test('payout rounds total return first so profit and return stay consistent at half cents', () => {
  assert.deepEqual(payout(1, 1.005), { profit: 0.01, total: 1.01 });
  assert.deepEqual(payout(1, 1.015), { profit: 0.02, total: 1.02 });
  assert.throws(() => payout(0.015, 2), /nearest cent/);
  assert.throws(() => payout(1, 1e15), /cent-precision range/);
});
test('extreme leg prices remain a theoretical product and finite payouts are guarded', () => {
  const product = parlayDecimal(Array(6).fill(1000));
  assert.equal(product, 1_771_561);
  assert.equal(decimalToAmerican(product), 177_156_000);
  assert.deepEqual(payout(10, product), { profit: 17_715_600, total: 17_715_610 });
  assert.throws(() => decimalToAmerican(Infinity), RangeError);
  assert.throws(() => parlayDecimal(Array(100).fill(1e308)), RangeError);
  assert.throws(() => payout(10, Infinity), RangeError);
  assert.throws(() => payout(Infinity, 2), RangeError);
});

test('six-leg theoretical product, American conversion, implied probability, and payout stay consistent', () => {
  const legs = [-110, 125, -105, 200, -125, 150];
  const decimal = legs.reduce((product, odds) => product * americanToDecimal(odds), 1);
  const expectedImplied = legs.reduce((product, odds) => product * impliedProb(odds), 1);
  assert.ok(Math.abs(parlayDecimal(legs) - decimal) < 1e-12);
  assert.ok(Math.abs(impliedProb(decimalToAmerican(decimal)) - 1 / decimal) < 0.00001);
  assert.ok(Math.abs(expectedImplied - 1 / decimal) < 1e-12, 'product of per-leg implied probabilities equals reciprocal theoretical decimal price');
  const paid = payout(10, decimal);
  assert.equal(paid.total, Math.round(10 * decimal * 100) / 100);
  assert.equal(paid.profit, Math.round((paid.total - 10) * 100) / 100);
});

test('Odds API transport errors never echo a credential-bearing request URL', async () => {
  const { fetchEvents } = await import('../src/lib/providers/oddsApi.ts');
  await assert.rejects(fetchEvents('private-test-key', async (url) => { throw new Error(String(url)); }), (error: Error) => {
    assert.equal(error.message.includes('private-test-key'), false);
    assert.match(error.message, /network request failed/);
    return true;
  });
});
