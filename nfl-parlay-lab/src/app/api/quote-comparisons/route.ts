import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {readBoard} from '@/server/fanduelRest.ts';
import {freeSchedule} from '@/server/freeResearch.ts';
import {cachedProviderFetch} from '@/server/load.ts';
import {matchBoard} from '@/server/fanduelResearch.ts';
import {normalizeQuarterBoard} from '@/server/quarterDiagnostics.ts';
import {previewLeg} from '@/server/previewQuotes.ts';
import {comparisonKey} from '@/lib/quoteComparison.ts';
import type {ComparisonTarget} from '@/lib/researchPreview.ts';
import {InvalidComparison,recordComparison,listComparisons} from '@/server/quoteComparisons.ts';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export function GET(){try{return NextResponse.json({checks:listComparisons(getDb())},{headers});}catch{return NextResponse.json({error:'Manual comparison history unavailable; existing records were preserved.'},{status:503,headers});}}
export async function POST(request:Request){
 try{
  const text=await request.text();if(text.length>5000)return NextResponse.json({error:'Comparison is too large.'},{status:413,headers});
  let body;try{body=JSON.parse(text);}catch{throw new InvalidComparison('Send a valid comparison.');}
  const target=body?.target as ComparisonTarget;if(!target||!['game','q1'].includes(target.period))throw new InvalidComparison('Choose an existing captured full-game or Q1 selection.');
  const db=getDb(),board=readBoard(db,process.env.FANDUEL_API_KEY?.trim()??'');if(!board)throw new InvalidComparison('Original provider snapshot unavailable; no API-verified identity can be inferred.');
  const now=Date.now(),games=await freeSchedule(cachedProviderFetch(db),now);
  const q=matchBoard(target.period==='q1'?normalizeQuarterBoard(board):board,games,now,target.period).quotes.find(q=>q.id===target.quoteId&&q.eventId===target.gameId);
  if(!q)throw new InvalidComparison('Original prop is unavailable or no longer uniquely matched. Refresh your comparison worksheet; no replacement market was substituted.');
  const expected=previewLeg(q,q.team??'',q.opponent??'',null,0,now);
  if(comparisonKey(expected)!==comparisonKey(target))throw new InvalidComparison('Captured selection changed since this worksheet loaded. Review the new player/game/market/line/price before checking again.');
  return NextResponse.json({check:recordComparison(db,expected,body.observation,now)},{headers});
 }catch(e){return NextResponse.json({error:e instanceof InvalidComparison?e.message:'Manual comparison could not be recorded. Provider data and existing tickets were preserved.'},{status:e instanceof InvalidComparison?400:503,headers});}
}
