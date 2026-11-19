import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const directory=fileURLToPath(new URL('../',import.meta.url));process.chdir(directory);
const {loadEnvConfig}=createRequire(import.meta.url)('@next/env');loadEnvConfig(directory,process.env.NODE_ENV!=='production');
const {databaseFile}=await import('../src/server/storage.ts');
const {settlementAudit}=await import('../src/server/settlementAudit.ts');
const redact=(value:unknown):unknown=>typeof value==='string'?value.replaceAll(process.env.ODDS_API_KEY?.trim()||'\u0000','[redacted]').replace(/apiKey=[^&\s]*/gi,'apiKey=[redacted]'):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item)])):value;
try {
  const file=databaseFile();
  if(file===':memory:'||!existsSync(file))throw new Error('No existing on-disk database at the configured DB_PATH. Audit did not create one.');
  const db=new Database(file,{readonly:true,fileMustExist:true});
  let audit:ReturnType<typeof settlementAudit>;
  try {audit=settlementAudit(db);} finally {db.close();}
  let providerProbe:unknown;
  if(process.argv.includes('--probe-results')) {
    try {
      const {loadSchedule,loadFinalStats}=await import('../src/lib/providers/stats.ts');
      const {verifyCurrentRoster,loadEspnSettlementStats}=await import('../src/lib/providers/espn.ts');
      const {currentSeason}=await import('../src/lib/service.ts');
      const season=currentSeason(),schedule=await loadSchedule(),stats=await loadFinalStats(season,schedule);
      const roster=await verifyCurrentRoster([{key:'probe',name:'Josh Allen',position:'QB',team:'BUF'}]);
      const athlete=roster.players.get('probe');
      const event=schedule.filter((row)=>Number(row.season)===season&&row.game_type==='REG'&&[row.home_team,row.away_team].includes('BUF')&&row.home_score?.trim()&&row.away_score?.trim()&&/^\d+$/.test(row.espn??'')).sort((a,b)=>b.gameday.localeCompare(a.gameday))[0];
      const espn=athlete&&event?await loadEspnSettlementStats([{playerId:`espn:${athlete.id}`,season,kickoffTs:Date.parse(event.gameday),eventId:event.espn}]):null;
      providerProbe={season,statsRows:stats.length,exactKickoffRows:stats.filter((game)=>game.kickoffTs!=null&&Number.isFinite(game.kickoffTs)).length,finalGameIds:new Set(stats.filter((game)=>game.completed).map((game)=>game.gameId)).size,
        espnRosterMatches:roster.players.size,espnFinalRows:espn?.games.length??0,espnExactKickoffRows:espn?.games.filter((game)=>game.kickoffTs!=null&&Number.isFinite(game.kickoffTs)).length??0,espnEventState:event?espn?.eventStates.get(event.espn)??'unavailable':'unavailable',
        errors:espn?.errors??[],note:'Free-provider probe only; it does not settle or fabricate any forecast and cannot prove coverage of every pending record.'};
    } catch {providerProbe={error:'Free-provider result probe failed. Check network/provider availability. No forecast records were changed.'};process.exitCode=1;}
  }
  console.log(JSON.stringify(redact({...audit,...(providerProbe?{providerProbe}:{})}),null,2));
} catch {console.error('Audit could not read the existing database. Check DB_PATH and read permissions. No database was created or changed.');process.exitCode=1;}
export {};
