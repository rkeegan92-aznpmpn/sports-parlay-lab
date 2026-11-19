import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {credentialFingerprint} from '../src/server/credentials.ts';
import {fetchEvents,fetchEventProps,OddsApiError} from '../src/lib/providers/oddsApi.ts';
const app=fileURLToPath(new URL('../',import.meta.url));process.chdir(app);
const processBinding=Object.hasOwn(process.env,'ODDS_API_KEY');
const {loadEnvConfig}=createRequire(import.meta.url)('@next/env');
const loaded=loadEnvConfig(app,process.env.NODE_ENV!=='production',{info(){},error(){}});
const key=process.env.ODDS_API_KEY?.trim();
const fingerprint=credentialFingerprint(key);
const source=processBinding?'existing-process-binding':loaded.loadedEnvFiles.find((f:{env:Record<string,string|undefined>})=>Object.hasOwn(f.env,'ODDS_API_KEY'))?.path??'missing';
const output:Record<string,unknown>={configuration:{environment:process.env.NODE_ENV??'development',source,keyConfigured:!!key,credentialFingerprint:fingerprint,emptyProcessBinding:processBinding&&!key},
  note:'No key values, provider message bodies, env contents, database writes, cache reset or settlement. At most one events-list request and one single-market player-prop request; the latter may consume credits.'};
try {
  const r=await fetch('http://127.0.0.1:3000/api/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});
  const h=await r.json();
  output.web=r.ok&&typeof h.oddsApiKeyConfigured==='boolean'?{status:'reachable',keyConfigured:h.oddsApiKeyConfigured,credentialFingerprint:h.credentialFingerprint??null,
    matchesCLI:h.credentialFingerprint?fingerprint===h.credentialFingerprint:null,processId:h.processId,processStartedAt:h.processStartedAt,
    collectorStatus:h.collector?.status,collectorFingerprint:h.collector?.credentialFingerprint??null,collectorCredentialMismatch:h.collectorCredentialMismatch??null,oddsCooldown:h.oddsCooldown??null}:
    {status:'health-response-unavailable',httpStatus:r.status};
} catch {output.web={status:'unreachable-or-old-health-endpoint',nextAction:'Start the updated app on port 3000. No running-process identity was inferred.'};}
const safeFailure=(e:unknown)=>e instanceof OddsApiError?{httpStatus:e.status,code:e.code??'unclassified',reason:e.message,creditsRemaining:e.remaining??'unknown',retryAfterMs:e.retryAfterMs}: {reason:'Provider check failed; inspect network access.'};
if(!key){output.provider={status:'blocked-missing-effective-key'};process.exitCode=1;}
else try {
  const schedule=await fetchEvents(key);output.events={status:'authenticated',events:schedule.events.length,creditsRemaining:schedule.remaining};
  const event=schedule.events.find(e=>Date.parse(e.commence_time)>Date.now());
  if(event&&!process.argv.includes('--no-props')) {
    try {
      const props=await fetchEventProps(key,event.id,['player_pass_yds']);
      output.playerProps={status:props.rows.length?'available':'request-succeeded-no-FanDuel-lines',eventId:event.id,market:'player_pass_yds',bookmaker:'fanduel',lines:props.rows.length,creditsRemaining:props.remaining};
    }catch(e){output.playerProps={status:'failed',...safeFailure(e)};process.exitCode=1;}
  }else output.playerProps={status:event?'skipped-by-option':'no-upcoming-event'};
}catch(e){output.events={status:'failed',...safeFailure(e)};process.exitCode=1;}
console.log(JSON.stringify(output,null,2));
export {};
