import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCandidateRejections, groupPipelineRejections } from '../src/lib/rejections.ts';
import type { PipelineRejection } from '../src/lib/types.ts';
import { demoResult } from '../src/lib/service.ts';

const rejection: PipelineRejection = {
  eventLabel: 'BUF @ MIN',
  gameId: 'odds-event-1',
  kickoff: '2026-11-15T18:00:00Z',
  player: 'Test QB',
  market: 'player_pass_yds',
  side: 'Over',
  line: 250.5,
  reason: 'No unique verified player history from nflverse or ESPN.',
};

test('pipeline rejections group only exact event, player, market, side, line, and reason matches', () => {
  const grouped = groupPipelineRejections([
    rejection,
    rejection,
    { ...rejection, side: 'Under' },
    { ...rejection, line: 251.5 },
    { ...rejection, gameId: 'odds-event-2' },
    { ...rejection, reason: 'ESPN historical-stat fallback failed.' },
  ]);

  assert.equal(grouped.length, 5);
  assert.equal(grouped.find((item) => item.side === 'Over' && item.line === 250.5 && item.gameId === 'odds-event-1' && item.reason === rejection.reason)?.count, 2);
  assert.ok(grouped.every((item) => item.eventLabel === 'BUF @ MIN' && item.kickoff === rejection.kickoff));
  assert.ok(grouped.filter((item) => item.count === 1).length === 4);
});

test('candidate exclusions also group by event, player, market, side, line, and reasons', () => {
  const candidate = demoResult(Date.parse('2026-11-08T12:00:00Z')).candidates[0];
  const grouped = groupCandidateRejections([
    { candidate, reasons: ['Best Six: stale quote'] },
    { candidate: { ...candidate, id: 'another-row' }, reasons: ['Best Six: stale quote'] },
    { candidate, reasons: ['Aggressive Six: low EV'] },
    { candidate: { ...candidate, side: 'Under' }, reasons: ['Best Six: stale quote'] },
  ]);
  assert.equal(grouped.length, 3);
  assert.equal(grouped.find((item) => item.candidate.side === 'Over' && item.reasons[0] === 'Best Six: stale quote')?.count, 2);
});
