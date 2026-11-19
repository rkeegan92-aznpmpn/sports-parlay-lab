import type Database from 'better-sqlite3';
import { validateLegs } from '../lib/optimizer.ts';
import type { Candidate } from '../lib/types.ts';
import type { SavedLeg, SavedTicket } from '../lib/savedTickets.ts';
import { SUPPORTED_MARKETS } from '../lib/providers/oddsApi.ts';

export class InvalidSavedTicket extends Error {}
function isLeg(value: unknown): value is SavedLeg {
  if (!value || typeof value !== 'object') return false;
  const leg = value as Record<string, unknown>;
  return ['id', 'name', 'pos', 'team', 'opp', 'gameId', 'kickoff', 'market', 'side', 'oddsAt'].every((key) => typeof leg[key] === 'string' && Boolean((leg[key] as string).trim())) &&
    ['QB', 'RB', 'WR', 'TE'].includes(String(leg.pos)) && typeof leg.odds === 'number' && Number.isFinite(leg.odds) && Math.abs(leg.odds) >= 100 &&
    (leg.line === null || typeof leg.line === 'number' && Number.isFinite(leg.line));
}
export function listSavedTickets(db: Database.Database, before?: number): SavedTicket[] {
  const rows = db.prepare(`SELECT id, purpose, kind, created_at, source, joint_p, decimal, legs_json, (SELECT strategy FROM pick6_batch_archives b WHERE b.ticket_id=saved_tickets.id LIMIT 1) strategy
    FROM saved_tickets ${before === undefined ? '' : 'WHERE id < ?'} ORDER BY id DESC LIMIT 50`)
    .all(...(before === undefined ? [] : [before])) as Omit<SavedTicket, 'legs' | 'detailsUnavailable'>[];
  return rows.map((row) => {
    let legs: SavedLeg[] = [];
    try { const parsed: unknown = JSON.parse(row.legs_json); if (Array.isArray(parsed)) legs = parsed.filter(isLeg); } catch { /* Preserve older rows even if their detail JSON is damaged. */ }
    return { ...row, legs, detailsUnavailable: legs.length !== 6 };
  });
}
/** Save an archive of the displayed selections; this never generates or revalidates a recommendation. */
export function saveTicket(db: Database.Database, input: unknown, now = Date.now()): SavedTicket {
  if (!input || typeof input !== 'object') throw new InvalidSavedTicket('Invalid ticket request.');
  const body = input as Record<string, unknown>;
  if(body.actionable===false||body.purpose==='stale-preview'||body.label==='STALE — RESEARCH PREVIEW ONLY')throw new InvalidSavedTicket('Stale previews are non-actionable comparison worksheets; they cannot be saved as forward-tracked tickets.');
  if (!['best', 'aggr'].includes(String(body.kind)) || !Array.isArray(body.legs) || body.legs.length !== 6 ||
      !body.legs.every(isLeg)) throw new InvalidSavedTicket('Save requires a complete six-pick ticket. Generate tickets again.');
  const legs = body.legs as SavedLeg[];
  if (legs.some((leg) => !['live','manual'].includes(leg.source) || !SUPPORTED_MARKETS.includes(leg.market) ||
      !Number.isFinite(Date.parse(leg.kickoff)) || !Number.isFinite(Date.parse(leg.oddsAt)) ||
      !['Over', 'Under', 'Yes','AtLeast'].includes(leg.side) || (leg.side === 'Yes' ? leg.market !== 'player_anytime_td' : leg.line == null)) ||
      validateLegs(legs as Candidate[]).length) throw new InvalidSavedTicket('Ticket selections must preserve the verified live six-player structure.');
  if (typeof body.jointP !== 'number' || !Number.isFinite(body.jointP) || body.jointP < 0 || body.jointP > 1 ||
      typeof body.decimal !== 'number' || !Number.isFinite(body.decimal) || body.decimal <= 1) throw new InvalidSavedTicket('Ticket estimates are invalid. Generate tickets again.');
  // Saving never promotes research into a validated recommendation. Preserve TEST MODE explicitly.
  const purpose = body.purpose === 'test-research' ? 'test-research' : legs.some(l=>l.source==='manual') ? 'manual-research' : body.purpose === 'pregame-research' ? 'pregame-research' : 'research-only';
  const source=legs.every(l=>l.source==='manual')?'manual':legs.some(l=>l.source==='manual')?'mixed':'live';
  const jointP=body.jointP,decimal=body.decimal;
  return db.transaction(()=>{
  const result = db.prepare(`INSERT INTO saved_tickets (kind, created_at, source, joint_p, decimal, legs_json, purpose)
    VALUES (?,?,?,?,?,?,?)`).run(body.kind, now, source, body.jointP, body.decimal, JSON.stringify(body.legs), purpose);
  db.prepare('INSERT INTO saved_ticket_grades(ticket_id,status,legs_json,checked_at,finalized) VALUES(?,?,?,?,0)').run(Number(result.lastInsertRowid),'pending',JSON.stringify(legs.map(l=>({player:l.name,pos:l.pos,market:l.market,side:l.side,line:l.line,status:'pending',hit:null,actual:null,reason:'awaiting-final-result'}))),now);
  return { id: Number(result.lastInsertRowid), kind: body.kind as SavedTicket['kind'], created_at: now,
    purpose, source, joint_p: jointP, decimal, legs_json: JSON.stringify(body.legs), legs, detailsUnavailable: false };
  })();
}
