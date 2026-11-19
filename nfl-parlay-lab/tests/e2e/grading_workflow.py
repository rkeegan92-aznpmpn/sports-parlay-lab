"""Automatic collector -> final-result matching -> stored grades -> mobile dashboard.
All source data and seeded contracts are explicit isolated fixtures, not genuine FanDuel prices.
"""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-grading-');log=open(folder+'/server.log','w');child=None
base='http://127.0.0.1:3013'
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','COLLECTOR_ENABLED':'1','COLLECTOR_MODE':'settle-only','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FINAL':'1','NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
now=datetime.datetime.now(datetime.timezone.utc);day=(now-datetime.timedelta(days=7)).date().isoformat();ko=day+'T18:00:00Z';capture=int((datetime.datetime.fromisoformat(day+'T00:00:00+00:00')-datetime.timedelta(days=1)).timestamp()*1000)
players=[('QB One','QB','BUF','MIN','player_pass_yds','2026_10_BUF_MIN'),('RB One','RB','BUF','MIN','player_rush_yds','2026_10_BUF_MIN'),('WR One','WR','MIN','BUF','player_reception_yds','2026_10_BUF_MIN'),('RB Two','RB','SEA','LA','player_rush_yds','2026_10_LA_SEA'),('WR Two','WR','LA','SEA','player_reception_yds','2026_10_LA_SEA'),('TE One','TE','SEA','LA','player_reception_yds','2026_10_LA_SEA')]
legs=[dict(name=n,pos=p,team=t,opp=o,market=m,gameId=g,resultGameId=g,historyPlayerId='id-'+n,historySource='nflverse',source='manual',side='Over',line=50.5,odds=-110,kickoff=ko,oddsAt=day+'T00:00:00Z',id='fixture-'+str(i)) for i,(n,p,t,o,m,g) in enumerate(players)]
loss=[{**l,'line':999 if i==0 else l['line']} for i,l in enumerate(legs)]
missing=[{**l,'historyPlayerId':'missing-fixture' if i==0 else l['historyPlayerId']} for i,l in enumerate(legs)]
future=[{**l,'kickoff':(now+datetime.timedelta(days=7)).isoformat()} for l in legs]
seed=Path(folder+'/seed.json');seed.write_text(json.dumps([legs,loss,missing,future]))
code="""import {SCHEMA} from './src/server/db.ts';import Database from 'better-sqlite3';import {readFileSync} from 'node:fs';const db=new Database(process.env.DB_PATH);db.exec(SCHEMA);for(const legs of JSON.parse(readFileSync(process.argv[1],'utf8')))db.prepare('INSERT INTO saved_tickets(kind,created_at,source,legs_json,purpose) VALUES(?,?,?,?,?)').run('best',Number(process.argv[2]),'manual',JSON.stringify(legs),'test-research');db.close();"""
try:
 subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code,str(seed),str(capture)],cwd=app,env=env,check=True,capture_output=True)
 with sqlite3.connect(env['DB_PATH']) as db:before=db.execute('SELECT id,legs_json FROM saved_tickets ORDER BY id').fetchall()
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3013'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(200):
  try:
   with urllib.request.urlopen(base+'/api/grades',timeout=2) as r:grades=json.load(r)
   if all(str(i) in grades for i in range(1,5)) and grades['1'].get('finalized') and grades['2'].get('finalized'):break
  except Exception:pass
  if child.poll() is not None:raise AssertionError(Path(folder+'/server.log').read_text())
  time.sleep(.1)
 else:raise AssertionError('Automatic collector did not grade final fixture games: '+Path(folder+'/server.log').read_text())
 assert grades['1']['status']=='win' and grades['2']['status']=='loss'
 assert grades['3']['status']=='pending' and grades['4']['status']=='pending'
 assert grades['3']['legs'][0]['actual'] is None
 assert all(isinstance(l['actual'],(int,float)) for l in grades['1']['legs'])
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':412,'height':915});page.goto(base)
  completed=page.get_by_role('region',name='Completed Picks — Graded',exact=True)
  expect(completed.locator('details')).to_have_count(2)
  expect(page.get_by_role('region',name='Upcoming Picks — Pending',exact=True).locator('details')).to_have_count(2)
  completed.locator('summary').first.click();expect(completed.get_by_text('Win · actual',exact=False).first).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  page.set_viewport_size({'width':800,'height':1280});assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  browser.close()
 with sqlite3.connect(env['DB_PATH']) as db:
  assert db.execute('SELECT id,legs_json FROM saved_tickets ORDER BY id').fetchall()==before
  assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
 print('PASS: automatic settlement-only collector grades six final legs, win/loss and actual values; missing and future tickets stay pending; pending/completed dashboards render on phone/tablet; saved records remain byte-identical. External data/seeded contracts are isolated fixtures.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
