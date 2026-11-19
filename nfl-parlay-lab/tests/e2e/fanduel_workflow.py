"""Production FanDuel REST/UI integration with isolated documented-contract fixtures.
Not proof of authenticated live provider access. Never uses a real credential or user DB.
"""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3013'
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'fd_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FANDUEL':'1','NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def start():
 global child
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3013'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   return
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Fixture production server failed; inspect local test log')
  time.sleep(.1)
 raise AssertionError('Fixture production server readiness timeout')
def stop():
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
try:
 start()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':412,'height':915});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');panel=page.get_by_role('region',name='FanDuel API research',exact=True)
  with sqlite3.connect(folder+'/parlay.db') as db:assert db.execute("SELECT COUNT(*) FROM cache WHERE key LIKE 'fanduel-rest:%'").fetchone()[0]==0,'Page loads must not consume REST quota'
  panel.get_by_role('combobox',name='Full-game slate',exact=True).select_option('all')
  panel.get_by_role('checkbox',name='TEST MODE',exact=False).check()
  panel.get_by_role('button',name='Fetch NFL events and props',exact=True).click()
  one=panel.get_by_role('article',name='API Aggressive option 1',exact=True);two=panel.get_by_role('article',name='API Aggressive option 2',exact=True)
  expect(one).to_be_visible(timeout=30000);expect(two).to_be_visible()
  with page.expect_response(lambda r:'/api/fanduel' in r.url and r.request.method=='POST') as response:
   panel.get_by_role('button',name='Generate Two Aggressive Options from cache',exact=True).click()
  data=response.value.json();assert len(data['tickets'])==2
  for t in data['tickets']:
   assert len(t['legs'])==6
   assert {pos:sum(l['pos']==pos for l in t['legs']) for pos in ['QB','RB','WR','TE']}=={'QB':1,'RB':2,'WR':2,'TE':1}
   assert t['purpose']=='test-research';assert all(l['providerDelaySeconds']==300 for l in t['legs'])
   assert max(sum(l['gameId']==g for l in t['legs']) for g in {l['gameId'] for l in t['legs']})<=3
  assert {l['id'] for l in data['tickets'][0]['legs']}!={l['id'] for l in data['tickets'][1]['legs']}
  assert 'fd_e2e_fixture' not in json.dumps(data)
  for i in [1,2]:
   panel.get_by_role('button',name=f'Save aggressive option {i}',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('saved as ticket')
  history=page.get_by_role('region',name='Research saved history',exact=True);expect(history.locator('details')).to_have_count(2)
  for width,height in [(412,915),(800,1280)]:
   page.set_viewport_size({'width':width,'height':height});assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  page.reload(wait_until='networkidle');expect(history.locator('details')).to_have_count(2);assert not errors,errors
  browser.close()
 with sqlite3.connect(folder+'/parlay.db') as db:
  before=db.execute('SELECT * FROM saved_tickets ORDER BY id').fetchall();assert len(before)==2
  assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
  key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone()
  board=json.loads(value);board['fetchedAt']=int(time.time()*1000)-301000
  db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(board),key))
 stop();env['PARLAY_E2E_FANDUEL_FAIL']='1';start()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':800,'height':1280});page.goto(base,wait_until='networkidle');panel=page.get_by_role('region',name='FanDuel API research',exact=True)
  panel.get_by_role('button',name='Fetch NFL events and props',exact=True).click();expect(panel.get_by_role('alert')).to_contain_text('monthly quota exhausted')
  assert 'sensitive-provider-message' not in page.content()
  panel.get_by_role('button',name='Generate Two Aggressive Options from cache',exact=True).click();expect(panel.get_by_role('alert')).to_contain_text('newer provider failure')
  expect(page.get_by_role('region',name='Research saved history',exact=True).locator('details')).to_have_count(2);browser.close()
 with sqlite3.connect(folder+'/parlay.db') as db:assert db.execute('SELECT * FROM saved_tickets ORDER BY id').fetchall()==before
 print('PASS: authenticated REST contract fixtures through production routes/UI, two distinct aggressive 1QB/2RB/2WR/1TE tickets, five-minute delay/provenance, TEST MODE, save both, shared history and reload/restart persistence, rate/quota failure blocking stale cache reuse, no secret response, no calibration promotion, phone/tablet. Live provider credentials not verified.')
finally:
 stop();log.close();shutil.rmtree(folder)
