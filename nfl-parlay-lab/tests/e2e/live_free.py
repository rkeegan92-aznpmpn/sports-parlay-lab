"""Real free-provider HTTP/browser smoke. No provider fixtures, no manual/simulated prices."""
import os,json,time,signal,subprocess,tempfile,urllib.request,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-free-live-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3012'
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','COLLECTOR_ENABLED':'1','COLLECTOR_MODE':'auto','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production'}
assert 'provider-loader' not in env.get('NODE_OPTIONS',''),'Real probe cannot use fixtures'
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3012'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:h=json.load(r)
   if h['collector']['active'] and any(p['phase']=='capture' and p['status']=='paused' for p in h.get('collectionPhases',[])):break
  except Exception:pass
  if child.poll() is not None:raise AssertionError(Path(folder+'/server.log').read_text())
  time.sleep(.1)
 else:raise AssertionError('Real free-source app did not become ready')
 assert h['oddsApiKeyConfigured'] is False
 assert h['collector']['mode']=='settle-only'
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':412,'height':915});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base)
  game=page.get_by_label('Manual game',exact=True)
  game.locator('option').nth(1).wait_for(state='attached',timeout=90000)
  event=game.locator('option').nth(1).get_attribute('value');game.select_option(event)
  players=page.get_by_label('Manual player',exact=True)
  players.locator('option').nth(1).wait_for(state='attached',timeout=90000)
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  assert not errors,errors
  print(json.dumps({'status':'PASS','fixtureProviders':False,'effectiveOddsKeyConfigured':False,'upcomingGames':game.locator('option').count()-1,'selectedEvent':event,'verifiedPlayerOptions':players.locator('option').count()-1,'collectorMode':h['collector']['mode'],'manualQuotesEntered':0,'liveTicketsClaimed':0,'phoneWidth':412}))
  browser.close()
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
