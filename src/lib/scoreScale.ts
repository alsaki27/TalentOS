/**
 * Canonicalize pipeline QA scores to a 0-10 scale. Final Polish occasionally
 * returns percentage-style scores (for example 93 instead of 9.3). Values in
 * the ambiguous 10-20 range are rejected instead of silently reinterpreted.
 */
export function normalizeScoreOutOfTen(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric <= 10) return Math.round(numeric * 10) / 10;
  if (numeric >= 20 && numeric <= 100) return Math.round(numeric) / 10;
  return null;
}

export function formatScoreOutOfTen(value: unknown): string | null {
  const normalized = normalizeScoreOutOfTen(value);
  return normalized === null ? null : normalized.toFixed(1);
}
