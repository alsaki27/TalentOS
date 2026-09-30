// Wall-clock <-> UTC conversion pinned to America/New_York, for staff-entered
// interview times. No date/time library in this repo does IANA-zone-aware
// conversion (date-fns has no companion date-fns-tz here) - this uses only
// Intl.DateTimeFormat, which every runtime this app targets (Node, Cloudflare
// Workers/workerd) already implements with the full ICU tz database, so it
// stays correct across EST/EDT without a hardcoded UTC offset.

export const EASTERN_TIME_ZONE = "America/New_York";

/**
 * Converts a wall-clock date+time as entered in Eastern time to the UTC
 * instant it represents, DST-aware. dateStr: "YYYY-MM-DD", timeStr: "HH:MM"
 * (24h). Returns an ISO 8601 UTC string, or null if either input is empty.
 *
 * Technique: guess the instant by treating the entered numbers as UTC, ask
 * Intl what that guess renders as in America/New_York, and shift by the
 * difference - the standard dependency-free round-trip for named-zone
 * wall-clock -> UTC conversion.
 */
export function easternDateTimeToUtcIso(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dateMatch || !timeMatch) return null;

  const [, y, mo, d] = dateMatch.map(Number) as unknown as [never, number, number, number];
  const [, hh, mm] = timeMatch.map(Number) as unknown as [never, number, number];

  const guessUtcMs = Date.UTC(y, mo - 1, d, hh, mm, 0);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(guessUtcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const renderedAsUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));

  const offsetMs = guessUtcMs - renderedAsUtcMs;
  return new Date(guessUtcMs + offsetMs).toISOString();
}

/** Formats a stored UTC instant for display in Eastern time, e.g. "Oct 5, 2026, 2:30 PM ET". */
export function formatEasternDateTime(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "—";
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "—";
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(date);
  return `${formatted} ET`;
}

/** Splits a stored UTC instant back into Eastern-local {date, time} strings for pre-filling an edit form. */
export function utcIsoToEasternParts(isoUtc: string | null | undefined): { date: string; time: string } {
  if (!isoUtc) return { date: "", time: "" };
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
