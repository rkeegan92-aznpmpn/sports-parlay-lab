import {NextResponse} from 'next/server';
import {getDb} from '@/server/db.ts';
import {forwardReadiness} from '@/server/forwardReadiness.ts';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(forwardReadiness(getDb()),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Readiness audit unavailable. Existing records were not modified.'},{status:503});}}
