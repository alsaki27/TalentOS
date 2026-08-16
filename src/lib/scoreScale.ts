import { MIN_UTILIZATION, MAX_UTILIZATION } from "@/lib/falood/pageFitThresholds";

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

/**
 * Plain-English page-fit summary, e.g. "1 page · 91% filled · readable".
 * Structural type (not imported from schemas.ts) to avoid a circular import -
 * this file is imported by schemas.ts for normalizeScoreOutOfTen. Any
 * PageFitV1 object satisfies this shape automatically.
 */
export function formatPageFitSummary(
  m: { pageCount: number; contentUtilization: number; overflow: boolean; readable: boolean } | null | undefined
): string {
  if (!m) return "Page fit not measured";
  if (!m.readable) return "Readable font floor failed";
  const pageLabel = `${m.pageCount} page${m.pageCount === 1 ? "" : "s"}`;
  if (m.overflow) return `${pageLabel} · overflow`;
  const pct = Math.round(m.contentUtilization * 100);
  const fullness = m.contentUtilization < MIN_UTILIZATION ? "too much whitespace" : m.contentUtilization > MAX_UTILIZATION ? "very tight" : "readable";
  return `${pageLabel} · ${pct}% filled · ${fullness}`;
}
