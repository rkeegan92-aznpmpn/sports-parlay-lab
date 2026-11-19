import type Database from 'better-sqlite3';
import type {ComparisonTarget} from '../lib/researchPreview.ts';
import {comparisonKey,compareObservation,type ManualComparison,type ManualObservation} from '../lib/quoteComparison.ts';
import {providerTimestamp} from './providerTimestamp.ts';
export class InvalidComparison extends Error{}
export function recordComparison(db:Database.Database,expected:ComparisonTarget,input:unknown,now=Date.now()):ManualComparison{
 const o=input as Record<string,unknown>;
 if(!o||typeof o!=='object'||!['player','gameId','market','side','observedAt'].every(k=>typeof o[k]==='string'&&(o[k] as string).length>0&&(o[k] as string).length<=150)||
  typeof o.available!=='boolean'||o.comparedInFanDuel!==true||o.provenance!=='manual-fanduel-app'||!['Over','Under','AtLeast'].includes(String(o.side))||typeof o.line!=='number'||!Number.isFinite(o.line)||o.line<0||o.line>2000||typeof o.odds!=='number'||!Number.isInteger(o.odds)||Math.abs(o.odds)<100||Math.abs(o.odds)>100000)throw new InvalidComparison('Enter the observed player, game, exact market, side, line, valid American odds and explicit comparison confirmation.');
 const timestamp=providerTimestamp(o.observedAt);if(!timestamp||Date.parse(timestamp)>now+60000)throw new InvalidComparison('Observation time requires an explicit timezone and cannot be in the future.');
 const observation:ManualObservation={player:String(o.player),gameId:String(o.gameId),market:String(o.market),side:String(o.side),line:o.line,odds:o.odds,observedAt:timestamp,available:o.available,comparedInFanDuel:true,provenance:'manual-fanduel-app'};
 const result={expected,observation,recordedAt:new Date(now).toISOString(),...compareObservation(expected,observation,now)};
 // Append observations: never modify saved tickets, forecasts, provider cache or earlier checks.
 db.prepare('INSERT INTO manual_quote_checks(target_key,recorded_at,expected_json,observation_json) VALUES(?,?,?,?)').run(comparisonKey(expected),now,JSON.stringify(expected),JSON.stringify(observation));return result;
}
export function listComparisons(db:Database.Database,now=Date.now()):ManualComparison[]{
 const rows=db.prepare('SELECT expected_json,observation_json,recorded_at FROM manual_quote_checks ORDER BY id DESC LIMIT 300').all() as {expected_json:string;observation_json:string;recorded_at:number}[];
 return rows.map(r=>{const expected=JSON.parse(r.expected_json) as ComparisonTarget,observation=JSON.parse(r.observation_json) as ManualObservation;return {expected,observation,recordedAt:new Date(r.recorded_at).toISOString(),...compareObservation(expected,observation,now)};});
}
