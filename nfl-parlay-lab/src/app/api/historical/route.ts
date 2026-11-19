import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {runHistorical} from '@/server/historical.ts';
import {currentSeason} from '@/lib/service.ts';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const u=new URL(req.url),year=Number(u.searchParams.get('season')??currentSeason());
 if(!Number.isInteger(year)||year<2020||year>currentSeason())return NextResponse.json({error:'Choose a completed/current NFL season from 2020 onward.'},{status:400});
 try{const db=getDb();return NextResponse.json(await runHistorical(db,year,cachedProviderFetch(db),u.searchParams.get('refresh')==='1'),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Historical source data unavailable. No simulated records were inserted into upcoming picks.'},{status:503});}
}
