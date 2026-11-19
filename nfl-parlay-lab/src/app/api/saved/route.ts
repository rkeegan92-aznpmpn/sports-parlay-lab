import { NextResponse } from 'next/server';
import { getDb } from '@/server/db.ts';
import { InvalidSavedTicket, listSavedTickets, saveTicket } from '@/server/savedTickets.ts';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(req: Request) {
  const before = new URL(req.url).searchParams.get('before');
  if (before !== null && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before) < 1)) {
    return NextResponse.json({ error: 'Invalid saved-history page.' }, { status: 400, headers });
  }
  try { return NextResponse.json(listSavedTickets(getDb(), before === null ? undefined : Number(before)), { headers }); }
  catch { return NextResponse.json({ error: 'Unable to load saved tickets. Check database storage and retry.' }, { status: 503, headers }); }
}
export async function POST(req: Request) {
  const input: unknown = await req.json().catch(() => null);
  try {
    const ticket = saveTicket(getDb(), input);
    return NextResponse.json({ id: ticket.id, ticket }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InvalidSavedTicket ? error.message : 'Unable to save ticket. Check database storage and try again.' },
      { status: error instanceof InvalidSavedTicket ? 400 : 503, headers });
  }
}
