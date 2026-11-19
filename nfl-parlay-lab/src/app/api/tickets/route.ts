import { NextResponse } from 'next/server';
import { getData } from '@/server/load.ts';
import { eligibilityWarnings, generate, eligible } from '@/lib/optimizer.ts';
import { OddsApiError } from '@/lib/providers/oddsApi.ts';
import { getDb } from '@/server/db.ts';
import { calibrationSnapshot } from '@/server/tracking.ts';
import { groupCandidateRejections } from '@/lib/rejections.ts';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const u = new URL(req.url), game = u.searchParams.get('game') ?? 'ALL', date = u.searchParams.get('date') ?? undefined;
  const mode = process.env.ODDS_API_KEY?.trim() ? 'live' : process.env.DEMO_MODE === '1' ? 'demo' : 'unavailable';
  if (date && date !== 'ALL' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ mode, error: 'Date must use YYYY-MM-DD format.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const testMode = u.searchParams.get('testMode') === '1';
    const data = await getData(u.searchParams.get('refresh') === '1');
    const selectedDate = date ?? 'ALL';
    const inDate = (kickoff: string) => selectedDate === 'ALL' || new Date(kickoff).toISOString().slice(0, 10) === selectedDate;
    const games = data.games.filter((g) => inDate(g.kickoff));
    const db = getDb();
    const calibration = calibrationSnapshot(db);
    const now = Date.now();
    const modelValidated = data.mode === 'live' && calibration.validationStatus === 'validated';
    const candidates = data.candidates.filter((c) => inDate(c.kickoff)).map((candidate) => {
      const event = data.games.find((item) => item.id === candidate.gameId);
      return {
        ...candidate,
        scored: candidate.scored
          ? { ...candidate.scored, confidence: modelValidated ? 'Backtested' as const : 'Unvalidated' as const }
          : undefined,
        eventVerified: candidate.eventVerified === true &&
          event?.status === 'available' &&
          event.id === candidate.gameId &&
          event.kickoff === candidate.kickoff &&
          event.label === candidate.eventLabel,
      };
    });
    const pool = candidates.filter((c) => game === 'ALL' || c.gameId === game);
    const g = generate(pool, now, { modelValidated, testMode, pregameResearch: true });
    const used = pool.filter((c) => eligible('best', c, now) || eligible('aggr', c, now));
    const scopedCandidates = candidates.filter((candidate) => candidate.source === 'live' && (game === 'ALL' || candidate.gameId === game));
    const valueRanking = scopedCandidates
      .map((candidate) => {
        const qualifiedFor = (['best', 'aggr'] as const).filter((kind) => eligible(kind, candidate, now));
        const warnings = [
          ...(testMode ? ['TEST MODE — research only; not a validated recommendation.'] : modelValidated ? [] : ['PRE-GAME RESEARCH — unvalidated probability/EV estimates. Real-money recommendations remain locked.']),
          ...(candidate.marketPSource === 'single-side' ? ['Opposite FanDuel side unavailable; quoted-side implied probability includes vig.'] : []),
          ...(candidate.injury === 'Questionable' ? ['Questionable injury designation; recheck pregame availability.'] : []),
        ];
        return { candidate, qualifiedFor, warnings };
      })
      .filter((item) => item.qualifiedFor.length > 0 && (item.candidate.scored?.ev ?? 0) > 0)
      .sort((a, b) => (b.candidate.scored?.ev ?? -Infinity) - (a.candidate.scored?.ev ?? -Infinity))
      .slice(0, 15);
    const rejectedProps = groupCandidateRejections(scopedCandidates.flatMap((candidate) => {
      const bestReasons = [...eligibilityWarnings('best', candidate, now)];
      const aggressiveReasons = [...eligibilityWarnings('aggr', candidate, now)];
      const reasons = [
        ...[...new Set(bestReasons)].map((reason) => `Best Six: ${reason}`),
        ...[...new Set(aggressiveReasons)].map((reason) => `Aggressive Six: ${reason}`),
      ];
      return reasons.length ? [{ candidate, reasons }] : [];
    }));
    const stale = candidates.filter((c) => c.scored?.stale).length;
    const candidateGameCount = new Set(pool.filter((candidate) => eligible('best', candidate, now) || eligible('aggr', candidate, now)).map((candidate) => candidate.gameId)).size;
    const notes = [...data.notes, ...calibration.notes].filter((note) => !note.startsWith('Only one upcoming game'));
    if (games.length === 1 || candidateGameCount === 1) {
      notes.push(`${games.length === 1 ? 'Only one upcoming game is available' : 'Only one upcoming game has enough supported player props'} for this selection; a six-pick ticket requires at least two games because no more than three picks may come from one game.`);
    } else if (candidateGameCount === 0 && games.length) {
      notes.push('No upcoming games in this selection have FanDuel props matched to real historical player statistics, so no tickets can be generated.');
    }
    return NextResponse.json(
      {
        calibration,
        pipelineRejections: data.pipelineRejections ?? [],
        testMode,
        validationGatePassed: modelValidated && !testMode,
        realMoneyRecommendationsLocked: !modelValidated || testMode,
        generationPurpose: testMode ? 'test-research' : modelValidated ? 'validated-research' : 'pregame-research',
        mode: data.mode,
        notes,
        games,
        availableDates: data.availableDates,
        selectedDate,
        diagnostics: data.diagnostics,
        modelValidation: {
          tracking: calibration.tracking,
          status: calibration.validationStatus,
          sample: calibration.n,
          warnings: calibration.validationWarnings,
        },
        scanned: candidates.length,
        staleCount: stale,
        pool: used,
        quotes: candidates,
        valueRanking,
        rejectedProps,
        ...g,
        generatedAt: now,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const secret = process.env.ODDS_API_KEY?.trim();
    const message = (error instanceof Error ? error.message : 'Unknown live data error')
      .replace(/apiKey=[^&\s]*/gi, 'apiKey=[redacted]')
      .replace(secret || '\u0000', '[redacted]');
    const upstreamStatus = error instanceof OddsApiError ? error.status : 0;
    const status = upstreamStatus === 429 || (error instanceof OddsApiError && error.code === 'OUT_OF_USAGE_CREDITS') ? 429 : upstreamStatus === 401 ? 502 : 502;
    return NextResponse.json({ mode, error: `Live data unavailable: ${message}`, providerErrorCode: error instanceof OddsApiError ? error.code : undefined, creditsRemaining: error instanceof OddsApiError ? error.remaining : undefined, retryAfterMs: error instanceof OddsApiError ? error.retryAfterMs : undefined }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
