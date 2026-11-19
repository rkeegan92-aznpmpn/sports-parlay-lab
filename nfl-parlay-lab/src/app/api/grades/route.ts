import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {savedGrades} from '@/server/savedGrades.ts';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(savedGrades(getDb()),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Saved evaluation unavailable; ticket records were retained.'},{status:503});}}
