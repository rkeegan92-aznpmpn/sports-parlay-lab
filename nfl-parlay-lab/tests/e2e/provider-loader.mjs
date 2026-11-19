import {nextSundayDate,nflDate} from '../../src/lib/sundayWindow.ts';
import {quarterCsv} from '../quarterFixtures.ts';
import {appendFileSync} from 'node:fs';
// Explicit test-only external-provider fixtures. Never import from application code.
import {fetcher,players,finishFixtureGames} from '../manualFixtures.ts';
import {gunzipSync,gzipSync} from 'node:zlib';
if(process.env.PARLAY_E2E_FIXTURES!=='1'||!process.env.DB_PATH?.includes('parlay-e2e-')||(process.env.ODDS_API_KEY?.trim()&&!(process.env.PARLAY_E2E_Q1_ODDS==='1'&&process.env.ODDS_API_KEY==='odds_e2e_q1')))throw new Error('Provider fixtures require an isolated E2E database and no odds credential.');
const original=globalThis.fetch;
if(process.env.PARLAY_E2E_PAPER==='1'&&process.env.PARLAY_E2E_PAPER_OFFSET){const realNow=Date.now.bind(Date),offset=Number(process.env.PARLAY_E2E_PAPER_OFFSET);if(!Number.isFinite(offset)||offset<0||offset>86400000)throw new Error('Invalid isolated paper clock');Date.now=()=>realNow()+offset;}
const paperKickoff=process.env.PARLAY_E2E_PAPER==='1'?process.env.PARLAY_E2E_PAPER_KICKOFF:null;
if(process.env.PARLAY_E2E_PAPER==='1'&&(!paperKickoff||!Number.isFinite(Date.parse(paperKickoff))))throw new Error('Paper fixture requires a fixed synthetic kickoff');
if(process.env.PARLAY_E2E_FINAL==='1')finishFixtureGames();
const day=paperKickoff?nflDate(paperKickoff):process.env.PARLAY_E2E_SUNDAY==='1'?nextSundayDate():new Date(Date.now()+(process.env.PARLAY_E2E_FINAL==='1'?-7:3)*864e5).toISOString().slice(0,10);
const fixtureKickoff=paperKickoff??day+'T18:00:00Z';
const matrixDates=()=>[-3,-1,1].map(offset=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);while(Date.parse(d.toISOString().slice(0,10)+'T18:00:00Z')<=Date.now())d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);});
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 const recordCall=(provider)=>{if(process.env.PARLAY_E2E_CALL_LOG?.startsWith('/tmp/parlay-e2e-'))appendFileSync(process.env.PARLAY_E2E_CALL_LOG,JSON.stringify({provider,path:new URL(url).pathname})+'\n');};
 if(url.includes('play_by_play_')&&process.env.PARLAY_E2E_Q1==='1')return new Response(quarterCsv(url.includes('2026')?2026:2025));
 if(url.startsWith('https://api.prop-line.com/')){
  if(process.env.PARLAY_E2E_PROPLINE!=='1'||process.env.PROPLINE_API_KEY!=='propline_e2e_fixture')throw new Error('PropLine requests forbidden without isolated explicit fixtures');
  if(new Headers(init?.headers).get('X-API-Key')!=='propline_e2e_fixture'||new URL(url).searchParams.has('apiKey'))throw new Error('PropLine authentication contract mismatch');
  recordCall('propline');if(process.env.PARLAY_E2E_BATCH_DELAY==='1')await new Promise(resolve=>setTimeout(resolve,1500));const stamp=new Date(Date.now()-300000).toISOString(),headers={'X-Daily-Limit':'1000','X-Daily-Used':'1','X-Daily-Remaining':'999','X-Daily-Reset':String(Math.floor((Date.now()+86400000)/1000))};
  const events=[{id:'101',sport_key:'football_nfl',commence_time:fixtureKickoff,home_team:'Minnesota Vikings',away_team:'Buffalo Bills',live:false},{id:'102',sport_key:'football_nfl',commence_time:fixtureKickoff,home_team:'Seattle Seahawks',away_team:'Los Angeles Rams',live:false}];
  if(new URL(url).pathname.endsWith('/events'))return Response.json(events,{headers});
  const quarter=new URL(url).searchParams.get('period')==='q1';const body=e=>({...e,bookmakers:[{key:'fanduel',title:'FanDuel',markets:players.filter(p=>(p[5]==='g1'?'101':'102')===e.id).flatMap(p=>[null,40.5,45.5,55.5].map((line,i)=>({key:p[4],period:quarter?'q1':null,line_type:i?'alternate':'main',last_update:stamp,suspended_at:null,outcomes:[{name:'Over',description:p[0],point:quarter?(i?5.5+(i-1)*3:20.5):line??50.5,price:i===0&&p[0]==='RB Aggressive'?190:[-110,-105,-100,105][i],last_seen_at:stamp,last_change_at:stamp},{name:'Under',description:p[0],point:quarter?(i?5.5+(i-1)*3:20.5):line??50.5,price:-110,last_seen_at:stamp,last_change_at:stamp}]})))}]});
  if(new URL(url).pathname==='/v1/sports/football_nfl/odds')return Response.json(quarter&&process.env.PARLAY_E2E_Q1_EMPTY_BULK==='1'?[]:events.map(body),{headers});
  return Response.json(body(events.find(e=>new URL(url).pathname.includes('/'+e.id+'/'))??events[0]),{headers});
 }
 if(url.startsWith('https://fanduelapi.com/')) {
  recordCall('fanduel');
  if(process.env.PARLAY_E2E_FANDUEL!=='1'||process.env.FANDUEL_API_KEY!=='fd_e2e_fixture')throw new Error('FanDuel fixture requires an explicit synthetic credential and test flag.');
  if(new Headers(init?.headers).get('Authorization')!=='Bearer fd_e2e_fixture')throw new Error('Missing authenticated server adapter header');
  if(process.env.PARLAY_E2E_FANDUEL_FAIL==='1')return Response.json({error:{code:'QUOTA_EXCEEDED',message:'sensitive-provider-message-not-for-display',retry_after_seconds:3600}},{status:429});
  const observed=new Date(Date.now()-300000).toISOString(),meta={has_more:false,as_of:observed,observed_at:observed,delay_seconds:300,source_status:'delayed',source_age_seconds:300};
  const starts_at=day+'T18:00:00.000Z',events=[{id:'fd1',event_name:'Buffalo Bills @ Minnesota Vikings',starts_at},{id:'fd2',event_name:'Los Angeles Rams @ Seattle Seahawks',starts_at}];
  const props=players.map((p,i)=>({id:'fp'+i,event_id:p[5]==='g1'?'fd1':'fd2',starts_at,sport:'football',league:'NFL',player:p[0],team:p[2],stat:({player_pass_yds:'passing_yards',player_rush_yds:'rushing_yards',player_reception_yds:'receiving_yards'})[p[4]],period:'game',market_status:'open',line:50.5,over_american:p[0]==='RB Aggressive'?190:-110,under_american:-110,observed_at:observed}));
  if(process.env.PARLAY_E2E_EXPANDED==='1')props.push(
   {...props[1],id:'alt25',line:'25+',american_odds:-110,over_american:null,under_american:null},
   {...props[0],id:'completions',stat:'passing_completions',line:18.5},
   {...props[0],id:'q2-example',period:'q2',line:37.5},
   {...props[0],id:'unknown-example',stat:'provider_unknown',line:9.5}
  );
  if(process.env.PARLAY_E2E_Q1==='1')props.push(...props.slice(0,3).map((q,i)=>({...q,id:'q1-'+i,period:'q1',line:20.5,under_american:110})));
  if(process.env.PARLAY_E2E_MULTI==='1'){const original=[...props];for(const [i,line,price]of [[0,40.5,-105],[1,45.5,-100],[2,55.5,105]])props.push(...original.map(p=>({...p,id:p.id+'multi'+i,stat:p.stat+'_alternate',line:p.period==='q1'?5.5+i*3:line,over_american:price,under_american:-110})));}
  if(process.env.PARLAY_E2E_GAME_MATRIX==='1'){
   for(const [i,date]of matrixDates().entries()){
    const id=['201','matrix-sat','matrix-mon'][i],starts_at=date+'T18:00:00.000Z';
    events.push(i===2?{id,nfl_game_id:'2026_13_BUF_MIN',starts_at}:{id:i===0?201:id,event_name:i===0?' buf@MINNESOTA VIKINGS ':'Buffalo Bills at Minnesota Vikings',starts_at});
    props.push(...props.filter(p=>p.period==='q1').slice(0,3).map((p,j)=>({...p,id:`matrix-${i}-${j}`,event_id:i===0?201:id,starts_at})));
   }
  }
  if(process.env.PARLAY_E2E_NULL_TEAMS==='1'){for(const p of props){p.team=null;p.position='TE';}props.push({...props[0],id:'unmatched-athlete',player:'No Such Player'});}
  return Response.json({data:new URL(url).pathname.endsWith('/events')?events:props,meta});
 }

 if(url.includes('the-odds-api.com')&&process.env.PARLAY_E2E_Q1_ODDS==='1'&&process.env.ODDS_API_KEY==='odds_e2e_q1'){
  recordCall('odds-api');
  if(process.env.PARLAY_E2E_MULTI==='1'){
   const events=[{id:'g1',commence_time:fixtureKickoff,home_team:'Minnesota Vikings',away_team:'Buffalo Bills'},{id:'g2',commence_time:fixtureKickoff,home_team:'Seattle Seahawks',away_team:'Los Angeles Rams'}];
   if(new URL(url).pathname.endsWith('/events'))return Response.json(events);
   if(!new URL(url).searchParams.get('markets')?.includes('_q1')){const id=new URL(url).pathname.split('/').at(-2);return Response.json({bookmakers:[{key:'fanduel',markets:players.filter(p=>p[5]===id).flatMap(p=>[null,40.5,45.5,55.5].map((line,i)=>({key:p[4]+(line!==null?'_alternate':''),last_update:new Date().toISOString(),outcomes:[{name:'Over',description:p[0],point:line??50.5,price:[-110,-105,-100,105][i]},{name:'Under',description:p[0],point:line??50.5,price:-110}]})))}]});}
  }
  if(url.endsWith('/events?apiKey=odds_e2e_q1'))return Response.json([{id:'g1',commence_time:fixtureKickoff,home_team:'Minnesota Vikings',away_team:'Buffalo Bills'}]);
  const markets=['player_pass_yds_q1','player_rush_yds_q1','player_reception_yds_q1'];
  return Response.json({bookmakers:[{key:'fanduel',markets:players.slice(0,3).map((p,i)=>({key:markets[i],last_update:new Date().toISOString(),outcomes:[{name:'Over',description:p[0],point:20.5,price:-110},{name:'Under',description:p[0],point:20.5,price:110}]})).filter(m=>new URL(url).searchParams.get('markets')?.split(',').includes(m.key))}]});
 }
 if(url.includes('the-odds-api.com'))throw new Error('Paid odds requests forbidden in free workflow tests');
 if(url.startsWith('http://127.0.0.1:')||url.startsWith('http://localhost:'))return original(input,init);
 if(process.env.PARLAY_E2E_FAIL_SCHEDULE==='1' && url.includes('games.csv'))return new Response('Provider failure fixture',{status:503});
 const response=await fetcher(input,init);
 if(url.endsWith('/nfl/injuries')){const body=await response.json();body.timestamp=new Date().toISOString();for(const group of body.injuries)for(const r of group.injuries)r.date=body.timestamp;return Response.json(body);}
 if(url.includes('games.csv')){
  const bytes=Buffer.from(await response.arrayBuffer());let text=gunzipSync(bytes).toString().replaceAll('2026-11-15',day);
  if(paperKickoff){const time=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(paperKickoff));text=text.replaceAll(',13:00',','+time);}
  if(process.env.PARLAY_E2E_GAME_MATRIX==='1')for(const [i,date]of matrixDates().entries())text+=`\n2026_${11+i}_BUF_MIN,2026,${11+i},REG,${date},MIN,BUF,,,,13:00`;
  for(let week=1;week<=7;week++)for(const [away,home]of [['BUF','MIN'],['LA','SEA']])text+=`\n2026_${String(week).padStart(2,'0')}_${away}_${home},2026,${week},REG,2026-10-${String(week===7?14:week).padStart(2,'0')},${home},${away},21,20,,13:00`;

  return new Response(gzipSync(text));
 }
 if(url.endsWith('/assets/2026')) {
  const text=gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),lines=text.trim().split('\n'),headers=lines[0].split(',');
  const revised=lines.slice(1).map(line=>{const cells=line.split(','),week=Number(cells[headers.indexOf('week')]);for(const key of ['passing_yards','rushing_yards','receiving_yards']){const i=headers.indexOf(key);if(cells[i]==='100')cells[i]=String(80+week*5);}if(process.env.PARLAY_E2E_PAPER_ZERO_QB==='1'&&week===10&&cells[headers.indexOf('player_display_name')]==='QB One')cells[headers.indexOf('passing_yards')]='0';return cells.join(',');});
  for(const player of players){const [name,pos,team,opp]=player,sides=[team==='LAR'?'LA':team,opp==='LAR'?'LA':opp].sort();const row={player_display_name:name,position:pos,team,opponent_team:opp,season:2026,week:7,season_type:'REG',game_id:`2026_07_${sides.join('_')}`,gsis_id:`id-${name}`,game_date:'2026-10-14',passing_yards:120,passing_tds:2,passing_attempts:25,rushing_attempts:10,rushing_yards:120,receptions:8,targets:10,receiving_yards:120};revised.push(headers.map(h=>row[h]??'').join(','));}
  return new Response(gzipSync([headers.join(','),...revised].join('\n')));
 }
 return response;
};
