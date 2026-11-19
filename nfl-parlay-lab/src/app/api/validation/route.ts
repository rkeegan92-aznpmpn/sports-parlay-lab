import { NextResponse } from 'next/server';
import { getDb } from '@/server/db.ts';
import { validationDashboard } from '@/server/validationDashboard.ts';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json(validationDashboard(getDb()), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Validation status is unavailable. Check the app and database storage.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
