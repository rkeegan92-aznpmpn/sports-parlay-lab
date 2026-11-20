import type Database from 'better-sqlite3';
import type {Ticket} from '../lib/types.ts';
import type {ResearchSlot} from '../lib/fourOptions.ts';
import {fullSignature} from '../lib/fourOptions.ts';
import {PAPER_STRATEGIES,type PaperStrategy} from '../lib/paper.ts';
import {cachedPropLine,refreshPropLine} from './propline.ts';
import {multiResearch,multiProviderStatus,type ProviderKeys} from './multiProvider.ts';
import {paperGames,paperSelection,resolvePaperSelection,assertCurrentPick6,capturePaperSlate} from './paper.ts';
import {saveTicket} from './savedTickets.ts';
type Db=Database.Database;
export type BatchTarget='live'|'paper';
export type BatchProgress={stage:'cache'|'refresh'|'generate'|'save'|'complete';message:string};
export type BatchRecord={strategy:PaperStrategy;id:number;created:boolean;capturedAt:number};
export class Pick6BatchError extends Error{}
/** Explicit one-touch action only; the automatic collector never invokes this refresh path. */
export async function pick6Batch(db:Db,keys:ProviderKeys,target:BatchTarget,testMode=false,f:typeof fetch=fetch,request:typeof fetch=fetch,now=Date.now(),progress:(p:BatchProgress)=>void=()=>{}){
 const started=Date.now(),clock=()=>now+Date.now()-started;
 if(target==='paper'&&testMode)throw new Pick6BatchError('TEST MODE tickets cannot enter the paper ledger.');
 progress({stage:'cache',message:'Checking the verified NFL schedule and shared PropLine full-game cache…'});
 const games=await paperGames(f,clock()),selection=target==='paper'?paperSelection(db):{mode:'ALL' as const,gameIds:[]};
 const slate=resolvePaperSelection(games,selection,clock());
 if(slate.gameIds.length<2)throw new Pick6BatchError('Pick 6 requires at least two selected upcoming games: maximum three picks per game. No provider request made.');
 if(target==='paper'){
  const stored=db.prepare('SELECT id,strategy,created_at,ticket_json FROM paper_wagers WHERE slate_key=? ORDER BY id').all(slate.key) as {id:number;strategy:PaperStrategy;created_at:number;ticket_json:string}[];
  if(PAPER_STRATEGIES.every(strategy=>stored.some(r=>r.strategy===strategy))){
   progress({stage:'generate',message:'All four paper strategies are already captured for this game set. Reading original tickets; no provider refresh or new debit.'});
   const analysis=await multiResearch(db,{fanduelapi:'','odds-api':'',propline:keys.propline??''},'FULL','ALL',f,clock(),false,new Set(slate.gameIds));
   const options:ResearchSlot<Ticket>[]=PAPER_STRATEGIES.map(strategy=>({label:strategy,ticket:JSON.parse(stored.find(r=>r.strategy===strategy)!.ticket_json),missing:[],ranking:'Previously captured immutable virtual ticket; original prices retained. No new wager.'}));
   const summary='4 of 4 strategies captured: 0 new, 4 already recorded. 0 PropLine request(s); original archived quotes retained.';progress({stage:'complete',message:summary});
   return {target,analysis:{...analysis,providerStatus:multiProviderStatus(db,keys,clock()),options,warnings:[...analysis.warnings,'Previously captured archives, not newly generated/current-price tickets. No refresh or new stake.']},records:stored.map(r=>({strategy:r.strategy,id:r.id,created:false,capturedAt:r.created_at})),missing:[] as PaperStrategy[],notes:['All four selected-game-set strategies already exist; no duplicate wager or debit.'],providerRequests:0,created:0,summary};
  }
  const funds=(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM paper_ledger').get() as {n:number}).n;
  if(funds<1000)throw new Pick6BatchError('Insufficient available virtual funds for a $10 ticket. No PropLine request made; existing tickets and ledger are unchanged.');
 }
 let cached=false;try{const snapshot=cachedPropLine(db,keys.propline??'','FULL','ALL',clock());cached=snapshot.at<=clock()&&clock()-snapshot.at<300000;}catch{/* Adapter enforces credentials, active cooldowns and explicit recovery. */}
 progress({stage:cached?'cache':'refresh',message:cached?'Reusing the shared five-minute PropLine cache; no odds request needed.':'Refreshing only PropLine once if permitted; other paid providers will not be contacted.'});
 let providerRequests=0;
 const counted:typeof fetch=async(input,init)=>{if(new URL(String(input)).origin!=='https://api.prop-line.com')throw new Pick6BatchError('Unexpected odds provider blocked.');providerRequests++;return request(input,init);};
 await refreshPropLine(db,keys.propline??'','FULL','ALL',f,counted,clock());
 progress({stage:'generate',message:'Generating Safer, Balanced, Aggressive and Long Shot with verified prices, player checks and the existing Pick 6 optimizer…'});
 // Both buttons analyze the same PropLine cache. Other workspaces retain multi-provider analysis.
 const analysis=await multiResearch(db,{fanduelapi:'','odds-api':'',propline:keys.propline??''},'FULL','ALL',f,clock(),testMode,new Set(slate.gameIds));
 const options=analysis.options as ResearchSlot<Ticket>[],records:BatchRecord[]=[],notes:string[]=[];
 progress({stage:'save',message:target==='paper'?'Capturing eligible virtual tickets atomically, with duplicate-wager checks…':'Saving eligible research tickets and pending grades, with duplicate-save checks…'});
 if(target==='paper'){
  const captured=await capturePaperSlate(db,slate,keys,f,clock(),'manual',undefined,async()=>({options}));notes.push(...captured.notes);
  for(const slot of options){const rows=db.prepare('SELECT id,created_at,slate_key,ticket_json FROM paper_wagers WHERE strategy=? ORDER BY id').all(slot.label) as {id:number;created_at:number;slate_key:string;ticket_json:string}[];
   const stored=rows.find(r=>r.slate_key===slate.key)??rows.find(r=>slot.ticket&&fullSignature(JSON.parse(r.ticket_json))===fullSignature(slot.ticket));
   if(stored){records.push({strategy:slot.label,id:stored.id,created:captured.createdIds.includes(stored.id),capturedAt:stored.created_at});slot.ticket=JSON.parse(stored.ticket_json);slot.missing=[];}
  }
 }else{
  // Transaction prevents concurrent clicks/restarts creating another archive of the same strategy/contracts.
  db.transaction(()=>{for(const slot of options){if(!slot.ticket)continue;const at=clock();assertCurrentPick6(slot.ticket,slate,at,testMode);
   const signature=fullSignature(slot.ticket),purpose=slot.ticket.purpose,old=db.prepare('SELECT ticket_id FROM pick6_batch_archives WHERE strategy=? AND signature=? AND purpose=?').get(slot.label,signature,purpose) as {ticket_id:number}|undefined;
   if(old){const row=db.prepare('SELECT created_at,legs_json,joint_p,decimal,purpose FROM saved_tickets WHERE id=?').get(old.ticket_id) as {created_at:number;legs_json:string;joint_p:number;decimal:number;purpose:Ticket['purpose']}|undefined;
    if(!row)throw new Pick6BatchError('Saved archive reference unavailable; no replacement record was invented.');
    slot.ticket={...slot.ticket,legs:JSON.parse(row.legs_json),jointP:row.joint_p,decimal:row.decimal,purpose:row.purpose,warnings:['Previously saved immutable research archive; original prices and capture time retained.']};records.push({strategy:slot.label,id:old.ticket_id,created:false,capturedAt:row.created_at});continue;}
   const saved=saveTicket(db,{...slot.ticket,kind:slot.label==='Safer'?'best':'aggr'},at);
   db.prepare('INSERT INTO pick6_batch_archives(strategy,signature,purpose,ticket_id) VALUES(?,?,?,?)').run(slot.label,signature,purpose,saved.id);records.push({strategy:slot.label,id:saved.id,created:true,capturedAt:at});
  }}).immediate();
 }
 const missing=PAPER_STRATEGIES.filter(s=>!records.some(r=>r.strategy===s));
 for(const strategy of missing){const slot=options.find(o=>o.label===strategy);notes.push(`${strategy}: ${slot?.missing.join(' ')||'No ticket was stored; inspect eligibility or virtual funds.'}`);}
 const created=records.filter(r=>r.created).length,summary=`${records.length} of 4 strategies ${target==='paper'?'captured':'saved'}: ${created} new, ${records.length-created} already recorded. ${providerRequests} PropLine request(s); no other odds provider refreshed.`;
 progress({stage:'complete',message:summary});
 return {target,analysis:{...analysis,providerStatus:multiProviderStatus(db,keys,clock()),sources:analysis.sources.map(source=>source.provider==='propline'?source:{...source,status:'not-used',note:'Not used by one-touch: only PropLine is analyzed/refreshed. Existing independent cache tools remain available.'}),options},records,missing,notes:[...new Set(notes)],providerRequests,created,summary};
}
