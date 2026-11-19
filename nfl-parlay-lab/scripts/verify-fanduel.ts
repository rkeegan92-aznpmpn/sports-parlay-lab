// Explicit live probe: may spend the account's documented REST request allowance.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));process.chdir(cwd);
createRequire(import.meta.url)('@next/env').loadEnvConfig(cwd,process.env.NODE_ENV!=='production',{info(){},error(){}});
const key=process.env.FANDUEL_API_KEY?.trim();
if(!key){console.log(JSON.stringify({status:'BLOCKED',keyConfigured:false,reason:'FANDUEL_API_KEY is missing from this server environment. Configure it privately in application .env.local and restart. Do not paste the key into chat.',providerRequests:0}));process.exitCode=2;}
else {
 const {getDb}=await import('../src/server/db.ts');const {cachedProviderFetch}=await import('../src/server/load.ts');
 const {refreshBoard,FanDuelRestError}=await import('../src/server/fanduelRest.ts');const {fanduelResearch}=await import('../src/server/fanduelResearch.ts');
 try {const db=getDb(),board=await refreshBoard(db,key),r=await fanduelResearch(board,cachedProviderFetch(db));
  console.log(JSON.stringify({status:r.tickets.length===2?'PASS':'LIMITED',keyConfigured:true,authenticatedSnapshotFetchedAt:new Date(board.fetchedAt).toISOString(),matchedEvents:r.matchedEvents,availableSideQuotes:r.quotes.length,eligibleSideQuotes:r.quotes.filter(q=>q.freshness.eligible).length,distinctAggressiveTickets:r.tickets.length,missing:r.missing,issues:r.issues,provenance:r.provenance,savedTicketsCreated:0,forecastsCreated:0},null,2));if(r.tickets.length!==2)process.exitCode=2;
 }catch(e){console.log(JSON.stringify({status:'BLOCKED',keyConfigured:true,error:e instanceof FanDuelRestError?e.message:'Free statistics/roster data unavailable; no substitute data generated.',retryAt:e instanceof FanDuelRestError?e.retryAt:null}));process.exitCode=2;}
}
export {};
