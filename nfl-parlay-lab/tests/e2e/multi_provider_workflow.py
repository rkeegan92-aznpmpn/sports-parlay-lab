"""Issue 26 production/browser regression, isolated synthetic external sources; no real credits."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3018';calls=Path(folder+'/calls')
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'odds_e2e_q1','FANDUEL_API_KEY':'fd_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FANDUEL':'1','PARLAY_E2E_Q1':'1','PARLAY_E2E_Q1_ODDS':'1','PARLAY_E2E_MULTI':'1','PARLAY_E2E_CALL_LOG':str(calls),'NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def usage(provider):return sum(json.loads(line)['provider']==provider for line in calls.read_text().splitlines()) if calls.exists() else 0
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3018'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   break
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Multi-provider startup failed')
  time.sleep(.1)
 else:raise AssertionError('Multi-provider readiness timeout')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':800,'height':1280},timezone_id='America/Phoenix');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');q=page.get_by_role('region',name='Four-option multi-provider research',exact=True)
  expect(q.get_by_role('button',name='Refresh only fanduelapi',exact=True)).to_be_enabled();assert usage('fanduel')==0 and usage('odds-api')==0
  q.get_by_role('checkbox').check()
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as refreshed:q.get_by_role('button',name='Refresh only fanduelapi',exact=True).click()
  body=refreshed.value.json();assert refreshed.value.ok,body;assert len([s for s in body['options'] if s['ticket']])==4,body['options'];assert usage('fanduel')==2 and usage('odds-api')==0
  for label in ['Safer','Balanced','Aggressive','Long Shot']:expect(q.get_by_role('article',name=label+' research option',exact=True)).to_be_visible()
  q.get_by_role('button',name='Save Safer ticket',exact=True).click();expect(q.get_by_role('status')).to_contain_text('Safer saved')
  saved=page.request.get(base+'/api/saved').json();assert len(saved)==1,saved;assert saved[0]['purpose']=='test-research';original=saved[0]['legs_json'];assert all(l.get('quoteEvidence') for l in json.loads(original))
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as odds:q.get_by_role('button',name='Refresh only odds-api',exact=True).click()
  both=odds.value.json();assert odds.value.ok,both;assert {x['provider'] for x in both['quotes']}=={'fanduelapi','odds-api'};assert usage('odds-api')==3
  selector=q.get_by_role('combobox',name='Four-option game',exact=True);selector.select_option('2026_10_BUF_MIN')
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as single:q.get_by_role('button',name='Generate four options from independent caches',exact=True).click()
  assert all(s['ticket'] is None for s in single.value.json()['options']);expect(q).to_contain_text('maximum three picks per game')
  q.get_by_role('combobox',name='Four-option mode',exact=True).select_option('Q1')
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as quarter:q.get_by_role('button',name='Generate four options from independent caches',exact=True).click()
  triples=quarter.value.json();assert len([s for s in triples['options'] if s['ticket']])==4;assert all(l['gameId']=='2026_10_BUF_MIN' and l['quoteEvidence']['period']=='Q1' for s in triples['options'] for l in s['ticket']['legs'])
  with sqlite3.connect(folder+'/parlay.db') as db:
   key=db.execute("SELECT key FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone()[0];at=int(time.time()*1000)+1000
   db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':failure:'),json.dumps({'at':at,'status':429,'kind':'quota'}),at));db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':cooldown:'),json.dumps({'until':at+3600000,'status':429,'kind':'quota'}),at))
  recovery=page.request.post(base+'/api/research-options',data={'action':'refresh-provider','provider':'fanduelapi','period':'FULL','game':'ALL','testMode':True});assert recovery.status==207;independent=recovery.json();assert independent['refreshFailure']['httpStatus']==429;assert independent['quotes'] and all(x['provider']=='odds-api' for x in independent['quotes']);assert any(s['ticket'] for s in independent['options'])
  assert usage('fanduel')==2 and usage('odds-api')==3,'Cached analysis, mode/selection, and provider pause must not spend credits'
  invalid=page.request.post(base+'/api/research-options',data={'action':'refresh-provider','provider':'sportsdataio','period':'FULL','game':'ALL'});assert invalid.status==400
  page.reload(wait_until='networkidle');assert page.request.get(base+'/api/saved').json()[0]['legs_json']==original
  q=page.get_by_role('region',name='Four-option multi-provider research',exact=True);q.get_by_role('button',name='Generate four options from independent caches',exact=True).click();expect(q.get_by_role('article',name='Safer research option',exact=True)).to_be_visible(timeout=30000)
  q.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED MULTI-PROVIDER FIXTURES — NOT LIVE ODDS';el.prepend(p)}")
  images=app.parent/'docs/screenshots';images.mkdir(parents=True,exist_ok=True)
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});q.scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');page.screenshot(path=str(images/f'multi-provider-{label}.png'))
  assert not errors,errors;browser.close()
 print('PASS: independent explicit provider refresh/caches, four distinct FULL/Q1 options, exact sources/alternates, single-game six-pick block, selected Q1 game, saved TEST MODE persistence, 207 isolated provider pause with healthy-source tickets and zero retries, unavailable optional adapters, phone/tablet. Synthetic contract fixtures only; no live coverage claimed.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
