import { NextResponse } from 'next/server';
import { getDb } from '@/server/db.ts';
import { liveHealth } from '@/server/liveHealth.ts';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(liveHealth(getDb()), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ database: 'unavailable', error: 'Database unavailable. Check disk mount, DB_PATH, and write permissions.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
