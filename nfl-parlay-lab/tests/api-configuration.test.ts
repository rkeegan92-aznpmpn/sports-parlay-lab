import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fetchEvents,OddsApiError} from '../src/lib/providers/oddsApi.ts';
import {credentialFingerprint,liveCacheKey} from '../src/server/credentials.ts';
import {SCHEMA,getDb} from '../src/server/db.ts';
import {acquireCollector} from '../src/server/collector.ts';
import {liveHealth} from '../src/server/liveHealth.ts';
import {getData} from '../src/server/load.ts';

test('provider quota codes on 401 are not mislabeled as an invalid key and raw errors never escape',async()=>{
  for(const code of ['OUT_OF_USAGE_CREDITS','INVALID_KEY','EXCEEDED_FREQ_LIMIT']) {
    const status=code==='EXCEEDED_FREQ_LIMIT'?429:401;
    await assert.rejects(fetchEvents('fixture-secret',async(_url,init)=>{
      assert.equal(init?.cache,'no-store');
      return Response.json({error_code:code,message:'https://secret.invalid/?apiKey=fixture-secret'},{status,headers:{'retry-after':'120','x-requests-remaining':'0'}});
    }),(e:unknown)=>{
      assert.ok(e instanceof OddsApiError);assert.equal(e.code,code);assert.equal(e.remaining,'0');assert.equal(e.retryAfterMs,120000);
      assert.ok(!e.message.includes('fixture-secret'));
      if(code==='OUT_OF_USAGE_CREDITS') assert.match(e.message,/credits exhausted/);
      return true;
    });
  }
});

test('Next environment priority preserves existing process bindings over env files',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'nfl-env-priority-'));
  const module=createRequire(import.meta.url).resolve('@next/env');
  writeFileSync(path.join(dir,'.env'),'ODDS_API_KEY=file-base-fixture\n');
  writeFileSync(path.join(dir,'.env.local'),'ODDS_API_KEY=file-local-fixture\n');
  const code=`require(${JSON.stringify(module)}).loadEnvConfig(${JSON.stringify(dir)},true,{info(){},error(){}});process.stdout.write(JSON.stringify({isProcess:process.env.ODDS_API_KEY==='process-fixture',isLocal:process.env.ODDS_API_KEY==='file-local-fixture',empty:process.env.ODDS_API_KEY===''}));`;
  try {
    for(const [binding,expected] of [['process-fixture','isProcess'],['','empty'],[undefined,'isLocal']] as const) {
      const env={...process.env};delete env.__NEXT_PROCESSED_ENV;delete env.ODDS_API_KEY;
      if(binding!==undefined)env.ODDS_API_KEY=binding;
      const output=JSON.parse(execFileSync(process.execPath,['-e',code],{env,encoding:'utf8'}));assert.equal(output[expected],true);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('health detects a stale worker credential without exposing either key',()=>{
  const db=new Database(':memory:');db.exec(SCHEMA);const old=process.env.ODDS_API_KEY;
  try {
    process.env.ODDS_API_KEY='worker-fixture';acquireCollector(db,'fixture',1000);
    const h=liveHealth(db,{ODDS_API_KEY:'web-fixture'},1100);
    assert.equal(h.collectorCredentialMismatch,true);
    assert.equal(h.collector.credentialFingerprint,credentialFingerprint('worker-fixture'));
    assert.ok(!JSON.stringify(h).includes('worker-fixture'));assert.ok(!JSON.stringify(h).includes('web-fixture'));
    assert.notEqual(liveCacheKey('worker-fixture'),liveCacheKey('web-fixture'));
  }finally{db.close();if(old===undefined)delete process.env.ODDS_API_KEY;else process.env.ODDS_API_KEY=old;}
});

test('credential-scoped cooldown suppresses repeated forced requests, preserves archives, and isolates key changes',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'nfl-cooldown-'));const old={key:process.env.ODDS_API_KEY,db:process.env.DB_PATH};
  const original=globalThis.fetch;let calls=0;
  process.env.DB_PATH=path.join(dir,'isolated.db');process.env.ODDS_API_KEY='first-fixture';
  globalThis.fetch=async()=>{calls++;return Response.json({error_code:'OUT_OF_USAGE_CREDITS'},{status:401,headers:{'retry-after':'60'}});};
  try {
    const db=getDb();db.prepare("INSERT INTO saved_tickets(kind,created_at,source,purpose,legs_json) VALUES('best',1,'live','test-research','[]')").run();
    await Promise.all([assert.rejects(getData(),/credits exhausted/),assert.rejects(getData(true),/credits exhausted/)]);
    await assert.rejects(getData(true),/requests paused/);assert.equal(calls,1);
    process.env.ODDS_API_KEY='second-fixture';await assert.rejects(getData(),/credits exhausted/);assert.equal(calls,2);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saved_tickets').get() as {n:number}).n,1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM forecast_snapshots').get() as {n:number}).n,0);
  }finally{
    globalThis.fetch=original;getDb().close();
    if(old.key===undefined)delete process.env.ODDS_API_KEY;else process.env.ODDS_API_KEY=old.key;
    if(old.db===undefined)delete process.env.DB_PATH;else process.env.DB_PATH=old.db;
    rmSync(dir,{recursive:true,force:true});
  }
});
