import {TEAM_ABBR} from './service.ts';
import {firstQuarterRejectionReasons} from './firstQuarter.ts';
import {activeRoster,UNAVAILABLE_STATUS} from './availability.ts';
import {PROP_STATS} from './propMarkets.ts';
import {eligibilityWarnings} from './optimizer.ts';
import {inSundayWindow} from './sundayWindow.ts';
import type {DiscoveredProp} from '../server/marketDiscovery.ts';
import type {RosterIdentity} from './providers/espn.ts';
import type {Candidate} from './types.ts';
export type CheckName='market'|'game'|'roster'|'active'|'injury'|'price'|'freshness'|'provider'|'history'|'slate';
export type PropChecks=Record<CheckName,{passed:boolean;state:'passed'|'failed'|'not-evaluated';reasons:string[]}>;
export function canonicalTeam(s:string){const value=TEAM_ABBR[s]??s.trim().toUpperCase();return ({LAR:'LA',WSH:'WAS',JAC:'JAX'} as Record<string,string>)[value]??value;}
export function checkExplorerRow(row:DiscoveredProp,identity:RosterIdentity|undefined,report:{currentSnapshotAt:string|null;coveredTeams:string[];statuses:Map<string,string>}|null,now:number,providerBlocked:boolean,pipelineReasons:string[]=[]){
 const check=(passed:boolean,reason:string)=>({passed,state:passed?'passed' as const:'failed' as const,reasons:passed?[]:[reason]});
 const definition=PROP_STATS[row.stat],a=row.analysis;
 const status=identity?.status??'',injury=identity?.team?report?.statuses.get(`${identity.team}|${row.audit.normalizedName}`):undefined;
 const snapshot=Date.parse(report?.currentSnapshotAt??''),covered=!!identity?.team&&!!report?.coveredTeams.includes(identity.team)&&now-snapshot>=-300000&&now-snapshot<=86400000;
 const acceptedInjury=!injury||/^(active|healthy|available|cleared|full participation|probable)$/i.test(injury.trim());
 const quoteGame=row.audit.eventMatched&&row.audit.propKickoffMatched&&!!row.kickoff&&Date.parse(row.kickoff)>now;
 const modelMatchesRoster=!a||!identity?.verified||canonicalTeam(a.team)===identity.team&&('name'in a?a.pos:a.position)===identity.position&&(!a.espnPlayerId||a.espnPlayerId.replace(/^espn:/,'')===identity.playerId?.replace(/^espn:/,''));
 const teamConflict=!!row.audit.reportedTeam&&identity?.verified&&canonicalTeam(row.audit.reportedTeam)!==identity.team;
 const checks:PropChecks={
  market:check(!!definition&&row.period==='game','Unsupported market type or non-full-game period for six-pick tickets.'),
  game:check(!!quoteGame&&!teamConflict,teamConflict?'Provider-reported team conflicts with verified current roster; captured contract needs recheck.':'Game ID, teams or prop kickoff did not uniquely match the verified upcoming schedule.'),
  roster:check(identity?.verified===true,identity?.reason??'Roster verification missing.'),
  active:check(identity?.verified===true&&activeRoster(status),'Player is inactive, unavailable, or explicit active roster status is missing.'),
  injury:check(covered&&acceptedInjury&&!UNAVAILABLE_STATUS.test(`${status} ${injury??''}`),!covered?'Missing or stale injury coverage for the verified team.':'Questionable, doubtful, out or unverified injury/availability status excludes automatic picks.'),
  price:check(row.odds!==null&&row.line!==null&&row.audit.marketOpen&&!row.audit.conflicting,'Missing valid odds/line, closed market or conflicting duplicate quote.'),
  freshness:check(row.fresh&&!!row.expiresAt&&Date.parse(row.expiresAt)>=now,'Odds/source evidence is stale, future-dated, incomplete or unverified.'),
  provider:check(row.source==='manual'||!providerBlocked,'Provider API failure/quota pause invalidates actionable cached prices; stale research preview remains separate.'),
  history:check(!!a&&a.sample>0&&modelMatchesRoster,!modelMatchesRoster?'Historical model identity/team/position conflicts with the verified current roster.':'Missing exact player/market/period historical analysis. '+pipelineReasons.join(' ')),
  slate:check(!!row.kickoff&&inSundayWindow(row.kickoff,now),'Outside the upcoming Sunday slate; no other week substituted.'),
 };
 if(!a&&['market','game','roster','active','injury'].some(k=>!checks[k as CheckName].passed))checks.history={passed:false,state:'not-evaluated',reasons:['Exact historical model not established after earlier eligibility/matching failures; this is not proof that player statistics are absent. '+pipelineReasons.join(' ')]};
 const base=Object.values(checks).flatMap(c=>c.reasons),candidate=a&&'name'in a?a as Candidate:null;
 const forKind=(kind:'best'|'aggr')=>[...new Set([...base,...(candidate?eligibilityWarnings(kind,candidate,now):['No supported full-game candidate with verified history.'])])];
 const quarterCommon=Object.entries(checks).filter(([k])=>!['market','history'].includes(k)).flatMap(([,c])=>c.reasons);
 if(!modelMatchesRoster)quarterCommon.push('Historical model identity/team/position conflicts with the verified current roster.');
 const q=a&&'player'in a?a:null;
 const quarter=row.period==='q1'?{best:[...new Set([...quarterCommon,...(q?firstQuarterRejectionReasons(q,false,now):['No exact Q1 identity/history model available.'])])],aggressive:[...new Set([...quarterCommon,...(q?firstQuarterRejectionReasons(q,true,now):['No exact Q1 identity/history model available.'])])]}:null;
 return {checks,eligibility:{best:forKind('best'),aggr:forKind('aggr')},quarter,injury:{snapshotAt:report?.currentSnapshotAt??null,covered,status:injury??null},pipelineReasons};
}
export function explorerSummary(rows:(DiscoveredProp&{validation?:ReturnType<typeof checkExplorerRow>})[],providerBlocked:boolean){
 const full=rows.filter(r=>r.period==='game'),order:CheckName[]=['market','game','roster','active','injury','price','freshness','provider','history','slate'];
 const unique=(rs:typeof full)=>new Set(rs.map(r=>r.roster?.verified?r.roster.playerId:`unresolved:${r.player.toLowerCase()}`)).size;
 let remaining=full;
 const stages=order.map(stage=>{const passing=full.filter(r=>r.validation?.checks[stage].passed);remaining=remaining.filter(r=>r.validation?.checks[stage].passed);return {stage,passingProps:passing.length,passingPlayers:unique(passing),remainingProps:remaining.length,remainingPlayers:unique(remaining),notEvaluatedProps:full.filter(r=>r.validation?.checks[stage].state==='not-evaluated').length};});
 const exclusions=new Map<string,number>();for(const row of full)for(const [stage,c]of Object.entries(row.validation?.checks??{}))if(!c.passed&&c.state!=='not-evaluated')exclusions.set(stage,(exclusions.get(stage)??0)+1);
 const eligible=(kind:'best'|'aggr')=>{const selected=full.filter(r=>r.validation?.eligibility[kind].length===0);return {props:selected.length,players:unique(selected),positions:Object.fromEntries(['QB','RB','WR','TE'].map(p=>[p,new Set(selected.filter(r=>r.position===p).map(r=>r.roster!.playerId)).size]))};};
 return {capturedProps:rows.length,fullGameProps:full.length,fullGamePlayers:unique(full),q1Props:rows.filter(r=>r.period==='q1').length,otherPeriodProps:rows.filter(r=>!['game','q1'].includes(r.period)).length,providerBlocked,stages,exclusions:[...exclusions].map(([category,props])=>({category,props})),best:eligible('best'),aggressive:eligible('aggr'),note:'Per-step pass counts are independent; remaining counts form the ordered full-game/Sunday funnel. Multiple exclusion reasons may apply to one prop. Unresolved name counts are not verified athlete counts.'};
}
