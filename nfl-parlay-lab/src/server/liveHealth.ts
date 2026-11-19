import {phaseHealth} from './collectionHealth.ts';
import { credentialFingerprint } from './credentials.ts';
import type Database from 'better-sqlite3';
import { collectorStatus } from './collector.ts';

/** Fast local checks only: never scan forecasts or make a provider request. */
export function liveHealth(db: Database.Database, env: Record<string,string|undefined> = process.env, now = Date.now()) {
  db.prepare('SELECT 1').get();
  const configured = Boolean(env.ODDS_API_KEY?.trim());
  const enabled = env.COLLECTOR_ENABLED !== '0';
  const collector=collectorStatus(db,now), fingerprint=credentialFingerprint(env.ODDS_API_KEY);
  let oddsCooldown: {until:number;status:number;code?:string}|null=null;
  if(fingerprint) {
    const row=db.prepare('SELECT value FROM cache WHERE key=?').get(`odds:cooldown:${fingerprint}`) as {value:string}|undefined;
    if(row) try {const saved=JSON.parse(row.value);if(saved.until>now)oddsCooldown={until:saved.until,status:saved.status,code:saved.code};} catch { /* Ignore invalid temporary cache metadata. */ }
  }
  return {
    collectionPhases:phaseHealth(db),
    oddsCooldown,
    credentialFingerprint:fingerprint, processId:process.pid, processStartedAt:Math.round(Date.now()-process.uptime()*1000),
    collectorCredentialMismatch:collector.active && !!collector.credentialFingerprint && collector.credentialFingerprint!==fingerprint,
    oddsApiKeyConfigured: configured,
    credentials: configured ? 'configured-unverified' : 'missing',
    mode: configured ? 'live' : env.DEMO_MODE === '1' ? 'demo' : 'unavailable',
    database: 'ready', persistenceRequired: env.REQUIRE_PERSISTENT_DB === '1',
    collectorEnabled: enabled, collector, checkedAt: now,
    nextAction: !configured ? 'API-verified odds capture is unavailable. Free schedules, statistics, manual-odds research and final-result grading remain available when their sources respond. No paid key is required for this workflow. The collector automatically uses free settlement-only mode unless capture is explicitly requested.'
      : !enabled ? 'Automatic collection is disabled. Enable it and restart the app, or run the separate collector against the same DB_PATH.'
      : 'Inspect collector heartbeat and provider diagnostics. Key presence alone does not verify authentication, quota, or player-prop access.',
  };
}
