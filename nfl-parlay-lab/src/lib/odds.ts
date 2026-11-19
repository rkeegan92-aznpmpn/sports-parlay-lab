export function americanToDecimal(o: number): number {
  if (!Number.isFinite(o) || o === 0 || Math.abs(o) < 100) throw new RangeError(`Invalid American odds: ${o}`);
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}
export function decimalToAmerican(d: number): number {
  if (!Number.isFinite(d) || !(d > 1)) throw new RangeError(`Invalid decimal odds: ${d}`);
  const american = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
  if (!Number.isFinite(american)) throw new RangeError('American odds are outside the supported numeric range.');
  return american;
}
export const impliedProb = (o: number) => 1 / americanToDecimal(o);
/** Product of individual leg prices; not a sportsbook-confirmed parlay quote. */
export function parlayDecimal(odds: number[]): number {
  const decimal = odds.reduce((product, price) => product * americanToDecimal(price), 1);
  if (!Number.isFinite(decimal) || decimal <= 1) throw new RangeError('Parlay product price is outside the supported numeric range.');
  return decimal;
}
function r2(x: number) {
  const cents = (x + Number.EPSILON) * 100;
  if (!Number.isFinite(cents) || Math.abs(cents) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Payout exceeds the supported cent-precision range.');
  }
  return Math.round(cents) / 100;
}
export function payout(stake: number, decimal: number) {
  if (!Number.isFinite(stake) || stake < 0 || !Number.isFinite(decimal) || decimal <= 1) {
    throw new RangeError('A finite non-negative stake and finite decimal odds above 1 are required.');
  }
  const roundedStake = r2(stake);
  if (roundedStake !== stake) throw new RangeError('Stake must be representable to the nearest cent.');
  const profit = roundedStake * (decimal - 1), total = roundedStake * decimal;
  if (!Number.isFinite(profit) || !Number.isFinite(total)) throw new RangeError('Payout is outside the supported numeric range.');
  const roundedTotal = r2(total), roundedProfit = r2(roundedTotal - roundedStake);
  if (!Number.isFinite(roundedProfit) || !Number.isFinite(roundedTotal)) throw new RangeError('Rounded payout is outside the supported numeric range.');
  return { profit: roundedProfit, total: roundedTotal };
}
export const fmtOdds = (o: number) => (o > 0 ? `+${Math.round(o)}` : `${Math.round(o)}`);
