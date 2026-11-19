// Dry-run by default. Explicit --live is a bounded, selected-game-only account request.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const cwd=fileURLToPath(new URL('../',import.meta.url));process.chdir(cwd);
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(cwd,process.env.NODE_ENV!=='production',{info(){},error(){}});
const {propLineStatus,propLineEvidence,refreshPropLine,PropLineError}=await import('../src/server/propline.ts');
const key=process.env.PROPLINE_API_KEY?.trim()??'',live=process.argv.includes('--live'),game=process.argv.find(a=>a.startsWith('--game='))?.slice(7),period=process.argv.find(a=>a.startsWith('--period='))?.slice(9);
if(!live){
 let db:import('better-sqlite3').Database|undefined;
 try{const {databaseFile}=await import('../src/server/storage.ts');if(key&&fs.existsSync(databaseFile()))db=new(require('better-sqlite3'))(databaseFile(),{readonly:true,fileMustExist:true});console.log(JSON.stringify({mode:'DRY_RUN',keyConfigured:!!key,providerRequests:0,writes:0,status:db?propLineStatus(db,key):'Local provider cache/config unavailable. No live access implied.',q1Evidence:db?propLineEvidence(db,key,'Q1',game??'ALL'):null,nextAction:'Only an explicit --live --game=VERIFIED_NFL_GAME_ID --period=FULL|Q1 can use up to two PropLine requests. Configure the key privately in the nested app .env.local; never paste it into chat.'},null,2));}catch{console.log(JSON.stringify({mode:'DRY_RUN',keyConfigured:!!key,providerRequests:0,writes:0,status:'Local persistent provider state unavailable.'}));}finally{db?.close();}
}else if(!key||!game||!/^\d{4}_\d{1,2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(game)||!['FULL','Q1'].includes(period??'')){
 console.log(JSON.stringify({status:'BLOCKED',keyConfigured:!!key,providerRequests:0,reason:'Live verification requires a server key, one canonical verified upcoming game, and FULL or Q1. ALL/bulk and automatic retries are disabled in this script.'}));process.exitCode=2;
}else{
 let calls=0;try{const {getDb}=await import('../src/server/db.ts'),{cachedProviderFetch}=await import('../src/server/load.ts');const db=getDb();
  const counted:typeof fetch=async(input,init)=>{calls++;return fetch(input,init);};
  const snapshot=await refreshPropLine(db,key,period as 'FULL'|'Q1',game,cachedProviderFetch(db),counted),rows=Object.values(snapshot.rows).flat();
  console.log(JSON.stringify({status:rows.length?'PROVIDER_ROWS_RETURNED_NOT_ROSTER_VALIDATED':'NO_USABLE_PRICES',providerRequests:calls,mode:period,game,snapshotAt:new Date(snapshot.at).toISOString(),matchedEvents:snapshot.events.length,parsedSidePrices:rows.length,coverage:snapshot.coverage,rejections:snapshot.rejections,usage:propLineStatus(db,key).usage,sample:rows.slice(0,3),directSportsbookVerification:false,generatedTickets:0,savedTicketsCreated:0,forecastsCreated:0},null,2));
 }catch(e){console.log(JSON.stringify({status:'BLOCKED',keyConfigured:true,providerRequests:calls,error:e instanceof PropLineError?e.message:'Free schedule or persistent provider state could not be verified.',retryAt:e instanceof PropLineError?e.retryAt:null}));process.exitCode=2;}
}
export {};
