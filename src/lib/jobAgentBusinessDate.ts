/** Normalize PostgreSQL DATE values without losing the application's business timezone. */
export function normalizeJobAgentBusinessDate(value: unknown, timeZone = "Asia/Dhaka"): string {
  if (typeof value === "string") {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    if (dateOnly) return dateOnly;
  }

  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Job Agent business date is invalid.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
