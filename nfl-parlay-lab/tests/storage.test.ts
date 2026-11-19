import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFile } from '../src/server/storage.ts';

test('persistent deployments reject implicit, relative and temporary database paths', () => {
  for (const DB_PATH of [undefined, './data/parlay.db', '/tmp/parlay.db', '/var/tmp/parlay.db', ':memory:', '/var/data/../../tmp/parlay.db']) {
    assert.throws(() => databaseFile({ DB_PATH, REQUIRE_PERSISTENT_DB: '1' }), /mounted data disk/);
  }
  assert.equal(databaseFile({ DB_PATH: '/var/data/parlay.db', REQUIRE_PERSISTENT_DB: '1' }), '/var/data/parlay.db');
  assert.equal(databaseFile({}), './data/parlay.db');
});


test('collector CLI resolves a relative DB_PATH in the application, not its launch directory', async () => {
  const {mkdtempSync,existsSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const path=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const {spawnSync}=await import('node:child_process');
  const app=fileURLToPath(new URL('../',import.meta.url)), folder=mkdtempSync(path.join(tmpdir(),'parlay-cli-path-'));
  const target=path.join(folder,'parlay.db');
  try {
    // Test path resolution independently of external schedule uptime; forbid other network requests.
    const loader=path.join(folder,'empty-schedule.mjs');
    writeFileSync(loader,"globalThis.fetch=async(input)=>{if(String(input).endsWith('games.csv'))return new Response('game_id,season,week,game_type,gameday,gametime,home_team,away_team\\n');throw new Error('External request forbidden in storage path test');};");
    const result=spawnSync(process.execPath,['--experimental-strip-types','--import',loader,path.join(app,'scripts/track-forecasts.ts'),'--settle-only'],
      {cwd:tmpdir(),env:{...process.env,DB_PATH:path.relative(app,target),REQUIRE_PERSISTENT_DB:'0',ODDS_API_KEY:'',NODE_ENV:'test'},encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);assert.equal(existsSync(target),true);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
