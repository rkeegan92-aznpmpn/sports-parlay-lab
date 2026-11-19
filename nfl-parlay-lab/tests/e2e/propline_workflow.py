"""Issue 29: third independent provider; production app + explicit contract fixtures, no real key/credits."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3019';calls=Path(folder+'/calls')
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'','PROPLINE_API_KEY':'propline_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_PROPLINE':'1','PARLAY_E2E_Q1_EMPTY_BULK':'1','PARLAY_E2E_Q1':'1','PARLAY_E2E_SUNDAY':'1','PARLAY_E2E_CALL_LOG':str(calls),'NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def usage():return len(calls.read_text().splitlines()) if calls.exists() else 0
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3019'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   break
  except Exception:pass
  if child.poll() is not None:raise AssertionError('PropLine startup failed')
  time.sleep(.1)
 else:raise AssertionError('PropLine readiness timeout')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':800,'height':1280},timezone_id='America/Phoenix');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');q=page.get_by_role('region',name='Four-option multi-provider research',exact=True);refresh=q.get_by_role('button',name='Refresh only propline',exact=True)
  expect(refresh).to_be_enabled();assert usage()==0;q.get_by_role('checkbox').check()
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as full:refresh.click()
  body=full.value.json();assert full.value.ok,body;assert len([s for s in body['options'] if s['ticket']])==4,body;assert usage()==1;assert all(x['provider']=='propline' and x['period']=='FULL' for x in body['quotes']);expect(q).to_contain_text('999 remaining / 1000 daily')
  q.get_by_role('button',name='Save Safer ticket',exact=True).click();expect(q.get_by_role('status')).to_contain_text('Safer saved');saved=page.request.get(base+'/api/saved').json();assert len(saved)==1 and saved[0]['purpose']=='test-research';archive=saved[0]['legs_json'];assert all(l['quoteEvidence']['provider']=='propline' for l in json.loads(archive))
  q.get_by_role('combobox',name='Four-option game',exact=True).select_option('2026_10_BUF_MIN')
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as single:q.get_by_role('button',name='Generate four options from independent caches',exact=True).click()
  assert all(s['ticket'] is None for s in single.value.json()['options']);assert usage()==1
  q.get_by_role('combobox',name='Four-option mode',exact=True).select_option('Q1')
  q.get_by_role('combobox',name='Four-option game',exact=True).select_option('ALL')
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as empty:refresh.click()
  empty_data=empty.value.json();assert usage()==2;assert empty_data['propLineDiagnostics']['status']=='provider-returned-no-events-under-filters';assert all(s['ticket'] is None for s in empty_data['options'])
  diagnostics=q.get_by_role('region',name='PropLine Q1 diagnostics',exact=True);expect(diagnostics).to_contain_text('Raw events: 0')
  q.get_by_role('combobox',name='Four-option game',exact=True).select_option('2026_10_BUF_MIN')
  q.get_by_role('button',name='Inspect PropLine Q1 cache (no provider request)',exact=True).click();expect(diagnostics).to_contain_text('Using an ALL-games cache');assert usage()==2
  with page.expect_response(lambda r:'/api/research-options' in r.url and r.request.method=='POST') as quarter:refresh.click()
  data=quarter.value.json();assert quarter.value.ok,data;assert data['propLineDiagnostics']['request']['endpoint']=='selected';assert data['propLineDiagnostics']['rawCounts']['events']==1;assert data['propLineDiagnostics']['rawCounts']['supportedPlayerOutcomes']>0;assert len([s for s in data['options'] if s['ticket']])==4;assert usage()==4
  audit=page.request.get(base+'/api/research-options?proplineDiagnostics=1&period=Q1&game=2026_10_BUF_MIN').json();assert audit['providerRequests']==0 and audit['diagnostics']['rawEvidenceAvailable'];assert audit['diagnostics']['request']['periodParameter']=='q1';assert usage()==4
  assert all(l['quoteEvidence']['provider']=='propline' and l['quoteEvidence']['period']=='Q1' and l['gameId']=='2026_10_BUF_MIN' for s in data['options'] for l in s['ticket']['legs'])
  q.locator('details').last.locator('summary').click();q.get_by_role('combobox',name='Comparison provider',exact=True).select_option('propline');expect(q).to_contain_text('last offered');expect(q).to_contain_text('not verified directly at FanDuel');q.locator('details').last.locator('summary').click()
  q.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED PROPLINE CONTRACT FIXTURES — NOT LIVE ODDS';el.prepend(p)}");images=app.parent/'docs/screenshots';images.mkdir(parents=True,exist_ok=True)
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});q.scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');q.screenshot(path=str(images/f'propline-{label}.png'))
  with sqlite3.connect(folder+'/parlay.db') as db:
   key=db.execute("SELECT key FROM cache WHERE key LIKE 'propline:v1:snapshot:%'").fetchone()[0];fingerprint=key.split(':')[3];at=int(time.time()*1000)+1000
   db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(f'propline:failure:{fingerprint}:Q1',json.dumps({'at':at,'status':429,'code':'daily_limit_exceeded'}),at));db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(f'propline:cooldown:{fingerprint}',json.dumps({'until':at+3600000,'status':429,'code':'daily_limit_exceeded'}),at))
  q.get_by_role('button',name='Generate four options from independent caches',exact=True).click();expect(refresh).to_be_disabled();expect(q).to_contain_text('daily_limit_exceeded');assert usage()==4
  response=page.request.post(base+'/api/research-options',data={'action':'refresh-provider','provider':'propline','period':'Q1','game':'2026_10_BUF_MIN'});assert response.status==207;assert response.json()['refreshFailure']['httpStatus']==429;assert usage()==4
  page.reload(wait_until='networkidle');assert page.request.get(base+'/api/saved').json()[0]['legs_json']==archive;assert usage()==4;assert not errors,errors;browser.close()
 print('PASS: PropLine third-provider explicit header-auth contract; one-call bulk and bounded selected-game Q1; four FULL/Q1 options; exact source/period/freshness labels, TEST MODE save/reload persistence, single-game FULL block, empty ALL Q1 cache vs targeted response counters, cache-only diagnostics, quota pause without retry, cached generation, phone/tablet. Synthetic external fixtures only; no live key/access verified.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
