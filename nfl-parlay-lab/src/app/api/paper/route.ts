import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {paperGames,paperSelection,resolvePaperSelection,savePaperSelection,paperDashboard,paperSlates,paperWindow,paperConfig,updatePaperConfig,previewPaper,capturePaperSlate,gradePaperWagers,paperKeys,PaperError} from '@/server/paper.ts';
import {PAPER_STRATEGIES,type PaperStrategy} from '@/lib/paper.ts';
const headers={'Cache-Control':'no-store'};
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const url=new URL(request.url),rawBefore=url.searchParams.get('before'),strategy=url.searchParams.get('strategy');if(rawBefore!==null&&(!/^\d+$/.test(rawBefore)||!Number.isSafeInteger(Number(rawBefore))||Number(rawBefore)<=0)||strategy!==null&&!PAPER_STRATEGIES.includes(strategy as PaperStrategy))return NextResponse.json({error:'Invalid paper history filter.'},{status:400,headers});const db=getDb(),now=Date.now();let games:Awaited<ReturnType<typeof paperGames>>=[],slates:Awaited<ReturnType<typeof paperSlates>>=[],scheduleError:string|null=null;try{const f=cachedProviderFetch(db);games=await paperGames(f,now);slates=await paperSlates(f,now);}catch{scheduleError='Verified free NFL schedule unavailable. No slate or paper wager was invented.';}
 return NextResponse.json({...paperDashboard(db,now,{before:rawBefore===null?undefined:Number(rawBefore),strategy:strategy as PaperStrategy|null??undefined}),games:games.filter(g=>Date.parse(g.commence_time)>now),slates:slates.map(s=>({...s,window:paperWindow(s,paperConfig(db),now)})),scheduleError},{headers});
}catch{return NextResponse.json({error:'Paper dashboard storage unavailable; existing records were retained.'},{status:503,headers});}}
export async function POST(request:Request){try{
 const text=await request.text();if(text.length>1500)return NextResponse.json({error:'Request too large.'},{status:413,headers});let body;try{body=JSON.parse(text);}catch{return NextResponse.json({error:'Invalid paper action JSON.'},{status:400,headers});}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new PaperError('Send a paper action object.');
 const db=getDb(),f=cachedProviderFetch(db),now=Date.now();
 if(body.action==='settings')return NextResponse.json({config:updatePaperConfig(db,body.config,now)},{headers});
 if(body.action==='selection')return NextResponse.json({selection:savePaperSelection(db,body.selection,await paperGames(f,now),Date.now())},{headers});
 if(body.action==='grade')return NextResponse.json({grading:await gradePaperWagers(db,f,now),dashboard:paperDashboard(db,now)},{headers});
 if(!['preview','capture'].includes(body.action))throw new PaperError('Unknown paper action.');
 if(body.strategy!==undefined&&!PAPER_STRATEGIES.includes(body.strategy))throw new PaperError('Unknown paper strategy.');
 if(['ticket','legs','odds','testMode','stake','bankroll'].some(key=>key in body))throw new PaperError('Paper capture accepts only a slate/strategy; selections, prices, stake and timestamps are generated server-side.');
 const slate=body.slateKey!==undefined?(await paperSlates(f,now)).find(s=>s.key===body.slateKey):resolvePaperSelection(await paperGames(f,now),body.selection??paperSelection(db),Date.now());if(!slate)throw new PaperError('Slate is not in the verified current NFL schedule. No retroactive wager.');
 const capturedNow=Date.now();
 if(body.action==='preview')return NextResponse.json({preview:await previewPaper(db,slate,paperKeys(),f,capturedNow),providerRequests:0},{headers});
 return NextResponse.json({...await capturePaperSlate(db,slate,paperKeys(),f,capturedNow,'manual',body.strategy as PaperStrategy|undefined),dashboard:paperDashboard(db),providerRequests:0},{headers});
}catch(e){return NextResponse.json({error:e instanceof PaperError?e.message:'Paper action unavailable; verified schedule, player results or provider caches could not be read. No substitute tickets created.'},{status:e instanceof PaperError?400:503,headers});}}
