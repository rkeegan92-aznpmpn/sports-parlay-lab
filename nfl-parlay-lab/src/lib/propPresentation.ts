import type {DiscoveredProp} from '../server/marketDiscovery.ts';
export function playerHeading(row:DiscoveredProp){
 const roster=row.roster;
 return roster?.verified&&roster.name&&roster.team&&['QB','RB','WR','TE'].includes(roster.position??'')?`${roster.name} — ${roster.position} | Team: ${roster.team}`:`${row.player} — Roster check needed`;
}
export const periodLabel=(p:string)=>({game:'Full game',q1:'First quarter',q2:'Second quarter',q3:'Third quarter',q4:'Fourth quarter',h1:'First half',h2:'Second half'} as Record<string,string>)[p]??`Provider period: ${p}`;
