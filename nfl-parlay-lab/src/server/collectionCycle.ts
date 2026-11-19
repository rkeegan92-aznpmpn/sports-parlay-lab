import {paperCycle} from './paper.ts';
import type Database from 'better-sqlite3';
import {gradeSavedTickets} from './savedGrades.ts';
import {updateValidation,calibrationSnapshot} from './tracking.ts';
import {recordPhase} from './collectionHealth.ts';
import {MODEL_VERSION} from '../lib/model.ts';
import {OddsApiError} from '../lib/providers/oddsApi.ts';
/** Paid capture, forecast settlement, and archive grading are independent failure domains. */
export async function collectionCycle(db:Database.Database,collect:(()=>Promise<void>)|undefined,f:typeof fetch=fetch,now=Date.now(),options:{capturePauseReason?:string;validate?:typeof updateValidation}={}) {
 let captureFailure:unknown;
 try{await collect?.();recordPhase(db,'capture',collect?'ok':'paused',collect?[]:[options.capturePauseReason??'Quote capture disabled; free settlement continues.'],now);}
 catch(error){captureFailure=error;recordPhase(db,'capture','failed',[error instanceof OddsApiError?`${error.message}${error.code?` (${error.code})`:''}`:'Quote capture failed. Review provider access, quote freshness and verified player coverage.'],now);}
 let validation:Awaited<ReturnType<typeof updateValidation>>|undefined;
 try{validation=await(options.validate??updateValidation)(db,f,now);recordPhase(db,'forecast-settlement',validation.providerErrors.length?'degraded':'ok',validation.providerErrors,now);}
 catch{recordPhase(db,'forecast-settlement','failed',['Forecast settlement failed unexpectedly; saved-ticket grading is checked independently.'],now);
  try{const cached=calibrationSnapshot(db,now);validation={...cached,modelVersion:MODEL_VERSION,unsettled:cached.tracking.upcoming+cached.tracking.awaitingResults,providerErrors:['Forecast settlement failed; displaying previously verified calibration evidence only.']};}catch{}
 }
 try{const grading=await gradeSavedTickets(db,f,now);recordPhase(db,'ticket-grading',grading.providerErrors.length?'degraded':'ok',grading.providerErrors,now);validation?.providerErrors.push(...grading.providerErrors);}
 catch{const message='Saved-ticket grading failed; archives retained and missing outcomes were not marked as losses.';recordPhase(db,'ticket-grading','failed',[message],now);validation?.providerErrors.push(message);}
 try{const paper=await paperCycle(db,f,now);recordPhase(db,'paper-betting',paper.providerErrors.length?'degraded':'ok',paper.providerErrors,now);}
 catch{recordPhase(db,'paper-betting','failed',['Paper betting cycle failed; no retroactive wagers or unverified payouts were created.'],now);}
 if(!validation)throw new Error('Forecast validation unavailable; independent grading phase diagnostics were retained.');
 return {captureFailure,validation};
}
