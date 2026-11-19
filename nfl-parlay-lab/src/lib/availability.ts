import type {Candidate} from './types.ts';
export const UNAVAILABLE_STATUS=/\b(questionable|doubtful|out|inactive|injured reserve|ir|suspend\w*|practice[ -]squad|pup|nfi)\b/i;
export const activeRoster=(status:string|undefined)=>!!status&&/\bactive\b/i.test(status)&&!UNAVAILABLE_STATUS.test(status)&&!/unknown|unavailable|unverified/i.test(status);
/** Current team injury coverage is evidence of a check, not proof of game-day health. */
export function availabilityWarnings(c:Candidate,now=Date.now()):string[]{
 const warnings:string[]=[];
 if(c.injury&&UNAVAILABLE_STATUS.test(c.injury))warnings.push(`Unavailable/injury status: ${c.injury}.`);
 if(c.rosterStatus&&UNAVAILABLE_STATUS.test(c.rosterStatus))warnings.push(`Roster status is not eligible: ${c.rosterStatus}.`);
 if(c.source!=='demo'&&(c.rosterVerified!==true||!activeRoster(c.rosterStatus)))warnings.push('Explicit active roster status is unverified.');
 if(c.oddsProvider!=='fanduelapi')return warnings;
 const a=c.availability,snapshot=Date.parse(a?.injurySnapshotAt??'');
 if(!a||!a.injuryTeamCovered||!(now-snapshot>=-5*60000&&now-snapshot<=24*3600_000))warnings.push('Fresh verified injury coverage for this player’s team is unavailable.');
 if(c.injury&&!UNAVAILABLE_STATUS.test(c.injury)&&!/^(active|healthy|available|cleared|full participation|probable)$/i.test(c.injury.trim()))warnings.push(`Injury availability remains unverified: ${c.injury}.`);
 return warnings;
}
