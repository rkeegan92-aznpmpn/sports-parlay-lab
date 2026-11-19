import type {Pos} from './types.ts';
/** Semantic mappings, not a list of prices/lines to fabricate or request from a paid provider. */
export const PROP_STATS:Record<string,{market:string;positions:Pos[];column:string;category:string}>={
 passing_rushing_yards:{market:'player_pass_rush_yds',positions:['QB'],column:'passing_rushing_yards',category:'passing_rushing'},
 passing_yards:{market:'player_pass_yds',positions:['QB'],column:'passing_yards',category:'passing'},
 passing_tds:{market:'player_pass_tds',positions:['QB'],column:'passing_tds',category:'touchdowns'},
 passing_attempts:{market:'player_pass_attempts',positions:['QB'],column:'attempts',category:'attempts'},
 passing_completions:{market:'player_pass_completions',positions:['QB'],column:'completions',category:'completions'},
 interceptions:{market:'player_pass_interceptions',positions:['QB'],column:'interceptions',category:'interceptions'},
 rushing_yards:{market:'player_rush_yds',positions:['QB','RB'],column:'rushing_yards',category:'rushing'},
 rushing_attempts:{market:'player_rush_attempts',positions:['QB','RB'],column:'carries',category:'attempts'},
 rushing_tds:{market:'player_rush_tds',positions:['QB','RB','WR','TE'],column:'rushing_tds',category:'touchdowns'},
 receiving_yards:{market:'player_reception_yds',positions:['WR','TE','RB'],column:'receiving_yards',category:'receiving'},
 receptions:{market:'player_receptions',positions:['WR','TE','RB'],column:'receptions',category:'receptions'},
 receiving_tds:{market:'player_receiving_tds',positions:['WR','TE','RB'],column:'receiving_tds',category:'touchdowns'},
};
export const basePropMarket=(m:string)=>m.replace(/_alternate$/,'');
export const propDefinition=(market:string)=>Object.values(PROP_STATS).find(d=>d.market===basePropMarket(market));
export function statToken(s:unknown){
 const raw=typeof s==='string'?s.trim().toLowerCase():'',base=raw.replace(/_alternate$/,'');
 const aliases:Record<string,string>={passing_plus_rushing_yards:'passing_rushing_yards',passing_and_rushing_yards:'passing_rushing_yards'};
 return aliases[base]??base;
}
export function contractHit(value:number,side:string,line:number|null){return side==='Yes'?value>0:side==='AtLeast'?value>=line!:side==='Over'?value>line!:value<line!;}
export function contractPush(value:number,side:string,line:number|null){return !['Yes','AtLeast'].includes(side)&&value===line;}
export function propSides(row:Record<string,unknown>):{side:'Over'|'Under'|'AtLeast';line:number;odds:number|null}[]{
 const numeric=typeof row.line==='number'&&Number.isFinite(row.line)?row.line:null;
 // A plus-suffixed line explicitly expresses >=N. Never reinterpret an integer Over N as N+.
 const plus=typeof row.line==='string'?/^(\d+(?:\.\d+)?)\+$/.exec(row.line.trim()):null;
 const threshold=plus?Number(plus[1]):row.side==='AtLeast'&&numeric!==null?numeric:null;
 if(threshold!==null)return [{side:'AtLeast',line:threshold,odds:validPrice(row.american_odds??row.odds??row.over_american)}];
 if(numeric===null)return [];
 return [{side:'Over',line:numeric,odds:validPrice(row.over_american)},{side:'Under',line:numeric,odds:validPrice(row.under_american)}];
}
export function validPrice(v:unknown){return typeof v==='number'&&Number.isInteger(v)&&Math.abs(v)>=100&&Math.abs(v)<=100000?v:null;}

export const quarterMarketName=(m:string)=>{const entry=Object.entries(PROP_STATS).find(([,d])=>d.market+'_q1'===m);return entry?'1Q '+entry[0].replace('passing_tds','passing touchdowns').replace('rushing_tds','rushing touchdowns').replace('receiving_tds','receiving touchdowns').replace(/_/g,' '):m;};
export const quarterMarketKey=(name:string)=>{const d=Object.values(PROP_STATS).find(d=>quarterMarketName(d.market+'_q1')===name);return d?d.market+'_q1':undefined;};
export const PERIOD_QUARTERS:Record<string,number[]>={q1:[1],q2:[2],q3:[3],q4:[4],h1:[1,2],h2:[3,4]};
export const asQuarterMarket=(key:string)=>key.replace(/_(?:q[1-4]|h[12])$/,'_q1');
export function periodMarketName(key:string){const p=key.match(/_(q[1-4]|h[12])$/)?.[1];const name=quarterMarketName(asQuarterMarket(key));return p?name.replace(/^1Q/,p[0]==='q'?p[1]+'Q':p[1]+'H'):name;}
