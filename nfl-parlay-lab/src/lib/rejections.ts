import type { Candidate, GroupedPipelineRejection, PipelineRejection } from './types.ts';

export interface CandidateRejection {
  candidate: Candidate;
  reasons: string[];
}

export interface GroupedCandidateRejection extends CandidateRejection {
  count: number;
}

export function groupPipelineRejections(rejections: PipelineRejection[]): GroupedPipelineRejection[] {
  const grouped = new Map<string, GroupedPipelineRejection>();
  for (const rejection of rejections) {
    const key = JSON.stringify([
      rejection.gameId,
      rejection.eventLabel,
      rejection.kickoff,
      rejection.player,
      rejection.market,
      rejection.side,
      rejection.line,
      rejection.reason,
    ]);
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { ...rejection, count: 1 });
  }
  return [...grouped.values()];
}

export function groupCandidateRejections(rejections: CandidateRejection[]): GroupedCandidateRejection[] {
  const grouped = new Map<string, GroupedCandidateRejection>();
  for (const rejection of rejections) {
    const { candidate, reasons } = rejection;
    const key = JSON.stringify([
      candidate.gameId,
      candidate.eventLabel,
      candidate.kickoff,
      candidate.name,
      candidate.market,
      candidate.side,
      candidate.line,
      [...reasons].sort(),
    ]);
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { ...rejection, count: 1 });
  }
  return [...grouped.values()];
}
