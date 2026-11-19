import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const appDirectory = fileURLToPath(new URL('../', import.meta.url));
process.chdir(appDirectory);
const processKeyBinding = Object.hasOwn(process.env, 'ODDS_API_KEY');
const { loadEnvConfig } = createRequire(import.meta.url)('@next/env');
loadEnvConfig(appDirectory, process.env.NODE_ENV !== 'production', {info() {}, error() {}});
const key = process.env.ODDS_API_KEY?.trim();
const {credentialFingerprint}=await import('../src/server/credentials.ts');
const { diagnoseLive } = await import('../src/server/liveDiagnostics.ts');
const report = await diagnoseLive({ key, firstQuarter: process.argv.includes('--first-quarter') });
const configuration = { credentialFingerprint:credentialFingerprint(key), effectiveOddsApiKeyConfigured: Boolean(key), processKeyBinding,
  emptyProcessBinding: processKeyBinding && !key, appEnvFilePresent: existsSync('.env.local'),
  collectorEnabled: process.env.COLLECTOR_ENABLED !== '0', environment: process.env.NODE_ENV ?? 'development' };
// A read-only connection does not create/migrate the database or touch tickets/forecasts/cache.
let collector: unknown = {status:'unavailable', reason:'No readable existing collector database.'};
try {
  const { databaseFile } = await import('../src/server/storage.ts');
  const { default: Database } = await import('better-sqlite3');
  const { collectorStatus } = await import('../src/server/collector.ts');
  const file=databaseFile();
  if (existsSync(file)) {
    const db=new Database(file,{readonly:true,fileMustExist:true});
    try {
      const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collector_state'").get();
      const state=table ? collectorStatus(db) : {status:'stopped',reason:'Legacy database has no collector heartbeat table. Start the updated app against the existing persistent database.'};
      // Never echo arbitrary historical error strings from disk in this CLI.
      collector={...state, ...('lastError' in state ? {lastError: state.lastError ? 'Recorded collector failure; inspect the app health endpoint for the current sanitized reason.' : null} : {})};
    } finally {db.close();}
  }
} catch { /* State remains unavailable, not an invented heartbeat. */ }
console.log(JSON.stringify({configuration, collector, ...report},null,2));
if (report.blockers.length) process.exitCode=1;
export {};
