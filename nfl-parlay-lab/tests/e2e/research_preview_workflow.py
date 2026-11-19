"""Issue #17: real production routes/storage/UI with synthetic provider contracts only."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3015'
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'fd_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FANDUEL':'1','PARLAY_E2E_Q1':'1','PARLAY_E2E_SUNDAY':'1','PARLAY_E2E_CALL_LOG':folder+'/calls','NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def start():
 global child
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3015'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   return
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Preview fixture server startup failed')
  time.sleep(.1)
 raise AssertionError('Preview server readiness timeout')
def stop():
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
def calls():return len(Path(folder+'/calls').read_text().splitlines())
try:
 start()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':412,'height':915});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  fresh=page.request.post(base+'/api/fanduel',data={'action':'refresh','testMode':True}).json();assert len(fresh['tickets'])==2
  ticket=fresh['tickets'][0];assert page.request.post(base+'/api/saved',data={**ticket,'kind':'aggr'}).ok
  assert calls()==2
  with sqlite3.connect(folder+'/parlay.db') as db:
   before=db.execute('SELECT * FROM saved_tickets ORDER BY id').fetchall();key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();board=json.loads(value)
   old=datetime.datetime.fromtimestamp(time.time()-10800,datetime.timezone.utc).isoformat()
   for prop in board['props']:
    prop['record']['observed_at']=old;prop['meta']['asOf']=old;prop['meta']['observedAt']=old
   db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(board),key));db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':failure:'),json.dumps({'at':int(time.time()*1000)}),int(time.time()*1000)))
  strict=page.request.post(base+'/api/fanduel',data={'action':'generate'});assert strict.status==409
  stale=page.request.post(base+'/api/fanduel',data={'action':'preview'}).json();assert len(stale['preview']['options'])==2 and not stale['tickets'] and stale['providerWarning']
  assert all(t['actionable'] is False and len(t['legs'])==6 for t in stale['preview']['options'])
  q1=page.request.get(base+'/api/first-quarter?provider=fanduel&preview=1').json();assert len(q1['preview']['options'])==2 and q1['diagnostics']['freshSidePrices']==0 and q1['diagnostics']['eligibleSideProps']==0
  assert any(g['category']=='freshness' for g in q1['rejectionGroups']);assert q1['providerWarning']
  page.goto(base,wait_until='networkidle');panel=page.get_by_role('region',name='FanDuel API research',exact=True)
  panel.get_by_role('button',name='Preview cached six-leg research (stale allowed)',exact=True).click()
  previews=panel.get_by_role('region',name='Stale research previews',exact=True);expect(previews.get_by_role('article')).to_have_count(2,timeout=30000)
  first=previews.get_by_role('article').first.locator('details').first;first.locator('summary').click()
  local=datetime.datetime.now().strftime('%Y-%m-%dT%H:%M');first.locator('input[name="observedAt"]').fill(local);first.locator('input[name="confirmed"]').check()
  first.get_by_role('button',name='Save manual comparison / recheck',exact=True).click();expect(first.get_by_role('status')).to_contain_text('MANUALLY VERIFIED BY USER')
  page.reload(wait_until='networkidle');panel.get_by_role('button',name='Preview cached six-leg research (stale allowed)',exact=True).click();first=previews.get_by_role('article').first.locator('details').first;expect(first.locator('summary')).to_contain_text('MANUALLY VERIFIED BY USER',timeout=30000)
  first.locator('summary').click();first.locator('input[name="line"]').fill('999.5');first.locator('input[name="observedAt"]').fill(local);first.locator('input[name="confirmed"]').check();first.get_by_role('button',name='Save manual comparison / recheck',exact=True).click();expect(first.get_by_role('status')).to_contain_text('CHANGED / UNVERIFIED')
  quarter=page.get_by_role('region',name='First Quarter Parlays',exact=True)
  # Owner sequence: strict generation fails first, then the preview tap must clear that error.
  quarter.get_by_role('button',name='Generate 1Q Tickets from cache',exact=True).click()
  expect(quarter.get_by_role('alert')).to_contain_text('newer provider failure')
  with page.expect_response(lambda r:r.url.endswith('/api/first-quarter') and r.request.method=='POST') as preview_response:
   quarter.get_by_role('button',name='Preview cached Q1 research (stale allowed)',exact=True).click()
  submitted=preview_response.value.request.post_data_json;assert submitted['action']=='preview-fanduel' and submitted['date']=='ALL' and submitted['game']=='ALL'
  assert preview_response.value.json()['requestMode']=='cached-preview'
  expect(quarter.get_by_role('region',name='Cached Q1 preview outcome',exact=True)).to_contain_text('2 of 2 research options')
  expect(quarter).not_to_contain_text('Fetch successfully before generating again.')
  qp=quarter.get_by_role('region',name='Stale research previews',exact=True);expect(qp.get_by_role('article')).to_have_count(2,timeout=30000)
  qcheck=qp.get_by_role('article').first.locator('details').first;qcheck.locator('summary').click();qcheck.locator('input[name="observedAt"]').fill(local);qcheck.locator('input[name="confirmed"]').check();qcheck.get_by_role('button',name='Save manual comparison / recheck',exact=True).click();expect(qcheck.get_by_role('status')).to_contain_text('MANUALLY VERIFIED BY USER')
  qcheck.locator('input[name="available"]').uncheck();qcheck.get_by_role('button',name='Save manual comparison / recheck',exact=True).click();expect(qcheck.get_by_role('status')).to_contain_text('UNAVAILABLE')
  for width,height in [(412,915),(800,1280)]:
   page.set_viewport_size({'width':width,'height':height});assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),'Preview/manual controls overflow mobile/tablet'
  with sqlite3.connect(folder+'/parlay.db') as db:
   key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();original=value;partial=json.loads(value);partial['props']=[q for q in partial['props'] if q['record'].get('id')!='q1-2'];db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(partial),key))
  quarter.get_by_role('button',name='Preview cached Q1 research (stale allowed)',exact=True).click()
  expect(quarter.get_by_role('region',name='Cached Q1 preview outcome',exact=True)).to_contain_text('0 of 2 research options')
  expect(qp).to_contain_text('have 2');expect(qp.get_by_role('article')).to_have_count(0)
  with sqlite3.connect(folder+'/parlay.db') as db:db.execute('UPDATE cache SET value=? WHERE key=?',(original,key))
  bad_date=page.request.post(base+'/api/first-quarter',data={'action':'preview-fanduel','date':'invalid'});assert bad_date.status==400
  with sqlite3.connect(folder+'/parlay.db') as db:
   key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();db.execute('DELETE FROM cache WHERE key=?',(key,))
  quarter.get_by_role('button',name='Preview cached Q1 research (stale allowed)',exact=True).click()
  expect(quarter.get_by_role('alert')).to_contain_text('No readable cached FanDuel board')
  with sqlite3.connect(folder+'/parlay.db') as db:db.execute('INSERT INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key,value,int(time.time()*1000)))
  target=stale['preview']['options'][0]['legs'][0];bad=page.request.post(base+'/api/quote-comparisons',data={'target':{**target,'market':'player_receptions'},'observation':{}});assert bad.status==400
  assert calls()==2,'Preview, failed strict generation, missing cache and manual verification must not request odds'
  assert not errors,errors;browser.close()
 stop();start()
 with urllib.request.urlopen(base+'/api/quote-comparisons') as r:assert len(json.load(r)['checks'])==4
 with sqlite3.connect(folder+'/parlay.db') as db:
  assert db.execute('SELECT * FROM saved_tickets ORDER BY id').fetchall()==before
  assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
 print('PASS: Sunday-only six-leg/Q1 stale previews from unchanged cached evidence, strict fresh mode blocked, grouped reasons, manual exact-match/changed/unavailable checks, reload/server-restart persistence, no odds requests beyond initial board, no forecast/saved-ticket mutation, phone/tablet layouts. Isolated synthetic provider contracts; not live sportsbook validation.')
finally:
 stop();log.close();shutil.rmtree(folder)
