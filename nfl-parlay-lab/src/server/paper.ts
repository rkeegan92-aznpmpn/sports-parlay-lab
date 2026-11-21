import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {fullSignature} from '../lib/fourOptions.ts';
import {contractHit,contractPush} from '../lib/propMarkets.ts';
import {americanToDecimal} from '../lib/odds.ts';
import {eligibilityWarnings,validateLegs} from '../lib/optimizer.ts';
import type {Ticket,Candidate} from '../lib/types.ts';
import {ensurePaperStake} from './paperSchema.ts';
import {effectiveStakeCents,parseStake} from '../lib/stake.ts';
import {PAPER_STAKE_CENTS,PAPER_START_CENTS,PAPER_STRATEGIES,type PaperStrategy,type PaperOutcome} from '../lib/paper.ts';
import {RISK_OPTIONS,type ResearchSlot} from '../lib/fourOptions.ts';
import {nflDate} from '../lib/sundayWindow.ts';
import {currentSeason} from '../lib/service.ts';
import {freeSchedule} from './freeResearch.ts';
import {multiResearch,type ProviderKeys} from './multiProvider.ts';
import {gradeSavedTickets,savedGrades,finalized,type LegGrade} from './savedGrades.ts';
import {phaseHealth} from './collectionHealth.ts';
import {collectorStatus} from './collector.ts';
type Db=Database.Database;
export type PaperConfig={enabled:boolean;leadMinutes:number;closeMinutes:number;days:number[]};
export type PaperSlate={key:string;season:number;week:number;date:string;firstKickoff:number;gameIds:string[];label:string;games?:PaperGame[]};
export type PaperSelection={mode:'ALL'|'SUNDAY'|'GAMES';gameIds:string[]};
export type PaperGame=Awaited<ReturnType<typeof freeSchedule>>[number];
type Wager={id:number;slate_key:string;season:number;week:number;nfl_date:string;strategy:PaperStrategy;created_at:number;capture_mode:'automatic'|'manual';stake_cents:number;theoretical_decimal:number;legs_json:string;ticket_json:string};
export class PaperError extends Error{}
export const paperKeys=():ProviderKeys=>({fanduelapi:process.env.FANDUEL_API_KEY?.trim()??'','odds-api':process.env.ODDS_API_KEY?.trim()??'',propline:process.env.PROPLINE_API_KEY?.trim()??''});
export function paperStakeCents(db:Db):number{ensurePaperStake(db as never);const r=db.prepare('SELECT stake_cents FROM paper_settings WHERE id=1').get() as {stake_cents:number}|undefined;return effectiveStakeCents(r?.stake_cents);}
/** Changes the stake for FUTURE paper wagers only; recorded wagers are immutable and keep their original stake. */
export function setPaperStake(db:Db,input:unknown,now=Date.now()):number{const p=parseStake(input);if(!p.ok)throw new PaperError(p.error);ensurePaperStake(db as never);db.prepare('UPDATE paper_settings SET stake_cents=?,updated_at=? WHERE id=1').run(p.cents,now);return p.cents;}
export function paperConfig(db:Db):PaperConfig{const r=db.prepare('SELECT * FROM paper_settings WHERE id=1').get() as {enabled:number;lead_minutes:number;close_minutes:number;days_json:string};return {enabled:!!r.enabled,leadMinutes:r.lead_minutes,closeMinutes:r.close_minutes,days:JSON.parse(r.days_json)};}
export function updatePaperConfig(db:Db,input:unknown,now=Date.now()){
 const c=input as PaperConfig;if(!c||typeof c.enabled!=='boolean'||!Number.isInteger(c.leadMinutes)||c.leadMinutes<15||c.leadMinutes>1440||!Number.isInteger(c.closeMinutes)||c.closeMinutes<5||c.closeMinutes>120||c.closeMinutes>=c.leadMinutes||!Array.isArray(c.days)||!c.days.length||c.days.length>7||c.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw new PaperError('Choose capture weekdays, 15–1440 minutes lead and 5–120 minutes close; lead must exceed close.');
 const days=[...new Set(c.days)].sort();db.prepare('UPDATE paper_settings SET enabled=?,lead_minutes=?,close_minutes=?,days_json=?,updated_at=? WHERE id=1').run(Number(c.enabled),c.leadMinutes,c.closeMinutes,JSON.stringify(days),now);return paperConfig(db);
}
export async function paperSlates(f:typeof fetch=fetch,now=Date.now()):Promise<PaperSlate[]>{
 // Include earlier games today so resume never silently moves a missed automatic window to a later kickoff.
 const games=await freeSchedule(f,now-24*3600_000),groups=new Map<string,PaperSlate>();
 for(const g of games){const at=Date.parse(g.commence_time),season=currentSeason(new Date(g.commence_time)),week=g.week,date=nflDate(g.commence_time);if(!Number.isInteger(week)||week<1||week>22||date<nflDate(new Date(now).toISOString()))continue;
  const key=`${season}:${week}:${date}`,old=groups.get(key);if(old){old.gameIds.push(g.id);old.firstKickoff=Math.min(old.firstKickoff,at);}else groups.set(key,{key,season,week,date,firstKickoff:at,gameIds:[g.id],label:`${season} NFL week ${week} · ${date}`});
 }
 return [...groups.values()].sort((a,b)=>a.firstKickoff-b.firstKickoff);
}
/** Persisted scope drives both manual generation and automatic collector capture. */
export function paperSelection(db:Db):PaperSelection{const r=db.prepare('SELECT mode,game_ids_json FROM paper_selection WHERE id=1').get() as {mode:PaperSelection['mode'];game_ids_json:string};return {mode:r.mode,gameIds:JSON.parse(r.game_ids_json)};}
export function parsePaperSelection(input:unknown):PaperSelection{
 const s=input as PaperSelection;if(!s||!['ALL','SUNDAY','GAMES'].includes(s.mode)||!Array.isArray(s.gameIds)||s.gameIds.length>100||s.gameIds.some(id=>typeof id!=='string'||!id||id.length>100)||s.mode==='GAMES'&&!s.gameIds.length)throw new PaperError('Choose All Upcoming Games, All Sunday Games, or one or more verified games.');
 return {mode:s.mode,gameIds:s.mode==='GAMES'?[...new Set(s.gameIds)].sort():[]};
}
export async function paperGames(f:typeof fetch=fetch,now=Date.now()){
 // Retain today's already-started games for automatic window anchors, never for new selections.
 return (await freeSchedule(f,now-86400000)).filter(g=>nflDate(g.commence_time)>=nflDate(new Date(now).toISOString())&&Date.parse(g.commence_time)<=now+21*86400000);
}
export function resolvePaperSelection(games:PaperGame[],input:unknown,now=Date.now(),automatic=false):PaperSlate{
 const selection=parsePaperSelection(input),upcoming=games.filter(g=>automatic||Date.parse(g.commence_time)>now);
 if(selection.mode==='GAMES'&&selection.gameIds.some(id=>!upcoming.some(g=>g.id===id)))throw new PaperError('A selected game is no longer verified/upcoming. Update the selection; no substitute game or wager was created.');
 const selected=upcoming.filter(g=>selection.mode==='ALL'||selection.mode==='SUNDAY'&&new Date(nflDate(g.commence_time)+'T12:00:00Z').getUTCDay()===0||selection.mode==='GAMES'&&selection.gameIds.includes(g.id)).sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time));
 if(!selected.length)throw new PaperError('No verified upcoming games match this paper selection.');
 const first=selected[0],season=currentSeason(new Date(first.commence_time)),week=first.week,date=nflDate(first.commence_time);
 if(selected.some(g=>!Number.isInteger(g.week)||g.week<1||g.week>22))throw new PaperError('Verified NFL week unavailable for a selected game.');
 const gameIds=selected.map(g=>g.id).sort(),key='games:'+createHash('sha256').update(JSON.stringify(gameIds)).digest('hex').slice(0,32);
 return {key,season,week,date,firstKickoff:Date.parse(first.commence_time),gameIds,games:selected,label:selection.mode==='ALL'?'All Upcoming Games':selection.mode==='SUNDAY'?'All Sunday Games':`${gameIds.length} selected games`};
}
export function savePaperSelection(db:Db,input:unknown,games:PaperGame[],now=Date.now()){
 const selection=parsePaperSelection(input);if(selection.mode==='GAMES')resolvePaperSelection(games,selection,now);db.prepare('UPDATE paper_selection SET mode=?,game_ids_json=?,updated_at=? WHERE id=1').run(selection.mode,JSON.stringify(selection.gameIds),now);return selection;
}
export function paperWindow(slate:PaperSlate,config:PaperConfig,now:number){const day=new Date(slate.date+'T12:00:00Z').getUTCDay(),opens=slate.firstKickoff-config.leadMinutes*60000,closes=slate.firstKickoff-config.closeMinutes*60000;return {opens,closes,due:config.enabled&&config.days.includes(day)&&now>=opens&&now<closes};}
const sumCash=(db:Db)=>(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM paper_ledger').get() as {n:number}).n;
export function assertCurrentPick6(ticket:Ticket,slate:PaperSlate,now:number,allowTest=false){
 if(!ticket||![...['pregame-research','validated-research'],...(allowTest?['test-research']:[])].includes(ticket.purpose)||validateLegs(ticket.legs).length)throw new PaperError('Paper wagering requires a complete, current non-TEST six-pick research ticket.');
 const allowed=slate.gameIds;const best=ticket.legs.every(l=>!eligibilityWarnings('best',l,now).length),aggr=ticket.legs.every(l=>!eligibilityWarnings('aggr',l,now).length);
 if(!best&&!aggr)throw new PaperError('Ticket no longer passes existing historical, availability, price and model eligibility.');
 for(const leg of ticket.legs){const q=leg.quoteEvidence;
  if(leg.source!=='live'||!q||!['fanduelapi','odds-api','propline'].includes(q.provider)||q.bookmaker!=='fanduel'||q.period!=='FULL'||q.status!=='current-provider-snapshot'||q.gameId!==leg.gameId||q.player!==leg.name||q.market!==leg.market||q.side!==leg.side||q.line!==leg.line||q.american!==leg.odds||q.observedAt!==leg.oddsAt||q.kickoff!==leg.kickoff||!allowed.includes(leg.gameId)||(slate.games?!slate.games.some(g=>g.id===leg.gameId&&g.commence_time===leg.kickoff):nflDate(leg.kickoff)!==slate.date)||Date.parse(leg.kickoff)<=now||!Number.isFinite(Date.parse(leg.oddsAt))||Date.parse(leg.oddsAt)>now||q.providerAsOf&&Date.parse(q.providerAsOf)>now)throw new PaperError('Unverified, manual/demo/TEST, mismatched or post-kickoff quote cannot become a paper wager.');
 }
 const decimal=ticket.legs.reduce((v,l)=>v*americanToDecimal(l.odds),1);if(!Number.isFinite(decimal)||!Number.isFinite(ticket.decimal)||Math.abs(ticket.decimal-decimal)>1e-8||!Number.isSafeInteger(Math.round(PAPER_STAKE_CENTS*decimal)))throw new PaperError('Theoretical ticket payout cannot be represented safely.');
}
/** Server-derived tickets only. Public routes never accept selections, prices, timestamps or bankroll from the client. */
export function capturePaperTicket(db:Db,slate:PaperSlate,strategy:PaperStrategy,ticket:Ticket,mode:'automatic'|'manual',now=Date.now()){
 if(!PAPER_STRATEGIES.includes(strategy))throw new PaperError('Unknown paper strategy.');
 const started=Date.now();return db.transaction(()=>{
  now+=Date.now()-started; // Include SQLite lock wait; never timestamp a late insert at request start.
  const existing=db.prepare('SELECT id FROM paper_wagers WHERE slate_key=? AND strategy=?').get(slate.key,strategy) as {id:number}|undefined;
  if(existing)return {id:existing.id,created:false};
  // Scope changes and legacy date slates must not debit the exact same strategy/selections again.
  const signature=fullSignature(ticket),previous=db.prepare('SELECT id,ticket_json FROM paper_wagers WHERE strategy=?').all(strategy) as {id:number;ticket_json:string}[];
  const duplicate=previous.find(w=>fullSignature(JSON.parse(w.ticket_json))===signature);if(duplicate)return {id:duplicate.id,created:false};
  if(mode==='automatic'&&!paperWindow(slate,paperConfig(db),now).due)throw new PaperError('Automatic capture window is closed; no retroactive wager.');
  assertCurrentPick6(ticket,slate,now);const stake=paperStakeCents(db);if(sumCash(db)<stake)throw new PaperError('Insufficient available virtual funds; no wager recorded.');
  const inserted=db.prepare('INSERT INTO paper_wagers(slate_key,season,week,nfl_date,strategy,created_at,capture_mode,stake_cents,theoretical_decimal,legs_json,ticket_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(slate.key,slate.season,slate.week,slate.date,strategy,now,mode,stake,ticket.decimal,JSON.stringify(ticket.legs),JSON.stringify(ticket));const id=Number(inserted.lastInsertRowid);
  db.prepare('INSERT INTO paper_ledger(event_key,wager_id,created_at,kind,amount_cents,note) VALUES(?,?,?,?,?,?)').run(`stake:${id}`,id,now,'stake',-stake,`$${stake%100?(stake/100).toFixed(2):stake/100} simulated wager; estimated combined payout, no sportsbook bet.`);
  db.prepare('INSERT INTO paper_settlements(wager_id,status) VALUES(?,?)').run(id,'pending');
  db.prepare('INSERT INTO paper_ticket_grades(ticket_id,status,legs_json,checked_at,finalized) VALUES(?,?,?,?,0)').run(id,'pending',JSON.stringify(ticket.legs.map(l=>({player:l.name,pos:l.pos,market:l.market,side:l.side,line:l.line,status:'pending',hit:null,actual:null,reason:'awaiting-final-result'}))),now);
  return {id,created:true};
 }).immediate();
}
function proven(leg:LegGrade){return leg.rulesVersion==='research-fullgame-v1'&&['nflverse','espn'].includes(leg.resultSource??'')&&!!leg.resultGameId&&!!leg.resultDate&&(leg.status==='void'?leg.reason==='explicit-final-boxscore-did-not-play':typeof leg.actual==='number'&&Number.isFinite(leg.actual));}
export function paperReturn(legs:Candidate[],grades:LegGrade[],stakeCents:number=PAPER_STAKE_CENTS):{status:PaperOutcome;returnCents:number;finalized:boolean}{
 if(legs.length!==6||grades.length!==6)return {status:'pending',returnCents:0,finalized:false};
 const valid=grades.every((g,i)=>g.player===legs[i].name&&g.market===legs[i].market&&g.side===legs[i].side&&g.line===legs[i].line&&['settled','push','void','pending'].includes(g.status)&&(g.status==='pending'||proven(g))&&(g.status!=='settled'||(g.hit===0||g.hit===1)&&!contractPush(g.actual!,legs[i].side,legs[i].line)&&Number(contractHit(g.actual!,legs[i].side,legs[i].line))===g.hit)&&(g.status!=='push'||contractPush(g.actual!,legs[i].side,legs[i].line)));
 if(!valid)return {status:'pending',returnCents:0,finalized:false};
 const done=finalized(grades);
 if(grades.some(g=>g.status==='settled'&&g.hit===0))return {status:'loss',returnCents:0,finalized:done};
 if(!done)return {status:'pending',returnCents:0,finalized:false};
 const active=legs.filter((_,i)=>grades[i].status==='settled');
 if(!active.length)return {status:grades.every(g=>g.status==='push')?'push':'void',returnCents:stakeCents,finalized:true};
 const amount=Math.round(stakeCents*active.reduce((v,l)=>v*americanToDecimal(l.odds),1));
 if(!Number.isSafeInteger(amount))return {status:'pending',returnCents:0,finalized:false};
 return {status:active.length<6?'push-adjusted-win':'win',returnCents:amount,finalized:true};
}
/** Append deltas, including reversals; never edit historical ledger entries or quoted selections. */
export function reconcilePaperLedger(db:Db,now=Date.now()){
 const wagers=db.prepare('SELECT * FROM paper_wagers').all() as Wager[];
 for(const w of wagers){
  db.transaction(()=>{
   const latest=db.prepare('SELECT legs_json FROM paper_ticket_grades WHERE ticket_id=?').get(w.id) as {legs_json:string}|undefined;
   let outcome:ReturnType<typeof paperReturn>;try{outcome=paperReturn(JSON.parse(w.legs_json),JSON.parse(latest?.legs_json??'[]'),w.stake_cents);}catch{return;}
   const previous=db.prepare('SELECT * FROM paper_settlements WHERE wager_id=?').get(w.id) as {status:PaperOutcome;return_cents:number;revision:number}|undefined;
   if(previous?.status===outcome.status&&previous.return_cents===outcome.returnCents){db.prepare('UPDATE paper_settlements SET checked_at=? WHERE wager_id=?').run(now,w.id);return;}
   const revision=(previous?.revision??0)+1,delta=outcome.returnCents-(previous?.return_cents??0);
   db.prepare('INSERT INTO paper_ledger(event_key,wager_id,created_at,kind,amount_cents,note) VALUES(?,?,?,?,?,?)').run(`result:${w.id}:${revision}`,w.id,now,previous&&previous.status!=='pending'?'correction':'settlement',delta,`${previous?.status??'pending'} → ${outcome.status}; estimated product payout, not a sportsbook settlement.`);
   db.prepare('INSERT INTO paper_settlements(wager_id,status,return_cents,revision,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(wager_id) DO UPDATE SET status=excluded.status,return_cents=excluded.return_cents,revision=excluded.revision,checked_at=excluded.checked_at').run(w.id,outcome.status,outcome.returnCents,revision,now);
  }).immediate();
 }
}
export async function gradePaperWagers(db:Db,f:typeof fetch=fetch,now=Date.now()){
 const result=await gradeSavedTickets(db,f,now,{store:'paper',recheckFinalized:true});reconcilePaperLedger(db,now);return result;
}
const recordRun=(db:Db,slate:string|null,mode:string,status:string,captured:number,notes:string[],now:number)=>db.prepare('INSERT INTO paper_runs(created_at,slate_key,mode,status,captured,notes_json) VALUES(?,?,?,?,?,?)').run(now,slate,mode,status,captured,JSON.stringify(notes));
export async function previewPaper(db:Db,slate:PaperSlate,keys:ProviderKeys,f:typeof fetch=fetch,now=Date.now()){
 const result=await multiResearch(db,keys,'FULL','ALL',f,now,false,new Set(slate.gameIds));return {...result,options:result.options as ResearchSlot<Ticket>[]};
}
export async function capturePaperSlate(db:Db,slate:PaperSlate,keys:ProviderKeys,f:typeof fetch=fetch,now=Date.now(),mode:'automatic'|'manual'='manual',strategy?:PaperStrategy,generate:()=>Promise<{options:ResearchSlot<Ticket>[]}>=()=>previewPaper(db,slate,keys,f,now)){
 const started=Date.now();const needed=(strategy?[strategy]:PAPER_STRATEGIES).filter(s=>!db.prepare('SELECT id FROM paper_wagers WHERE slate_key=? AND strategy=?').get(slate.key,s));
 if(!needed.length)return {captured:0,createdIds:[] as number[],notes:['All requested slate/strategy wagers already exist; no duplicate wager or debit.']};
 const result=await generate(),notes:string[]=[],createdIds:number[]=[];let captured=0;
 for(const option of result.options){if(!needed.includes(option.label))continue;if(!option.ticket){notes.push(`${option.label}: ${option.missing.join(' ')}`);continue;}
  try{const clock=now+(Date.now()-started);if(mode==='automatic'&&!paperWindow(slate,paperConfig(db),clock).due){notes.push('Automatic capture window closed during analysis; no retroactive wager recorded.');break;}
   const saved=capturePaperTicket(db,slate,option.label,option.ticket,mode,clock);if(saved.created){captured++;createdIds.push(saved.id);}else notes.push(`${option.label}: identical strategy selections already recorded; no duplicate wager or debit.`);
  }catch(e){notes.push(`${option.label}: ${e instanceof PaperError?e.message:'Capture failed; no partial debit recorded.'}`);}
 }
 recordRun(db,slate.key,mode,captured?'captured':'blocked',captured,notes,now);return {captured,createdIds,notes};
}
export async function paperCycle(db:Db,f:typeof fetch=fetch,now=Date.now(),keys=paperKeys()){
 const started=Date.now(),clock=()=>now+(Date.now()-started);const errors:string[]=[];let captured=0;
 try{const grading=await gradePaperWagers(db,f,now);errors.push(...grading.providerErrors);}catch{errors.push('Paper grading unavailable; outcomes remain unresolved and previous ledger entries are retained.');}
 const config=paperConfig(db);
 if(config.enabled)try{const games=await paperGames(f,clock());if(games.length){const slate=resolvePaperSelection(games,paperSelection(db),clock(),true);if(paperWindow(slate,config,clock()).due){const result=await capturePaperSlate(db,slate,keys,f,clock(),'automatic');captured+=result.captured;errors.push(...result.notes.filter(n=>!n.includes('no duplicate wager or debit')));}}}catch(e){const message=e instanceof PaperError?`Paper capture blocked: ${e.message}`:'Paper capture blocked: verified schedule or cached provider/player evidence unavailable. No paid refresh or retroactive wager.';errors.push(message);recordRun(db,null,'automatic','blocked',0,[message],now);}
 return {captured,providerErrors:[...new Set(errors)],enabled:config.enabled};
}
export function paperDashboard(db:Db,now=Date.now(),history:{before?:number;strategy?:PaperStrategy}={}){
 const rows=db.prepare('SELECT w.*,s.status,s.return_cents,s.revision,s.checked_at FROM paper_wagers w JOIN paper_settlements s ON s.wager_id=w.id ORDER BY w.id DESC').all() as (Wager&{status:PaperOutcome;return_cents:number;revision:number;checked_at:number})[];
 const grades=savedGrades(db,{store:'paper'}),availableCents=sumCash(db),outstandingCents=rows.filter(r=>r.status==='pending').reduce((n,r)=>n+r.stake_cents,0);
 const metrics=(group:typeof rows)=>{const closed=group.filter(r=>r.status!=='pending'),stake=closed.reduce((n,r)=>n+r.stake_cents,0),profit=closed.reduce((n,r)=>n+r.return_cents-r.stake_cents,0);let legWins=0,legLosses=0,legPushes=0,legVoids=0,legPending=0;for(const w of group)for(const l of grades[w.id]?.legs??[]){if(l.status==='settled'&&proven(l)&&l.hit===1)legWins++;else if(l.status==='settled'&&proven(l)&&l.hit===0)legLosses++;else if(l.status==='push'&&proven(l))legPushes++;else if(l.status==='void'&&proven(l))legVoids++;else legPending++;}const wins=group.filter(r=>r.status==='win'||r.status==='push-adjusted-win').length,losses=group.filter(r=>r.status==='loss').length;return {ticketAccuracy:wins+losses?wins/(wins+losses):null,wagers:group.length,pending:group.length-closed.length,wins:group.filter(r=>r.status==='win'||r.status==='push-adjusted-win').length,losses:group.filter(r=>r.status==='loss').length,pushes:group.filter(r=>r.status==='push').length,voids:group.filter(r=>r.status==='void').length,settledStakeCents:stake,profitCents:profit,roi:stake?profit/stake:null,legWins,legLosses,legPushes,legVoids,legPending,legAccuracy:legWins+legLosses?legWins/(legWins+legLosses):null};};
 const by=(key:(w:typeof rows[number])=>string)=>[...new Set(rows.map(key))].sort().map(k=>({key:k,...metrics(rows.filter(w=>key(w)===k))}));
 const historyRows=rows.filter(w=>(history.before===undefined||w.id<history.before)&&(!history.strategy||w.strategy===history.strategy)),page=historyRows.slice(0,100);
 return {stakeCents:paperStakeCents(db),selection:paperSelection(db),collectorPhases:phaseHealth(db),historyHasMore:historyRows.length>100,historyNextBefore:historyRows.length>100?page.at(-1)!.id:null,historyStrategy:history.strategy??'ALL',paperPhase:phaseHealth(db).find(p=>p.phase==='paper-betting')??null,startingCents:PAPER_START_CENTS,availableCents,outstandingCents,bankrollCents:availableCents+outstandingCents,config:paperConfig(db),collector:collectorStatus(db,now),summary:metrics(rows),weekly:by(w=>`${w.season} week ${w.week}`),seasons:by(w=>String(w.season)),strategies:PAPER_STRATEGIES.map(strategy=>({strategy,...metrics(rows.filter(w=>w.strategy===strategy))})),wagers:page.map(w=>({...w,legs:JSON.parse(w.legs_json) as Candidate[],grades:grades[w.id]??null,profitCents:w.status==='pending'?null:w.return_cents-w.stake_cents})),ledger:db.prepare('SELECT * FROM paper_ledger ORDER BY id DESC LIMIT 200').all(),runs:db.prepare('SELECT * FROM paper_runs ORDER BY id DESC LIMIT 30').all() as {id:number;created_at:number;slate_key:string|null;mode:string;status:string;captured:number;notes_json:string}[],warnings:['PAPER BETTING — virtual funds only. No wager is placed. No TEST MODE, demo, manual/unverified or backtest quotes enter the ledger.','All combined returns and ROI are ESTIMATED from individual leg prices; sportsbook same-game acceptance, correlation pricing and push/void repricing are unverified.','Scheduled capture and grading require the app/collector and Codespace to remain running. Resume catches up verified grading, never retroactive wagers. Corrections append reversals and can reduce available funds.']};
}
