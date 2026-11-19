"""Production HTTP/browser workflow with test-only free-provider fixtures and isolated SQLite.
No ticket API response mocking; actual forms, matching, generation and storage routes run.
Run a separate real-provider smoke via npm run verify:free; fixtures do not prove live coverage.
"""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2]
folder=tempfile.mkdtemp(prefix='parlay-e2e-')
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
port=3011;base=f'http://127.0.0.1:{port}'
log=open(folder+'/server.log','w');child=None
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port',str(port)],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   break
  except Exception:
   if child.poll() is not None:raise AssertionError(Path(folder+'/server.log').read_text())
   time.sleep(.1)
 else:raise AssertionError('Application failed to start')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':412,'height':915});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle')
  expect(page.get_by_role('heading',name='Manual FanDuel odds entry',exact=True)).to_be_visible()
  game=page.get_by_label('Manual game',exact=True)
  game.locator('option').nth(2).wait_for(state='attached')
  first=game.locator('option').nth(1).get_attribute('value');second=game.locator('option').nth(2).get_attribute('value')
  entries=[(first,'QB One','player_pass_yds',-110),(first,'RB One','player_rush_yds',-110),(first,'WR One','player_reception_yds',-110),(second,'RB Two','player_rush_yds',-110),(second,'WR Two','player_reception_yds',-110),(second,'TE One','player_reception_yds',-110),(second,'RB Aggressive','player_rush_yds',190)]
  current=None
  for event,name,market,odds in entries:
   if current!=event:
    game.select_option(event);current=event
   page.get_by_label('Manual player',exact=True).locator(f'option[value="{name}"]').wait_for(state='attached')
   page.get_by_label('Manual player',exact=True).select_option(name)
   page.get_by_label('Manual market',exact=True).select_option(market)
   page.get_by_label('Manual line',exact=True).fill('50.5');page.get_by_label('Manual odds',exact=True).fill(str(odds))
   page.get_by_role('checkbox',name='I observed this exact FanDuel player, market, line and price at this time.').check()
   page.get_by_role('button',name='Add manual quote',exact=True).click()
   expect(page.get_by_role('status').filter(has_text='Manual quote saved')).to_be_visible()
  page.get_by_role('button',name='Generate Both Research Tickets',exact=True).click()
  best=page.get_by_role('region',name='Manual Best Six',exact=True);aggr=page.get_by_role('region',name='Manual Aggressive Six',exact=True)
  expect(best.locator('article')).to_have_count(6);expect(aggr.locator('article')).to_have_count(6)
  assert best.locator('article').all_text_contents()!=aggr.locator('article').all_text_contents()
  expect(best.get_by_text('MANUAL RESEARCH — not verified live odds',exact=True)).to_be_visible()
  page.get_by_role('button',name='Save Best Six',exact=True).click()
  expect(page.get_by_role('status').filter(has_text='Best Six saved.')).to_be_visible()
  page.get_by_role('button',name='Save Aggressive Six',exact=True).click()
  expect(page.get_by_role('status').filter(has_text='Aggressive Six saved.')).to_be_visible()
  page.reload(wait_until='networkidle')
  history=page.get_by_role('region',name='Research saved history',exact=True)
  expect(history.locator('details')).to_have_count(2)
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Phone layout overflows'
  page.set_viewport_size({'width':800,'height':1280})
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Tablet layout overflows'
  page.get_by_role('button',name='Refresh ticket outcomes',exact=True).click()
  upcoming=page.get_by_role('region',name='Upcoming Picks — Pending',exact=True)
  expect(upcoming.locator('details')).to_have_count(2)
  expect(page.get_by_role('region',name='Completed Picks — Graded',exact=True).get_by_text('No tickets in this section.',exact=False)).to_be_visible()
  page.get_by_label('Historical season',exact=True).fill('2026')
  page.get_by_role('button',name='Run historical backtest',exact=True).click()
  backtest=page.get_by_role('region',name='Historical Backtests — Simulated Results',exact=True)
  expect(backtest.get_by_text('BACKTEST 2026:',exact=False)).to_be_visible(timeout=30000)
  assert backtest.locator('article').count()>=12
  with page.expect_response(lambda r:'/api/historical?season=2026' in r.url) as replay:
   page.get_by_role('button',name='Run historical backtest',exact=True).click()
  assert replay.value.json()['cached'] is True
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  assert not errors,errors
  browser.close()
 with sqlite3.connect(folder+'/parlay.db') as db:
  assert db.execute('SELECT COUNT(*) FROM manual_quotes').fetchone()[0]==7
  assert db.execute('SELECT COUNT(*) FROM saved_tickets').fetchone()[0]==2
  assert db.execute("SELECT COUNT(*) FROM saved_tickets WHERE source='manual' AND purpose='manual-research'").fetchone()[0]==2
  assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
  assert db.execute('SELECT COUNT(*) FROM historical_backtests').fetchone()[0]==1
 # Reopen the same disk database in a fresh app process, not only a browser refresh.
 child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port',str(port)],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(100):
  try:
   with urllib.request.urlopen(base+'/api/saved',timeout=1) as response:assert len(json.load(response))==2
   break
  except Exception:time.sleep(.1)
 else:raise AssertionError('Saved manual tickets did not survive app restart')
 # Fault injection: expire only the isolated schedule cache, keep archives, restart with a failed source.
 child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 with sqlite3.connect(folder+'/parlay.db') as db:db.execute("UPDATE cache SET fetched_at=0 WHERE key LIKE '%game-schedule%'")
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port',str(port)],cwd=app,env={**env,'PARLAY_E2E_FAIL_SCHEDULE':'1'},stdout=log,stderr=subprocess.STDOUT)
 for _ in range(100):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as response:assert json.load(response)['database']=='ready'
   break
  except Exception:time.sleep(.1)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page();page.goto(base)
  expect(page.get_by_role('alert').filter(has_text='Free provider data is unavailable')).to_be_visible(timeout=30000)
  expect(page.get_by_role('region',name='Research saved history',exact=True).locator('details')).to_have_count(2)
  browser.close()
 print('PASS: production startup, free schedule/player forms, seven manual entries through real HTTP validation, distinct structured six-leg generation, save both, reload/restart persistence, source-failure recovery with archives visible, separate pending/graded/backtest dashboard with no archive duplication or calibration promotion, 412px phone and 800px tablet layout. External free providers used explicit isolated fixtures; no paid requests or mocked ticket/storage routes.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
