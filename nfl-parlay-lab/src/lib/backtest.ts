import { americanToDecimal } from './odds.ts';
export interface Row { resultDate?: string; pos: string; market: string; side: string; line: number | null; odds: number; p: number; marketP?: number | null; marketPSource?: string; hit: 0 | 1; snapshotTs: number; kickoffTs: number; ticketId?: string }
const pct = (a: number) => Math.round(a * 1000) / 10;
const roi = (a: Row[]) => (a.length ? pct(a.reduce((s, r) => s + (r.hit ? americanToDecimal(r.odds) - 1 : -1), 0) / a.length) : null);
const brier = (a: Row[]) => a.length ? a.reduce((sum, row) => sum + (row.p - row.hit) ** 2, 0) / a.length : null;
const logLoss = (a: Row[]) => a.length
  ? -a.reduce((sum, row) => {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, row.p));
    return sum + row.hit * Math.log(p) + (1 - row.hit) * Math.log(1 - p);
  }, 0) / a.length
  : null;
function group(rows: Row[], f: (r: Row) => string) {
  const m: Record<string, Row[]> = {}; rows.forEach((r) => (m[f(r)] ??= []).push(r));
  return Object.fromEntries(Object.entries(m).map(([k, a]) => [k, { n: a.length, hitRate: pct(a.filter((r) => r.hit).length / a.length), roiPct: roi(a) }]));
}
/** Rows whose snapshot is not strictly before kickoff are rejected, so post-start information cannot leak in. */
export function report(input: Row[]) {
  const rows = input
    .filter((r) => r.snapshotTs < r.kickoffTs && r.p >= 0 && r.p <= 1 && (r.hit === 0 || r.hit === 1) && Number.isFinite(r.odds) && Math.abs(r.odds) >= 100)
    .sort((a, b) => a.snapshotTs - b.snapshotTs || a.kickoffTs - b.kickoffTs);
  const E = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01];
  const calibration = E.slice(0, -1).map((lo, i) => { const a = rows.filter((r) => r.p >= lo && r.p < E[i + 1]); return a.length ? { bin: `${Math.round(lo * 100)}-${Math.min(100, Math.round(E[i + 1] * 100))}%`, n: a.length, predicted: pct(a.reduce((s, r) => s + r.p, 0) / a.length), actual: pct(a.filter((r) => r.hit).length / a.length) } : null; }).filter(Boolean);
  const highProbabilityRows = rows.filter((r) => r.p > 0.9);
  const highPredicted = highProbabilityRows.length
    ? pct(highProbabilityRows.reduce((sum, r) => sum + r.p, 0) / highProbabilityRows.length)
    : null;
  const highActual = highProbabilityRows.length
    ? pct(highProbabilityRows.filter((r) => r.hit).length / highProbabilityRows.length)
    : null;
  const highDifference = highPredicted == null || highActual == null ? null : Math.abs(highPredicted - highActual);
  const highProbabilityWarnings = highProbabilityRows.length < 30
    ? [`Only ${highProbabilityRows.length} settled pre-kickoff forecasts above 90%; at least 30 are needed for a minimally informative calibration check.`]
    : highDifference != null && highDifference >= 10
      ? [`Observed hit rate differs from mean predicted probability by ${highDifference.toFixed(1)} percentage points; forecasts above 90% may be miscalibrated.`]
      : [];
  const highProbabilityCalibration = {
    threshold: '>90%',
    n: highProbabilityRows.length,
    hits: highProbabilityRows.filter((r) => r.hit).length,
    predicted: highPredicted,
    actual: highActual,
    absoluteDifference: highDifference,
    warnings: highProbabilityWarnings,
  };
  const marketRows = rows.filter((row) =>
    row.marketPSource === 'no-vig' && row.marketP != null && Number.isFinite(row.marketP) && row.marketP >= 0 && row.marketP <= 1,
  );
  const marketBrier = marketRows.length
    ? marketRows.reduce((sum, row) => sum + (row.marketP! - row.hit) ** 2, 0) / marketRows.length
    : null;
  const pairedModelBrier = brier(marketRows);
  const expectedCalibrationError = rows.length
    ? E.slice(0,-1).reduce((sum, lo, i) => {
      const bin = rows.filter((row) => row.p >= lo && row.p < E[i+1]);
      return sum + Math.abs(bin.reduce((value,row) => value + row.p - row.hit, 0));
    }, 0) / rows.length
    : null;
  const dates = new Set(rows.map((row) => row.resultDate ?? new Date(row.kickoffTs).toISOString().slice(0, 10)));
  const validationWarnings = [
    ...(rows.length < 200 ? [`Only ${rows.length} settled forecasts; at least 200 are required before considering calibration supported.`] : []),
    ...(dates.size < 8 ? [`Only ${dates.size} distinct kickoff dates; at least 8 are required for chronological validation.`] : []),
    ...(marketRows.length < 200 ? [`Only ${marketRows.length} settled forecasts have paired no-vig market prices; at least 200 are required for a market-baseline comparison.`] : []),
    ...(marketBrier == null ? ['No paired, stored no-vig market probabilities are available for the backtest baseline.'] : []),
    ...(marketBrier != null && pairedModelBrier! >= marketBrier ? ['Paired historical Brier score did not beat the stored no-vig market-probability baseline.'] : []),
    ...(expectedCalibrationError != null && expectedCalibrationError > 0.05 ? ['Expected calibration error exceeds 5 percentage points.'] : []),
  ];
  const validationStatus = validationWarnings.length ? 'unvalidated' : 'validated';
  const splitSize = Math.ceil(rows.length / 3);
  const walkForward = rows.length
    ? Array.from({ length: 3 }, (_, index) => {
      const slice = rows.slice(index * splitSize, Math.min(rows.length, (index + 1) * splitSize));
      return slice.length ? {
        period: index + 1,
        n: slice.length,
        firstKickoff: new Date(slice[0].kickoffTs).toISOString(),
        lastKickoff: new Date(slice.at(-1)!.kickoffTs).toISOString(),
        hitRate: pct(slice.filter((row) => row.hit).length / slice.length),
        brier: brier(slice),
        roiPct: roi(slice),
      } : null;
    }).filter(Boolean)
    : [];
  const t: Record<string, Row[]> = {}; rows.forEach((r) => r.ticketId && (t[r.ticketId] ??= []).push(r));
  const full = Object.values(t).filter((a) => a.length === 6);
  const wins = full.filter((a) => a.every((r) => r.hit)).length;
  const parlayRoi = full.length ? pct(full.reduce((s, a) => s + (a.every((r) => r.hit) ? a.reduce((p, r) => p * americanToDecimal(r.odds), 1) - 1 : -1), 0) / full.length) : null;
  return {
    validationProgress: [
      { id: 'settled', label: 'Settled validation outcomes', current: rows.length, required: 200, comparison: 'at-least', met: rows.length >= 200 },
      { id: 'dates', label: 'Distinct actual game dates', current: dates.size, required: 8, comparison: 'at-least', met: dates.size >= 8 },
      { id: 'paired', label: 'Paired no-vig outcomes', current: marketRows.length, required: 200, comparison: 'at-least', met: marketRows.length >= 200 },
      { id: 'brier', label: 'Model Brier vs market Brier', current: pairedModelBrier, required: marketBrier, comparison: 'less-than', met: marketBrier != null && pairedModelBrier != null && pairedModelBrier < marketBrier },
      { id: 'ece', label: 'Calibration error (%)', current: expectedCalibrationError == null ? null : expectedCalibrationError*100, required: 5, comparison: 'at-most', met: expectedCalibrationError != null && expectedCalibrationError <= 0.05 },
    ],
    n: rows.length,
    rejected: input.length - rows.length,
    legHitRate: rows.length ? pct(rows.filter((r) => r.hit).length / rows.length) : null,
    legRoiPct: roi(rows),
    modelBrier: brier(rows),
    pairedModelBrier,
    marketBrier,
    logLoss: logLoss(rows),
    expectedCalibrationError: expectedCalibrationError == null ? null : pct(expectedCalibrationError),
    validationStatus,
    validationWarnings,
    walkForward,
    parlays: { n: full.length, hits: wins, roiPct: parlayRoi }, byPosition: group(rows, (r) => r.pos), byMarket: group(rows, (r) => r.market), calibration,
    highProbabilityCalibration,
    note: 'Small samples say little about profitability. No profit claim is made.' };
}
