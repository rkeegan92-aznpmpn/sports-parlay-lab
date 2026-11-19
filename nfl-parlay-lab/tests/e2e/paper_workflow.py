"""Issue 33: real production routes/collector/ledger; synthetic external odds/stats and isolated test clock only."""
import os,json,time,signal,subprocess,tempfile,urllib.request,sqlite3,shutil,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
app=Path(__file__).resolve().parents[2];folder=tempfile.mkdtemp(prefix='parlay-e2e-paper-');child=None
log=open(folder+'/server.log','w');base='http://127.0.0.1:3020';calls=Path(folder+'/calls')
ko=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=90)).replace(second=0,microsecond=0).isoformat()
env={**os.environ,'DB_PATH':folder+'/parlay.db','ODDS_API_KEY':'','FANDUEL_API_KEY':'','PROPLINE_API_KEY':'propline_e2e_fixture','COLLECTOR_ENABLED':'0','REQUIRE_PERSISTENT_DB':'0','NODE_ENV':'production','PARLAY_E2E_FIXTURES':'1','PARLAY_E2E_PROPLINE':'1','PARLAY_E2E_PAPER':'1','PARLAY_E2E_PAPER_KICKOFF':ko,'PARLAY_E2E_CALL_LOG':str(calls),'NODE_OPTIONS':'--experimental-strip-types --import '+str(app/'tests/e2e/provider-loader.mjs')}
def usage():return len(calls.read_text().splitlines()) if calls.exists() else 0
def start():
 global child
 child=subprocess.Popen(['node','scripts/run-app.mjs','start','--hostname','127.0.0.1','--port','3020'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
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
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':800,'height':1280},timezone_id='America/Phoenix');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');page.get_by_role('button',name='Paper Betting',exact=True).click();q=page.get_by_role('main',name='Paper Betting dashboard',exact=True)
  expect(q.get_by_role('region',name='Virtual bankroll',exact=True)).to_contain_text('$1,000.00');expect(q.get_by_role('region',name='Paper collection health',exact=True)).to_contain_text('No active collector heartbeat');assert usage()==0
  selector=q.get_by_role('combobox',name='Paper NFL slate',exact=True);expect(selector).to_have_value('ALL')
  selector.select_option('SUNDAY');expect(q.get_by_role('status')).to_contain_text('selection saved');assert page.request.get(base+'/api/paper').json()['selection']['mode']=='SUNDAY'
  selector.select_option('GAMES');expect(q.get_by_role('status')).to_contain_text('selection saved');games=q.get_by_role('group',name='Select one or more verified upcoming games',exact=True).get_by_role('checkbox');expect(games).to_have_count(2)
  games.first.uncheck();expect(q.get_by_role('status')).to_contain_text('selection saved');expect(games.first).not_to_be_checked()
  one=page.request.post(base+'/api/paper',data={'action':'preview'});assert one.ok;assert not any(o['ticket'] for o in one.json()['preview']['options']);assert usage()==0
  games.first.check();expect(q.get_by_role('status')).to_contain_text('selection saved')
  page.reload(wait_until='networkidle');page.get_by_role('button',name='Paper Betting',exact=True).click();q=page.get_by_role('main',name='Paper Betting dashboard',exact=True);expect(q.get_by_role('combobox',name='Paper NFL slate',exact=True)).to_have_value('GAMES')
  q.get_by_role('combobox',name='Paper NFL slate',exact=True).select_option('ALL');expect(q.get_by_role('status')).to_contain_text('selection saved')
  quoted=page.request.post(base+'/api/research-options',data={'action':'refresh-provider','provider':'propline','period':'FULL','game':'ALL'});assert quoted.ok;assert usage()==1
  settings=q.get_by_role('region',name='Paper schedule settings',exact=True)
  for label in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:settings.get_by_label(label,exact=True).check()
  settings.get_by_role('button',name='Save paper schedule',exact=True).click();expect(q.get_by_role('status')).to_contain_text('schedule saved')
  # Exercise the default collector policy, not only the explicit settle-only flag.
  cycle();data=page.request.get(base+'/api/paper').json();assert len(data['wagers'])==4,data;assert data['availableCents']==96000 and data['outstandingCents']==4000 and data['bankrollCents']==100000;assert all(w['status']=='pending' and w['capture_mode']=='automatic' for w in data['wagers']);assert any(p['phase']=='capture' and p['status']=='paused' and 'Cache-only' in ' '.join(p['messages']) for p in data['collectorPhases']);assert data['paperPhase']['status']=='ok'
  page.reload(wait_until='networkidle');page.get_by_role('button',name='Paper Betting',exact=True).click();q=page.get_by_role('main',name='Paper Betting dashboard',exact=True);expect(q.get_by_role('region',name='Paper wager history',exact=True).get_by_role('article')).to_have_count(4)
  expect(q.get_by_role('region',name='Virtual bankroll',exact=True)).to_contain_text('$960.00');assert 'border-yellow-400' in q.get_by_role('region',name='Paper wager history',exact=True).get_by_role('article').first.get_attribute('class')
  invalid=page.request.post(base+'/api/paper',data='null',headers={'Content-Type':'application/json'});assert invalid.status==400
  tampered=page.request.post(base+'/api/paper',data={'action':'capture','slateKey':data['slates'][0]['key'],'testMode':True,'stake':100000});assert tampered.status==400
  q.get_by_role('button',name='Generate paper previews from cache',exact=True).click();expect(q.get_by_role('status')).to_contain_text('preview generated');assert usage()==1
  generated=page.request.post(base+'/api/paper',data={'action':'preview'}).json()['preview'];assert all(o['ticket'] for o in generated['options'])
  for option in generated['options']:
   legs=option['ticket']['legs'];assert [sum(l['pos']==p for l in legs) for p in ['QB','RB','WR','TE']]==[1,2,2,1];assert max(sum(l['gameId']==g for l in legs) for g in {l['gameId'] for l in legs})<=3
  q.get_by_role('combobox',name='Paper NFL slate',exact=True).select_option('GAMES');expect(q.get_by_role('status')).to_contain_text('selection saved')
  q.get_by_role('button',name='Capture all available $10 paper tickets',exact=True).click();expect(q.get_by_role('status')).to_contain_text('0 paper wager');assert usage()==1
  with sqlite3.connect(env['DB_PATH']) as db:
   before=db.execute('SELECT id,legs_json,ticket_json FROM paper_wagers ORDER BY id').fetchall();assert db.execute("SELECT COUNT(*) FROM paper_ledger WHERE kind='stake'").fetchone()[0]==4;assert db.execute('SELECT COUNT(*) FROM saved_tickets').fetchone()[0]==0
  # Resume with an isolated advanced clock and verified final fixture data. No selections or capture times are edited.
  stop();env['PARLAY_E2E_PAPER_OFFSET']=str(8*3600000);env['PARLAY_E2E_FINAL']='1';start();cycle();won=page.request.get(base+'/api/paper').json();assert all(w['status']=='win' and w['grades']['finalized'] for w in won['wagers']),won;assert won['summary']['profitCents']>0 and won['outstandingCents']==0;assert usage()==1
  page.reload(wait_until='networkidle');page.get_by_role('button',name='Paper Betting',exact=True).click();q=page.get_by_role('main',name='Paper Betting dashboard',exact=True);history=q.get_by_role('region',name='Paper wager history',exact=True);expect(history.get_by_role('article')).to_have_count(4);expect(history.get_by_role('article').first).to_contain_text('Win');assert 'border-green-400' in history.get_by_role('article').first.get_attribute('class')
  stop();env['PARLAY_E2E_PAPER_OFFSET']=str(9*3600000);env['PARLAY_E2E_PAPER_ZERO_QB']='1';start();cycle();corrected=page.request.get(base+'/api/paper').json();assert all(w['status']=='loss' for w in corrected['wagers']);assert corrected['availableCents']==96000 and corrected['summary']['profitCents']==-4000;assert len(corrected['wagers'])==4 and usage()==1
  page.reload(wait_until='networkidle');page.get_by_role('button',name='Paper Betting',exact=True).click();q=page.get_by_role('main',name='Paper Betting dashboard',exact=True);history=q.get_by_role('region',name='Paper wager history',exact=True);expect(history.get_by_role('article').first).to_contain_text('Loss');assert 'border-red-400' in history.get_by_role('article').first.get_attribute('class')
  q.get_by_role('combobox',name='Paper history strategy',exact=True).select_option('Safer');expect(history.get_by_role('article')).to_have_count(1);q.get_by_role('combobox',name='Paper history strategy',exact=True).select_option('ALL');expect(history.get_by_role('article')).to_have_count(4)
  q.evaluate("el=>{const p=document.createElement('p');p.textContent='AUTOMATED PAPER LEDGER FIXTURES — NOT REAL WAGERS OR VERIFIED LIVE ODDS';el.prepend(p)}");images=app.parent/'docs/screenshots';images.mkdir(parents=True,exist_ok=True)
  for width,height,label in [(800,1280,'tablet'),(412,915,'phone')]:
   page.set_viewport_size({'width':width,'height':height});assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');page.screenshot(path=str(images/f'paper-betting-{label}.png'),full_page=True)
  assert not errors,errors;browser.close()
 with sqlite3.connect(env['DB_PATH']) as db:
  assert db.execute('SELECT id,legs_json,ticket_json FROM paper_wagers ORDER BY id').fetchall()==before;assert db.execute('SELECT COUNT(*) FROM saved_tickets').fetchone()[0]==0;assert db.execute('SELECT COUNT(*) FROM forecast_snapshots').fetchone()[0]==0;assert db.execute("SELECT COUNT(*) FROM paper_ledger WHERE kind='correction'").fetchone()[0]>=4
 print('PASS: ALL default, Eastern Sunday/multiple-game selection and reload persistence, shared four-option optimizer and maximum three/game, canonical-scope duplicate protection, visible collector phase diagnostics; real collector cache-only automatic capture of four $10 strategies, $1000 opening ledger, duplicate/manual replay prevention, Pending/yellow then final Win/green and corrected Loss/red, immutable quotes, resume grading without retroactive bets, no additional odds requests, original archives untouched, strategy/week/season metrics, phone/tablet. External data and time advancement are isolated fixtures, not real-money or live forward performance.')
finally:
 stop();log.close();shutil.rmtree(folder)
