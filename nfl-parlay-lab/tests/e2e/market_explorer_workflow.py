"""Market explorer production routes/browser. All external odds are isolated synthetic contracts."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3016'
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'fd_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_FANDUEL':'1','PARLAY_E2E_Q1':'1','PARLAY_E2E_SUNDAY':'1','PARLAY_E2E_EXPANDED':'1','PARLAY_E2E_NULL_TEAMS':'1','PARLAY_E2E_CALL_LOG':folder+'/calls','NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
try:
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3016'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(150):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   break
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Market fixture server failed')
  time.sleep(.1)
 else:raise AssertionError('Market fixture readiness timeout')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':800,'height':1280});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  r=page.request.post(base+'/api/fanduel',data={'action':'refresh','testMode':True});assert r.ok,r.text()
  result=page.request.post(base+'/api/markets',data={'action':'analyze'}).json()
  assert any(r['line']==25 and r['side']=='AtLeast' and r['odds']==-110 for r in result['rows'])
  assert any(r['period']=='q2' and r['analysis'] is None for r in result['rows'])
  assert any(r['stat']=='provider_unknown' and r['market'] is None for r in result['rows'])
  assert len(result['full']['best']['options'][0]['legs'])==6 and len(result['full']['aggr']['options'][0]['legs'])==6
  assert len(result['quarter']['best']['options'][0]['legs'])==3 and len(result['quarter']['aggressive']['options'][0]['legs'])==3
  event=result['games'][0]['id'];stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
  quote={'eventId':event,'player':'QB One','team':'BUF','period':'q2','stat':'passing_yards','side':'AtLeast','line':75,'odds':150,'observedAt':stamp,'confirmed':True}
  assert page.request.post(base+'/api/markets',data={'action':'manual','quote':{**quote,'team':'KC'}}).status==400
  page.goto(base,wait_until='networkidle');explorer=page.get_by_role('region',name='Player prop market explorer',exact=True)
  explorer.get_by_role('button',name='Discover cached markets and analyze',exact=True).click();expect(explorer).to_contain_text('PARTIAL',timeout=30000)
  expect(explorer.get_by_role('region',name='Six-pick eligibility diagnostics',exact=True)).to_contain_text('verified players')
  expect(explorer.get_by_role('heading',name='QB One — QB | Team: BUF',exact=True).first).to_be_visible()
  expect(explorer.get_by_role('heading',name='No Such Player — Roster check needed',exact=True).first).to_be_attached()
  explorer.get_by_role('combobox',name='Market filter period',exact=True).select_option('q2');expect(explorer).to_contain_text('period-specific history is required')
  explorer.get_by_role('combobox',name='Market filter period',exact=True).select_option('');explorer.get_by_role('combobox',name='Market filter line',exact=True).select_option('25');expect(explorer).to_contain_text('25+')
  explorer.locator('summary').filter(has_text='Enter an actual FanDuel observation').click();form=explorer.locator('form').first
  form.locator('select[name="eventId"]').select_option(event)
  for k,v in [('player','QB One'),('team','BUF'),('stat','passing_yards'),('line','75'),('odds','150'),('observedAt',datetime.datetime.now().strftime('%Y-%m-%dT%H:%M'))]:form.locator(f'input[name="{k}"]').fill(v)
  form.locator('select[name="period"]').select_option('q2');form.locator('select[name="side"]').select_option('AtLeast');form.locator('input[name="confirmed"]').check();form.get_by_role('button',name='Save observed market',exact=True).click();expect(explorer.get_by_role('status')).to_contain_text('Manual observation saved separately')
  explorer.get_by_role('combobox',name='Market filter line',exact=True).select_option('')
  explorer.get_by_role('button',name='Discover cached markets and analyze',exact=True).click();expect(explorer).to_contain_text('MANUALLY OBSERVED BY USER')
  explorer.get_by_role('combobox',name='Market filter line',exact=True).select_option('');explorer.get_by_role('combobox',name='Market filter period',exact=True).select_option('q2');expect(explorer).to_contain_text('75+')
  # Screenshots are explicitly labeled synthetic, never represented as live sportsbook evidence.
  explorer.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED TEST FIXTURES — NOT LIVE FANDUEL MARKETS';el.prepend(p)}")
  screenshots=app.parent/'docs/screenshots';screenshots.mkdir(parents=True,exist_ok=True)
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});explorer.scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');page.screenshot(path=str(screenshots/f'market-explorer-{label}.png'))
  card=explorer.get_by_role('article').first
  card.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED TEST FIXTURE — NOT LIVE ODDS';el.prepend(p)}")
  card.screenshot(path=str(screenshots/'explorer-verified-player.png'))
  page.reload(wait_until='networkidle');again=page.request.post(base+'/api/markets',data={'action':'analyze'}).json();assert any(r['source']=='manual' and r['period']=='q2' and r['line']==75 for r in again['rows'])
  with sqlite3.connect(folder+'/parlay.db') as db:
   key,value=db.execute("SELECT key,value FROM cache WHERE key LIKE 'fanduel-rest:board:%'").fetchone();cached=json.loads(value);old=datetime.datetime.fromtimestamp(time.time()-10800,datetime.timezone.utc).isoformat()
   for prop in cached['props']:prop['record']['observed_at']=old;prop['meta']['asOf']=old;prop['meta']['observedAt']=old
   db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(cached),key))
   db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':failure:'),json.dumps({'at':int(time.time()*1000)}),int(time.time()*1000)))
   db.execute('INSERT OR REPLACE INTO cache(key,value,fetched_at) VALUES(?,?,?)',(key.replace(':board:',':cooldown:'),json.dumps({'status':429,'until':int(time.time()*1000)+3600000}),int(time.time()*1000)))
  blocked=page.request.post(base+'/api/markets',data={'action':'analyze'}).json()
  assert blocked['providerAccess']['httpStatus']==429 and blocked['providerAccess']['paused']
  assert blocked['summary']['best']['players']==0 and blocked['summary']['aggressive']['players']==0
  assert next(s for s in blocked['summary']['stages'] if s['stage']=='roster')['passingProps']>0
  assert next(s for s in blocked['summary']['stages'] if s['stage']=='freshness')['passingProps']==0
  assert any(r['roster']['verified'] and r['audit']['reportedTeam'] is None for r in blocked['rows'] if r['source']=='independent-api')
  assert len(Path(folder+'/calls').read_text().splitlines())==2,'No odds requests after original shared board'
  with sqlite3.connect(folder+'/parlay.db') as db:
   assert db.execute('SELECT COUNT(*) FROM discovered_manual_props').fetchone()[0]==1
   assert db.execute('SELECT COUNT(*) FROM saved_tickets').fetchone()[0]==0
   assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0
  assert not errors,errors;browser.close()
 print('PASS: expanded cached inventory, threshold/unknown/missing-analysis handling, two distinct six-leg and Q1 research options, seven filters, manual period/threshold entry and reload persistence, mismatch rejection, zero extra odds calls, phone/tablet screenshots and layouts. Synthetic external contracts only.')
finally:
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 log.close();shutil.rmtree(folder)
