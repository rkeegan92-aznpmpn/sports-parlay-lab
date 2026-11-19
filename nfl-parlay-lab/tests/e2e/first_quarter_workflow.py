"""Issue #11: production routes/browser, isolated explicit provider fixtures only.
No real API credential or priced live market request. Existing six-pick workflow runs separately.
"""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3015';calls=Path(folder+'/calls.jsonl')
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'odds_e2e_q1','FANDUEL_API_KEY':'fd_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FANDUEL':'1','PARLAY_E2E_Q1':'1','PARLAY_E2E_Q1_ODDS':'1','PARLAY_E2E_CALL_LOG':str(calls),'NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def usage(provider):return sum(json.loads(line)['provider']==provider for line in calls.read_text().splitlines()) if calls.exists() else 0
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3015'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   break
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Q1 fixture server failed; inspect isolated test log')
  time.sleep(.1)
 else:raise AssertionError('Q1 server readiness timeout')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':800,'height':1280});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');q=page.get_by_role('region',name='First Quarter Parlays',exact=True)
  expect(q.get_by_role('heading',name='First Quarter Parlays',exact=True)).to_be_visible();expect(q.get_by_role('article',name='Best 1Q Triple',exact=True)).to_be_visible();expect(q.get_by_role('article',name='Aggressive 1Q Triple',exact=True)).to_be_visible()
  assert usage('fanduel')==0 and usage('odds-api')==0,'Page load must not spend either provider credits'
  q.get_by_role('combobox',name='Q1 slate',exact=True).select_option('all')
  # Existing board refresh endpoint, not a substitute Q1 feed.
  response=page.request.post(base+'/api/fanduel',data={'action':'refresh','testMode':True,'scope':'all'});assert response.ok,response.status
  assert len(response.json()['tickets'])==2,'Existing six-pick generation must remain available'
  assert usage('fanduel')==2 and usage('odds-api')==0
  with page.expect_response(lambda r:'/api/first-quarter?' in r.url and 'provider=fanduel' in r.url) as analysis:
   q.get_by_role('button',name='Generate 1Q Tickets from cache',exact=True).click()
  body=analysis.value.json();assert analysis.value.ok
  assert len(body['best']['options'][0]['legs'])==3 and len(body['aggressive']['options'][0]['legs'])==3
  assert {l['id'] for l in body['best']['options'][0]['legs']}!={l['id'] for l in body['aggressive']['options'][0]['legs']}
  for t in [body['best']['options'][0],body['aggressive']['options'][0]]:
   assert len({l['gameId'] for l in t['legs']})==1,'Single-game Q1 triples must work'
   assert all(l['market'].startswith('1Q ') and l['line']==20.5 and l['mean']==20 and l['sample']==6 and l['rosterVerified'] and l['providerDelaySeconds']==300 for l in t['legs'])
  assert usage('fanduel')==2 and usage('odds-api')==0,'Cached Q1 analysis must not spend odds requests'
  d=body['diagnostics'];assert all(p['evaluation']['maxAgeSeconds']==1800 and p['evaluation']['eligible'] for p in d['priceChecks']);assert d['rawQ1Rows']==3 and d['matchedGames']==1 and d['eligibleSideProps']==6 and d['eligiblePlayers']==3
  expect(q.get_by_role('region',name='Q1 diagnostics',exact=True)).to_contain_text('Raw Q1 markets: 3')
  q.get_by_text('Per-price freshness evidence (UTC)',exact=True).click()
  expect(q.get_by_role('region',name='Q1 diagnostics',exact=True)).to_contain_text('UTC observation:')
  expect(q.get_by_role('article',name='Best 1Q Triple',exact=True).get_by_text('QB One',exact=True)).to_be_visible()
  for width,height in [(800,1280),(412,915)]:
   page.set_viewport_size({'width':width,'height':height});assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  # Present Q1 rows with missing freshness proof must diagnose filtering, not absent coverage.
  with sqlite3.connect(folder+'/parlay.db') as db:
   rowkey,original=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();fault=json.loads(original)
   for prop in fault['props']:
    if prop['record'].get('period')=='q1':prop['meta']['sourceStatus']='unknown'
   db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(fault),rowkey))
  with page.expect_response(lambda r:'/api/first-quarter?' in r.url and 'provider=fanduel' in r.url) as filtered:
   q.get_by_role('button',name='Generate 1Q Tickets from cache',exact=True).click()
  rejected=filtered.value.json();assert rejected['diagnostics']['rawQ1Rows']==3 and rejected['diagnostics']['freshSidePrices']==0 and rejected['diagnostics']['eligibleSideProps']==0
  assert any(not c['passed'] and c['field']=='meta.source_status' for p in rejected['diagnostics']['priceChecks'] for c in p['evaluation']['checks'])
  assert any(r['stage']=='freshness' for r in rejected['diagnostics']['rejections']);assert rejected['status']=='unavailable'
  expect(q.get_by_role('region',name='Q1 diagnostics',exact=True)).to_contain_text('eligible props: 0')
  assert usage('fanduel')==2 and usage('odds-api')==0
  with sqlite3.connect(folder+'/parlay.db') as db:db.execute('UPDATE cache SET value=? WHERE key=?',(original,rowkey))
  # Explicit refresh shares the existing five-minute cache (no extra request).
  q.get_by_role('button',name='Fetch shared FanDuel board for Q1',exact=True).click();expect(q.get_by_role('article',name='Best 1Q Triple',exact=True).get_by_text('QB One',exact=True)).to_be_visible()
  assert usage('fanduel')==2
  # The optional legacy path works only after an explicit user action.
  q.locator('summary').filter(has_text='Optional Odds API Q1 access').click()
  q.get_by_role('button',name='Analyze optional Odds API Q1 markets',exact=True).click()
  expect(q.get_by_role('article',name='Best 1Q Triple',exact=True).get_by_text('3 fresh FanDuel first-quarter selections',exact=False)).to_be_visible()
  assert usage('odds-api')>0
  legacy=page.request.get(base+'/api/first-quarter?provider=odds-api').json();assert legacy['diagnostics']['eligiblePlayers']==1;assert legacy['playerPropsAvailable'] is True;assert all(c['market']=='1Q passing yards' for c in legacy['candidates']);assert not legacy['best']['options'] and not legacy['aggressive']['options']
  with sqlite3.connect(folder+'/parlay.db') as db:
   key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();snapshot=json.loads(value);snapshot['props']=[p for p in snapshot['props'] if p['record'].get('period')=='game'];db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(snapshot),key))
  before=(usage('fanduel'),usage('odds-api'))
  q.get_by_role('button',name='Generate 1Q Tickets from cache',exact=True).click()
  expect(q.get_by_text('Provider unsupported/unavailable:',exact=False)).to_be_visible()
  expect(q.get_by_role('article',name='Best 1Q Triple',exact=True).get_by_text('QB One',exact=True)).to_have_count(0)
  assert (usage('fanduel'),usage('odds-api'))==before,'Unsupported snapshot must not trigger a paid fallback'
  assert 'fd_e2e_fixture' not in page.content() and 'odds_e2e_q1' not in page.content();assert not errors,errors
  browser.close()
 with sqlite3.connect(folder+'/parlay.db') as db:
  assert db.execute('SELECT COUNT(*) FROM saved_tickets').fetchone()[0]==0
  assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
 print('PASS: visible default Q1 section and two distinct single-game triples, verified Q1 prices/history/availability, no full-game substitution, unsupported-state UI, no automatic paid fallback, shared-cache reuse with zero additional odds requests, raw/matched/eligible/freshness diagnostics, documented optional Odds API coverage limit, unchanged six-pick availability, no record creation, phone/tablet layouts. External providers use isolated contract fixtures; live coverage is not claimed.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
