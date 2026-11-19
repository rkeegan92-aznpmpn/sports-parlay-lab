import { NextResponse } from 'next/server';
import { getDb } from '@/server/db.ts';
import { calibrationSnapshot } from '@/server/tracking.ts';
export const dynamic = 'force-dynamic';
export async function GET() {
  const db = getDb();
  return NextResponse.json(calibrationSnapshot(db), { headers: { 'Cache-Control': 'no-store' } });
}
