import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const { loadEnvConfig } = createRequire(import.meta.url)('@next/env');
const appDirectory = fileURLToPath(new URL('../', import.meta.url));
process.chdir(appDirectory); // Match the Next app's relative DB_PATH, even when launched from the repository root.
loadEnvConfig(appDirectory, process.env.NODE_ENV !== 'production');
const key = process.env.ODDS_API_KEY?.trim();
const safeMessage = (error: unknown) => {
  let message = error instanceof Error ? error.message : 'Forecast tracking failed';
  for(const name of ['ODDS_API_KEY','PROPLINE_API_KEY','FANDUEL_API_KEY'])if(process.env[name]?.trim())message=message.replaceAll(process.env[name]!.trim(),'[redacted]');
  return message.replace(/apiKey=[^&\s]*/gi, 'apiKey=[redacted]');
};
try {
  const { getDb } = await import('../src/server/db.ts');
  const { cachedProviderFetch, getData } = await import('../src/server/load.ts');
  const { canRecordForecast } = await import('../src/server/tracking.ts');
  const {collectionPolicy,phaseHealth}=await import('../src/server/collectionHealth.ts');
  const {OddsApiError}=await import('../src/lib/providers/oddsApi.ts');
  const { collectionCycle } = await import('../src/server/collectionCycle.ts');
  const { acquireCollector, heartbeat, collectorAttempt, collectorResult, stopCollector } = await import('../src/server/collector.ts');
  const settleOnly = process.argv.includes('--settle-only') || process.env.COLLECTOR_MODE === 'settle-only', watch = process.argv.includes('--watch');
  const db = getDb(), owner = randomUUID();
  const initial=collectionPolicy(db,key,settleOnly?'settle-only':process.env.COLLECTOR_MODE);
  if (!acquireCollector(db, owner, Date.now(), initial.capture ? 'capture-and-settle' : 'settle-only')) {
    console.log('An active collector already owns this database. No second collector started.'); db.close();
  } else {
    let stopping = false;
    const pulse = setInterval(() => { if (!heartbeat(db, owner)) process.exit(1); }, 15_000);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
      stopping = true; clearInterval(pulse); stopCollector(db, owner); db.close(); process.exit(0);
    });
    try {
      do {
        collectorAttempt(db, owner);
        try {
          const policy=collectionPolicy(db,key,settleOnly?'settle-only':process.env.COLLECTOR_MODE);
          db.prepare('UPDATE collector_state SET mode=? WHERE id=1 AND owner=?').run(policy.capture?'capture-and-settle':'settle-only',owner);
          const cycle = await collectionCycle(db, !policy.capture ? undefined : async () => {
            if (process.env.COLLECTOR_MODE === 'settle-only') return;
            if (!key) throw new Error('ODDS_API_KEY is missing. Configure the existing private key and restart the app.');
            const data = await getData();
            const failed=data.games.find(game=>game.status==='error');
            if(failed){const error=new OddsApiError('Live event collection failed; inspect provider code and credits.',failed.providerHttpStatus??0);error.code=failed.providerErrorCode;throw error;}
            if(data.mode!=='live')throw new Error('Non-live data cannot be captured as live forecasts.');
            if (!data.candidates.some((candidate) => canRecordForecast(candidate))) throw new Error(data.games.length ? 'No fresh verified pregame forecasts available. Check market freshness, historical samples, player IDs and roster coverage.' : 'No upcoming NFL games available to collect. Future games are required.');
          }, cachedProviderFetch(db),Date.now(),{capturePauseReason:policy.reason});
          const result = cycle.validation;
          const captureError = cycle.captureFailure ? safeMessage(cycle.captureFailure) : null;
          const phases=phaseHealth(db),hardFailure=!!captureError||phases.some(p=>p.status==='failed');
          const failures = [...new Set([captureError, ...result.providerErrors,...phases.filter(p=>p.status==='failed'||p.status==='degraded').flatMap(p=>p.messages)].filter((value): value is string => Boolean(value)))];
          collectorResult(db, owner, failures.length ? failures.join(' ') : null, watch ? Date.now() + 15 * 60_000 : null,Date.now(),hardFailure?'failing':'degraded');
          if (failures.length && !watch) process.exitCode = 1;
          console.log(JSON.stringify({ tracking: result.tracking, settledValidationOutcomes: result.n,
            status: result.validationStatus, warnings: result.validationWarnings, notes: result.notes }));
        } catch (error) {
          const message = safeMessage(error);
          collectorResult(db, owner, message, watch ? Date.now() + 15 * 60_000 : null);
          console.error(message);
          if (!watch) { process.exitCode = 1; break; }
        }
        if (watch && !stopping) await new Promise((resolve) => setTimeout(resolve, 15 * 60_000));
      } while (watch && !stopping);
    } finally { clearInterval(pulse); stopCollector(db, owner); db.close(); }
  }
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
export {};
