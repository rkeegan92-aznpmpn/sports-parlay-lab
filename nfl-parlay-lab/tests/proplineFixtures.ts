// Explicit synthetic external-provider contracts only; never application data.
import {players,NOW,kickoff,fetcher} from './manualFixtures.ts';
import {quarterCsv} from './quarterFixtures.ts';
export {NOW,kickoff,players};
export const KEY='propline_fixture_not_a_real_key';
export const OBSERVED=new Date(NOW-300000).toISOString();
export const events=[{id:'101',sport_key:'football_nfl',home_team:'Minnesota Vikings',away_team:'Buffalo Bills',commence_time:kickoff,live:false},{id:'102',sport_key:'football_nfl',home_team:'Seattle Seahawks',away_team:'Los Angeles Rams',commence_time:kickoff,live:false}];
export function eventBody(index=0,period:'FULL'|'Q1'='FULL'){
 const event=events[index],group=players.filter(p=>(p[5]==='g1'?'101':'102')===event.id);
 return {...event,bookmakers:[{key:'fanduel',title:'FanDuel',markets:group.flatMap(p=>[null,40.5,45.5,55.5].map((line,j)=>({key:p[4],period:period==='FULL'?null:'q1',line_type:j?'alternate':'main',last_update:OBSERVED,suspended_at:null,outcomes:[{name:'Over',description:p[0],price:p[0]==='RB Aggressive'&&j===0?190:[-110,-105,-100,105][j],point:period==='Q1'?(j?5.5+(j-1)*3:20.5):line??50.5,last_seen_at:OBSERVED,last_change_at:OBSERVED},{name:'Under',description:p[0],price:-110,point:period==='Q1'?(j?5.5+(j-1)*3:20.5):line??50.5,last_seen_at:OBSERVED,last_change_at:OBSERVED}]})))}]};
}
export const free:typeof fetch=async(input,init)=>{if(/prop-line.com|the-odds-api.com|fanduelapi.com/.test(String(input)))throw Error('Paid provider forbidden in cached/free analysis');if(String(input).includes('play_by_play_'))return new Response(quarterCsv(String(input).includes('2026')?2026:2025));return fetcher(input,init);};
export function api(calls:string[]):typeof fetch{return async(input,init)=>{
 const url=new URL(String(input));calls.push(url.pathname+url.search);if(url.origin!=='https://api.prop-line.com')throw Error('Wrong provider');if(new Headers(init?.headers).get('X-API-Key')!==KEY)throw Error('Wrong fixture key');if(url.searchParams.has('apiKey'))throw Error('Credential in URL');if(init?.redirect!=='error')throw Error('Unsafe redirect');
 const headers={'X-Daily-Limit':'1000','X-Daily-Used':String(calls.length),'X-Daily-Remaining':String(1000-calls.length),'X-Daily-Reset':String(Math.floor((NOW+86400000)/1000))};
 if(url.pathname.endsWith('/events'))return Response.json(events,{headers});
 const period=url.searchParams.get('period')==='q1'?'Q1':'FULL';if(url.pathname==='/v1/sports/football_nfl/odds')return Response.json([eventBody(0,period),eventBody(1,period)],{headers});
 return Response.json(eventBody(url.pathname.includes('/102/')?1:0,period),{headers});
};}
