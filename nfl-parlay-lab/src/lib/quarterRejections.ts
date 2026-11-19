type Rejection={stage:string;reason:string;count?:number};
export function groupQuarterRejections(rows:Rejection[]){
 const groups=new Map<string,{category:string;count:number;reasons:Record<string,number>}>();
 for(const r of rows){
  const category=r.stage==='freshness'?'freshness':r.stage==='event-match'?'unmatched game':r.stage==='selection-filter'?'outside selected window':r.stage==='kickoff'?'kickoff':['identity-history','missing-player'].includes(r.stage)?'missing player/history':r.stage==='availability'?'player availability':r.stage==='ticket-eligibility'?'eligibility':/unsupported/i.test(r.reason)?'unsupported market':r.stage==='quote-schema'?'quote schema':'provider/other';
  const g=groups.get(category)??{category,count:0,reasons:{}};g.count+=r.count??1;g.reasons[r.reason]=(g.reasons[r.reason]??0)+(r.count??1);groups.set(category,g);
 }
 return [...groups.values()].sort((a,b)=>b.count-a.count);
}
