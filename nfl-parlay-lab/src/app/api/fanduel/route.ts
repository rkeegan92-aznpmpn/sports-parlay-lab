import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {FanDuelRestError,readBoard,refreshBoard,assertBoardUsable,cachedResearchBoard} from '@/server/fanduelRest.ts';
import {fanduelResearch} from '@/server/fanduelResearch.ts';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET() {
 const key=process.env.FANDUEL_API_KEY?.trim()??'';
 // A page load never spends the small free-tier provider quota.
 try {const board=key?readBoard(getDb(),key):null;return NextResponse.json({configured:!!key,fetchedAt:board?.fetchedAt??null,source:'Independent fanduelapi.com service; free tier delayed five minutes. Fetch only on request.'},{headers});}
 catch{return NextResponse.json({error:'FanDuel integration storage is unavailable. Existing records were preserved.'},{status:503,headers});}
}
export async function POST(req:Request) {
 try {
  const text=await req.text();if(text.length>1000)return NextResponse.json({error:'Request too large.'},{status:413,headers});
  let body;try{body=JSON.parse(text);}catch{return NextResponse.json({error:'Send a valid action.'},{status:400,headers});}
  if(!body||!['refresh','generate','preview'].includes(body.action))return NextResponse.json({error:'Choose refresh, generate or preview.'},{status:400,headers});
  const db=getDb(),key=process.env.FANDUEL_API_KEY?.trim()??'';
  if(!key)throw new FanDuelRestError('FANDUEL_API_KEY is missing in the server environment. Add it privately to the application .env.local and restart; manual research remains available.',401);
  const preview=body.action==='preview';
  const {board,providerWarning}=body.action==='refresh'?{board:await refreshBoard(db,key),providerWarning:null}:cachedResearchBoard(db,key,preview);
  if(!preview)assertBoardUsable(db,key,board);
  return NextResponse.json({...await fanduelResearch(board,cachedProviderFetch(db),Date.now(),body.testMode===true,preview,body.scope!=='all'),providerWarning,fetchedAt:board.fetchedAt},{headers});
 }catch(error){return NextResponse.json({error:error instanceof FanDuelRestError?error.message:'Verified FanDuel research data could not be retrieved. Existing records were preserved; no substitute picks were added.',retryAt:error instanceof FanDuelRestError?error.retryAt:null},{status:error instanceof FanDuelRestError?error.status:503,headers});}
}
