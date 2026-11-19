/** Validate recorded times as-is; never guess seconds vs milliseconds or backdate a forecast. */
export function pregameIssues(row: { snapshotTs: number; kickoffTs: number; season: number; oddsAt: string; resultKickoffTs?: number | null }): string[] {
  const issues: string[] = [];
  const valid = (value: number) => Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime());
  if (!valid(row.snapshotTs)) issues.push('invalid-capture-timestamp');
  if (!valid(row.kickoffTs)) issues.push('invalid-kickoff-timestamp');
  else {
    const date = new Date(row.kickoffTs), season = date.getUTCFullYear() - (date.getUTCMonth() <= 1 ? 1 : 0);
    if (season !== row.season) issues.push('kickoff-season-mismatch');
  }
  if (row.resultKickoffTs != null && valid(row.resultKickoffTs) && row.snapshotTs >= row.resultKickoffTs) issues.push('post-actual-kickoff-capture');
  if (row.snapshotTs >= row.kickoffTs) issues.push('post-kickoff-capture');
  const quote = Date.parse(row.oddsAt);
  if (!Number.isFinite(quote)) issues.push('invalid-quote-timestamp');
  else if (!(row.snapshotTs - quote >= -5 * 60000 && row.snapshotTs - quote <= 30 * 60000)) issues.push('quote-not-fresh-at-capture');
  return issues;
}
