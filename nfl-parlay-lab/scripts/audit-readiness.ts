import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {databaseFile} from '../src/server/storage.ts';
import {forwardReadiness} from '../src/server/forwardReadiness.ts';
const cwd=fileURLToPath(new URL('../',import.meta.url));process.chdir(cwd);
createRequire(import.meta.url)('@next/env').loadEnvConfig(cwd,process.env.NODE_ENV!=='production',{info(){},error(){}});
try{const db=new Database(databaseFile(),{readonly:true,fileMustExist:true});try{console.log(JSON.stringify(forwardReadiness(db),null,2));}finally{db.close();}}catch{console.error('Existing readiness database could not be read. No database was created, migrated or replaced.');process.exitCode=1;}
