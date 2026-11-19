"""One-touch live save + virtual capture, real production routes/storage; synthetic external odds/stats and isolated test clock only."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-one-touch-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3021';calls=Path(folder+'/calls')
ko=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=90)).replace(second=0,microsecond=0).isoformat()
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'','PROPLINE_API_KEY':'propline_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_PROPLINE':'1','PARLAY_E2E_PAPER':'1','PARLAY_E2E_BATCH_DELAY':'1','PARLAY_E2E_PAPER_KICKOFF':ko,'PARLAY_E2E_CALL_LOG':str(calls),'NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def usage():return len(calls.read_text().splitlines()) if calls.exists() else 0
def start():
 global child
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3021'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(200):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=1) as r:assert json.load(r)['database']=='ready'
   return
  except Exception:pass
  if child.poll() is not None:raise AssertionError('Paper server startup failed')
  time.sleep(.1)
 raise AssertionError('Paper server readiness timeout')
def stop():
 global child
 if child and child.poll() is None:child.send_signal(signal.SIGTERM);child.wait(timeout=10)
 child=None
def cycle():
 r=subprocess.run(['node','--experimental-strip-types','scripts/track-forecasts.ts'],cwd=app,env=env,capture_output=True,text=True,timeout=90)
 assert r.returncode==0,'Paper collector cycle failed: '+r.stderr[-800:]
try:
 start()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':800,'height':1280},timezone_id='America/Denver');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');page.get_by_role('button',name='Live API workspace (requires credits)',exact=True).click();q=page.get_by_role('region',name='Four-option multi-provider research',exact=True)
  button=q.get_by_role('button',name='Generate & Save All 4 Pick 6 Tickets',exact=True);expect(button).to_be_enabled();assert usage()==0
  button.click();expect(q.get_by_role('status')).to_contain_text('Refreshing only PropLine');expect(button).to_be_disabled();expect(q.get_by_role('status')).to_contain_text('4 of 4 strategies saved',timeout=30000);assert usage()==1
  expect(q.get_by_role('combobox',name='Four-option game',exact=True)).to_have_value('ALL')
  for strategy in ['Safer','Balanced','Aggressive','Long Shot']:
   article=q.get_by_role('article',name=strategy+' research option',exact=True);expect(article).to_contain_text('Theoretical product');expect(q).to_contain_text(strategy+': Saved as ticket #')
  saved=page.request.get(base+'/api/saved').json();assert len(saved)==4;assert {s['strategy'] for s in saved}=={'Safer','Balanced','Aggressive','Long Shot'};assert all(s['purpose']=='pregame-research' and len(s['legs'])==6 for s in saved)
  before=[(s['id'],s['legs_json']) for s in saved]
  button.click();expect(q.get_by_role('status')).to_contain_text('0 new, 4 already recorded',timeout=30000);assert usage()==1;assert len(page.request.get(base+'/api/saved').json())==4
  images=app.parent/'docs/screenshots';images.mkdir(parents=True,exist_ok=True)
  q.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED ONE-TOUCH FIXTURES — NOT VERIFIED LIVE ODDS OR REAL WAGERS';el.prepend(p)}")
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});q.scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');q.screenshot(path=str(images/f'one-touch-live-{label}.png'))
  page.get_by_role('button',name='Paper Betting',exact=True).click();paper=page.get_by_role('main',name='Paper Betting dashboard',exact=True);capture=paper.get_by_role('button',name='Generate & Capture All 4',exact=True)
  capture.click();expect(paper.get_by_role('status')).to_contain_text('4 of 4 strategies captured',timeout=30000);assert usage()==1;data=page.request.get(base+'/api/paper').json();assert data['availableCents']==96000 and data['outstandingCents']==4000;assert len(data['wagers'])==4;assert all(w['stake_cents']==1000 and w['status']=='pending' for w in data['wagers']);assert data['summary']['profitCents']==0
  expect(paper.get_by_role('region',name='Manual paper fallback',exact=True).get_by_role('heading',name='Safer',exact=True)).to_be_visible()
  capture.click();expect(paper.get_by_role('status')).to_contain_text('0 new, 4 already recorded',timeout=30000);assert usage()==1;assert page.request.get(base+'/api/paper').json()['availableCents']==96000
  paper.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED ONE-TOUCH PAPER FIXTURES — VIRTUAL FUNDS ONLY';el.prepend(p)}")
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');page.screenshot(path=str(images/f'one-touch-paper-{label}.png'),full_page=True)
  page.reload(wait_until='networkidle');page.get_by_role('button',name='Paper Betting',exact=True).click();paper=page.get_by_role('main',name='Paper Betting dashboard',exact=True);expect(paper.get_by_role('region',name='Paper wager history',exact=True).get_by_role('article')).to_have_count(4)
  # The known four-capture set must not refresh even when the provider request cache expires.
  with sqlite3.connect(env['DB_PATH']) as db:
   row=db.execute("SELECT key,value FROM cache WHERE key LIKE 'propline:v1:snapshot:%:FULL:ALL'").fetchone();snapshot=json.loads(row[1]);snapshot['at']-=360000;db.execute('UPDATE cache SET value=? WHERE key=?',(json.dumps(snapshot),row[0]))
  paper.get_by_role('button',name='Generate & Capture All 4',exact=True).click();expect(paper.get_by_role('status')).to_contain_text('0 new, 4 already recorded',timeout=30000);assert usage()==1
  paper.get_by_role('combobox',name='Paper NFL slate',exact=True).select_option('GAMES');expect(paper.get_by_role('status')).to_contain_text('selection saved')
  paper.get_by_role('group',name='Select one or more verified upcoming games',exact=True).get_by_role('checkbox').first.uncheck();expect(paper.get_by_role('status')).to_contain_text('selection saved')
  paper.get_by_role('button',name='Generate & Capture All 4',exact=True).click();expect(paper.get_by_role('alert')).to_contain_text('at least two selected upcoming games',timeout=30000);assert usage()==1
  paper.get_by_role('combobox',name='Paper NFL slate',exact=True).select_option('ALL');expect(paper.get_by_role('status')).to_contain_text('selection saved')
  # Tampered client quotes/stakes cannot enter the one-touch endpoint.
  for body in [{'target':'paper','testMode':True},{'target':'paper','stake':100000},{'target':'live','provider':'odds-api'}]:assert page.request.post(base+'/api/pick6-batch',data=body).status==400
  # A known active provider cooldown is honored locally; no retry and no stale replacement tickets.
  with sqlite3.connect(env['DB_PATH']) as db:
   fingerprint=db.execute("SELECT key FROM cache WHERE key LIKE 'propline:v1:snapshot:%'").fetchone()[0].split(':')[3];at=int(time.time()*1000);db.execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(f'propline:cooldown:{fingerprint}',json.dumps({'until':at+3600000,'status':429,'code':'daily_limit_exceeded'}),at))
  paper.get_by_role('button',name='Generate & Capture All 4',exact=True).click();expect(paper.get_by_role('status')).to_contain_text('0 new, 4 already recorded',timeout=30000);assert usage()==1;assert page.request.get(base+'/api/paper').json()['availableCents']==96000
  page.get_by_role('button',name='Live API workspace (requires credits)',exact=True).click();q=page.get_by_role('region',name='Four-option multi-provider research',exact=True);q.get_by_role('button',name='Generate & Save All 4 Pick 6 Tickets',exact=True).click();expect(q.get_by_role('alert')).to_contain_text('paused until',timeout=30000);assert usage()==1
  assert [(s['id'],s['legs_json']) for s in page.request.get(base+'/api/saved').json()]==before
  assert not errors,errors;browser.close()
 # Restart proves both histories survive process exit; final fixtures verify unchanged grading pipeline.
 stop();env['PARLAY_E2E_PAPER_OFFSET']=str(8*3600000);env['PARLAY_E2E_FINAL']='1';start();cycle()
 with urllib.request.urlopen(base+'/api/paper') as r:data=json.load(r);assert len(data['wagers'])==4 and all(w['status']=='win' for w in data['wagers'])
 with urllib.request.urlopen(base+'/api/grades') as r:grades=json.load(r);assert len(grades)==4 and all(g['status']=='win' for g in grades.values())
 assert usage()==1
 print('PASS: streamed one-touch progress; four live research saves plus four $10 paper captures from one shared PropLine fixture request, parallel/repeated-save protections, explicit failure/cooldown and tamper handling, labeled strategy history across reload/restart, verified final-fixture grading, Samsung-sized phone/tablet layouts. No real provider credentials, live coverage or sportsbook wagers claimed.')
finally:
 stop();log.close();shutil.rmtree(folder)
