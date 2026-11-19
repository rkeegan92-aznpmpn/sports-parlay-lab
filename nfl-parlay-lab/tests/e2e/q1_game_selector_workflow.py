"""Q1 schedule-first selection and matching: production app, synthetic external sources, no real credentials."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3017';calls=Path(folder+'/calls')
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'fd_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FANDUEL':'1','PARLAY_E2E_Q1':'1','PARLAY_E2E_SUNDAY':'1','PARLAY_E2E_GAME_MATRIX':'1','PARLAY_E2E_CALL_LOG':str(calls),'NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def usage():return len(calls.read_text().splitlines()) if calls.exists() else 0
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3017'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   break
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Q1 selector fixture startup failed')
  time.sleep(.1)
 else:raise AssertionError('Selector server readiness timeout')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':800,'height':1280},timezone_id='America/Phoenix');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');q=page.get_by_role('region',name='First Quarter Parlays',exact=True)
  game=q.get_by_role('combobox',name='Q1 game',exact=True);scope=q.get_by_role('combobox',name='Q1 slate',exact=True)
  expect(game.locator('option')).to_have_count(6,timeout=30000);expect(scope).to_have_value('all');assert usage()==0
  labels=game.locator('option').all_text_contents();assert all(any(day in label for label in labels) for day in ['Thu','Sat','Sun','Mon']),labels
  scope.select_option('sunday');expect(q.get_by_label('Q1 selection scope',exact=True)).to_contain_text('Sunday');expect(game.locator('option')).to_have_count(3)
  scope.select_option('all');expect(game.locator('option')).to_have_count(6);expect(q.get_by_label('Q1 selection scope',exact=True)).to_contain_text('All upcoming NFL games');expect(q.get_by_label('Q1 selection scope',exact=True)).not_to_contain_text('Sunday only')
  game.select_option('2026_11_BUF_MIN')
  with page.expect_response(lambda r:r.url.endswith('/api/first-quarter') and r.request.method=='POST') as refreshed:q.get_by_role('button',name='Fetch shared FanDuel board for Q1',exact=True).click()
  data=refreshed.value.json();assert refreshed.value.ok,data
  assert data['diagnostics']['selectedGameId']=='2026_11_BUF_MIN';assert all(l['gameId']=='2026_11_BUF_MIN' for kind in ['best','aggressive'] for l in data[kind]['options'][0]['legs']);assert usage()==2
  expect(game.locator('option')).to_have_count(6)
  for id in ['2026_12_BUF_MIN','2026_13_BUF_MIN']:
   game.select_option(id)
   with page.expect_response(lambda r:'/api/first-quarter?' in r.url and 'provider=fanduel' in r.url) as generated:q.get_by_role('button',name='Generate 1Q Tickets from cache',exact=True).click()
   body=generated.value.json();assert generated.value.ok,body;assert body['diagnostics']['requestedDate']=='ALL';assert body['diagnostics']['selectedGameId']==id
   assert all(l['gameId']==id for kind in ['best','aggressive'] for l in body[kind]['options'][0]['legs'])
  with sqlite3.connect(folder+'/parlay.db') as db:
   key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':failure:'),json.dumps({'at':int(time.time()*1000),'status':429,'kind':'quota'}),int(time.time()*1000)))
   db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':cooldown:'),json.dumps({'until':int(time.time()*1000)+3600000,'status':429,'kind':'quota'}),int(time.time()*1000)))
  q.get_by_role('button',name='Generate 1Q Tickets from cache',exact=True).click();expect(q.get_by_role('alert')).to_contain_text('newer provider failure')
  access=q.get_by_role('region',name='Q1 provider access',exact=True);expect(access).to_contain_text('PAUSED');expect(access).to_contain_text('quota');expect(access).to_contain_text('HTTP 429');expect(q.get_by_role('button',name='Fetch shared FanDuel board for Q1',exact=True)).to_be_disabled()
  state=page.request.get(base+'/api/first-quarter?status=1').json();assert state['access']['failureKind']=='quota' and state['access']['automaticRetry']==False;assert state['collectionMode']=='explicit-refresh-only'
  with page.expect_response(lambda r:r.url.endswith('/api/first-quarter') and r.request.method=='POST') as preview:q.get_by_role('button',name='Preview cached Q1 research (stale allowed)',exact=True).click()
  body=preview.value.json();assert body['providerWarning'];assert body['diagnostics']['providerVerificationBlocked'];assert body['diagnostics']['freshSidePrices']==0 and body['diagnostics']['eligiblePlayers']==0
  assert len(body['preview']['options'])==2;assert all(l['gameId']=='2026_13_BUF_MIN' for t in body['preview']['options'] for l in t['legs']);expect(q).to_contain_text('STALE — RESEARCH PREVIEW ONLY')
  expect(game.locator('option')).to_have_count(6);q.get_by_role('button',name='Reload free NFL game list',exact=True).click();expect(game).to_be_enabled();expect(game.locator('option')).to_have_count(6)
  unknown=page.request.post(base+'/api/first-quarter',data={'action':'preview-fanduel','game':'missing-game','date':'ALL'}).json();assert unknown['preview']['options']==[]
  q.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED SCHEDULE/ODDS FIXTURES — NOT LIVE MARKETS';el.prepend(p)}")
  images=app.parent/'docs/screenshots';images.mkdir(parents=True,exist_ok=True)
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});q.scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');page.screenshot(path=str(images/f'q1-game-selector-{label}.png'))
  assert usage()==2,'Catalog, generation, preview, failure handling and reload must not request paid odds'
  assert not errors,errors;browser.close()
 with sqlite3.connect(folder+'/parlay.db') as db:
  assert db.execute('SELECT COUNT(*) FROM saved_tickets').fetchone()[0]==0;assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
 print('PASS: schedule catalog before price acquisition; Thursday/Saturday/Sunday/Monday options; all vs Sunday scope; selected-game generation/preview isolation; aliases/numeric/namespaced event IDs; quota pause/reset diagnostics with disabled refresh and zero retries; provider-failed non-actionable previews; preserved selectors; no extra paid requests or record writes; Phoenix phone/tablet layouts.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
