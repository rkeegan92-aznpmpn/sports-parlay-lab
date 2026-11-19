// Read-only cache audit: no HTTP, no secret output, no recommendations or DB migrations.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {Buffer} from 'node:buffer';
const cwd=fileURLToPath(new URL('../',import.meta.url));process.chdir(cwd);
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(cwd,process.env.NODE_ENV!=='production',{info(){},error(){}});
const {databaseFile}=await import('../src/server/storage.ts'),{readBoard,providerAccessStatus}=await import('../src/server/fanduelRest.ts'),{inspectQuarterBoard}=await import('../src/server/quarterDiagnostics.ts'),{freeSchedule}=await import('../src/server/freeResearch.ts');
const game=process.argv.find(a=>a.startsWith('--game='))?.slice(7)??'ALL',date=process.argv.find(a=>a.startsWith('--date='))?.slice(7)??'ALL';
let db:import('better-sqlite3').Database|undefined;
try{
 const file=databaseFile();if(!fs.existsSync(file))throw new Error('No local database.');
 db=new (require('better-sqlite3'))(file,{readonly:true,fileMustExist:true});
 const key=process.env.FANDUEL_API_KEY?.trim();const board=key?readBoard(db!,key):null;
 if(!board){console.log(JSON.stringify({status:'CACHE_UNAVAILABLE',keyConfigured:!!key,reason:'No matching cached FanDuel board in this workspace. The private Codespace cache was not accessed.',networkRequests:0,writes:0}));process.exitCode=2;}
 else{
  const row=db!.prepare('SELECT value,fetched_at FROM cache WHERE key=?').get('provider:nflverse:game-schedule') as {value:string;fetched_at:number}|undefined;
  let games:Awaited<ReturnType<typeof freeSchedule>>=[];let scheduleAvailable=false;
  if(row){try{games=await freeSchedule(async()=>new Response(row.value.startsWith('base64:')?Buffer.from(row.value.slice(7),'base64'):row.value.startsWith('text:')?row.value.slice(5):row.value));scheduleAvailable=true;}catch{/* Diagnostic-only: never fetch or replace missing source data. */}}
  const d=inspectQuarterBoard(board,games,Date.now(),date,game).diagnostics;
  console.log(JSON.stringify({status:'READ_ONLY_DIAGNOSTICS',networkRequests:0,writes:0,providerAccess:providerAccessStatus(db!,key??''),collectionMode:'explicit-refresh-only',scheduleAvailable,scheduleCacheFetchedAt:row?new Date(row.fetched_at).toISOString():null,warning:'Cached schedule may be stale. Player availability/history eligibility is not evaluated by this offline audit. No picks generated.',diagnostics:d},null,2));
 }
}catch{console.log(JSON.stringify({status:'UNAVAILABLE',reason:'Cached Q1 audit could not read the existing local database/schema. No data was modified.',networkRequests:0,writes:0}));process.exitCode=2;}finally{db?.close();}
export {};
