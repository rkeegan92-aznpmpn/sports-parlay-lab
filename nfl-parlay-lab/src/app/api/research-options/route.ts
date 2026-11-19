import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {multiResearch,multiProviderStatus,refreshSelectedProvider} from '@/server/multiProvider.ts';
import {propLineEvidence} from '@/server/propline.ts';
import {FanDuelRestError} from '@/server/fanduelRest.ts';
import {OddsApiError} from '@/lib/providers/oddsApi.ts';
const headers={'Cache-Control':'no-store'};
export const dynamic='force-dynamic';
const keys=()=>({'fanduelapi':process.env.FANDUEL_API_KEY?.trim()??'','odds-api':process.env.ODDS_API_KEY?.trim()??'',propline:process.env.PROPLINE_API_KEY?.trim()??''});
export async function GET(request:Request){try{const url=new URL(request.url);if(url.searchParams.get('proplineDiagnostics')==='1'){const p=url.searchParams.get('period')??'Q1',game=url.searchParams.get('game')??'ALL';if(!['FULL','Q1'].includes(p)||!/^(ALL|\d{4}_\d{1,2}_[A-Z]{2,3}_[A-Z]{2,3})$/.test(game))return NextResponse.json({error:'Invalid period or verified game ID.'},{status:400,headers});return NextResponse.json({providerRequests:0,diagnostics:propLineEvidence(getDb(),keys().propline,p as 'FULL'|'Q1',game)},{headers});}return NextResponse.json(multiProviderStatus(getDb(),keys()),{headers});}catch{return NextResponse.json({error:'Provider storage diagnostics unavailable.'},{status:503,headers});}}
export async function POST(request:Request){
 try{
  const text=await request.text();if(text.length>1000)return NextResponse.json({error:'Request too large.'},{status:413,headers});
  let body;try{body=JSON.parse(text);}catch{return NextResponse.json({error:'Invalid JSON.'},{status:400,headers});}
  if(!['analyze-cache','refresh-provider'].includes(body?.action)||!['FULL','Q1'].includes(body?.period)||typeof body.game!=='string'||! /^(ALL|\d{4}_\d{1,2}_[A-Z]{2,3}_[A-Z]{2,3})$/.test(body.game))return NextResponse.json({error:'Choose a valid action, FULL/Q1 mode and verified NFL game ID or ALL.'},{status:400,headers});
  const db=getDb(),credentials=keys();
  let refreshFailure:null|{provider:string;httpStatus:number;message:string}=null;
  if(body.action==='refresh-provider'){
   if(!['fanduelapi','odds-api','propline'].includes(body.provider))return NextResponse.json({error:'Provider adapter unavailable. No request made.'},{status:400,headers});
   try{await refreshSelectedProvider(db,credentials,body.provider,body.period,body.game);}catch(e){refreshFailure={provider:body.provider,httpStatus:e instanceof FanDuelRestError||e instanceof OddsApiError?e.status:503,message:e instanceof FanDuelRestError||e instanceof OddsApiError?e.message:'Selected provider unavailable; existing independent caches are analyzed without refreshing another provider.'};}
  }
  return NextResponse.json({...await multiResearch(db,credentials,body.period,body.game,cachedProviderFetch(db),Date.now(),body.testMode===true),refreshFailure},{status:refreshFailure?207:200,headers});
 }catch(e){return NextResponse.json({error:e instanceof FanDuelRestError||e instanceof OddsApiError?e.message:'Research unavailable: free schedule/player data or persistent storage could not be verified. No substitute picks created.'},{status:e instanceof FanDuelRestError||e instanceof OddsApiError?Math.max(400,e.status||503):503,headers});}
}
