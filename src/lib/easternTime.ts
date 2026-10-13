// Interview schedules are stored as UTC instants. These helpers convert the
// wall-clock time entered in a selected IANA zone without relying on the
// server or staff member's machine timezone.

export const INTERVIEW_TIME_ZONES = [
  { value: "America/New_York", shortName: "ET", label: "Eastern Time (ET)" },
  { value: "America/Chicago", shortName: "CT", label: "Central Time (CT)" },
  { value: "America/Denver", shortName: "MT", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", shortName: "PT", label: "Pacific Time (PT)" },
] as const;

export const ARIZONA_TIME_ZONE = "America/Phoenix";
export type InterviewTimeZone = (typeof INTERVIEW_TIME_ZONES)[number]["value"] | typeof ARIZONA_TIME_ZONE;
export const EASTERN_TIME_ZONE: InterviewTimeZone = "America/New_York";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function utcMillisFromParts(parts: Intl.DateTimeFormatPart[]) {
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const date = new Date(0);
  date.setUTCFullYear(get("year"), get("month") - 1, get("day"));
  date.setUTCHours(get("hour"), get("minute"), get("second"), 0);
  return date.getTime();
}

export function isInterviewTimeZone(value: unknown): value is InterviewTimeZone {
  return typeof value === "string" && (
    value === ARIZONA_TIME_ZONE || INTERVIEW_TIME_ZONES.some((zone) => zone.value === value)
  );
}

export function resolveInterviewTimeZone(timeZone: InterviewTimeZone, useArizonaTime = false): InterviewTimeZone {
  return timeZone === "America/Denver" && useArizonaTime ? ARIZONA_TIME_ZONE : timeZone;
}

/**
 * Converts a local date and time in an IANA timezone to the UTC instant it
 * represents. Returns null for invalid input, a daylight-saving gap, or an
 * ambiguous repeated local time so the scheduler can ask for another time.
 */
export function zonedDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch.map(Number) as unknown as [never, number, number, number];
  const [, hour, minute] = timeMatch.map(Number) as unknown as [never, number, number];
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return null;

  const localAsUtc = new Date(0);
  localAsUtc.setUTCFullYear(year, month - 1, day);
  localAsUtc.setUTCHours(hour, minute, 0, 0);
  const localAsUtcMs = localAsUtc.getTime();
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatterFor(timeZone);
  } catch {
    return null;
  }

  // Probe the surrounding offsets. Near a DST transition, this discovers both
  // valid offsets; a round-trip below rejects skipped or repeated wall times.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probeMs = localAsUtcMs + hours * 60 * 60 * 1000;
    offsets.add(probeMs - utcMillisFromParts(formatter.formatToParts(new Date(probeMs))));
  }

  const matches = [...offsets]
    .map((offset) => localAsUtcMs + offset)
    .filter((instantMs) => {
      const parts = formatter.formatToParts(new Date(instantMs));
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
      return get("year") === year && get("month") === month && get("day") === day
        && get("hour") === hour && get("minute") === minute;
    });

  if (matches.length !== 1) return null;
  return new Date(matches[0]).toISOString();
}

/** Backwards-compatible wrapper for existing Eastern-only callers. */
export function easternDateTimeToUtcIso(dateStr: string, timeStr: string): string | null {
  return zonedDateTimeToUtcIso(dateStr, timeStr, EASTERN_TIME_ZONE);
}

/** Formats a stored UTC instant for display in Eastern time. */
export function formatEasternDateTime(isoUtc: string | null | undefined): string {
  return formatZonedDateTime(isoUtc, EASTERN_TIME_ZONE);
}

function safeTimeZone(timeZone: string | null | undefined): InterviewTimeZone {
  return isInterviewTimeZone(timeZone) ? timeZone : EASTERN_TIME_ZONE;
}

/** Formats a UTC instant in the interview's saved timezone, including its DST abbreviation. */
export function formatZonedDateTime(isoUtc: string | null | undefined, timeZone: string | null | undefined): string {
  if (!isoUtc) return "—";
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

export function formatZonedDate(isoUtc: string | null | undefined, timeZone: string | null | undefined): string {
  if (!isoUtc) return "—";
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone), month: "short", day: "numeric", year: "numeric",
  }).format(date);
}

export function formatZonedTime(isoUtc: string | null | undefined, timeZone: string | null | undefined): string {
  if (!isoUtc) return "—";
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone), hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

/** Calendar date key in the schedule's zone, used to place it in the matching day column. */
export function zonedDateKey(isoUtc: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!isoUtc) return null;
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return null;
  const parts = formatterFor(safeTimeZone(timeZone)).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Splits a stored UTC instant back into Eastern-local date/time for old edit forms. */
export function utcIsoToEasternParts(isoUtc: string | null | undefined): { date: string; time: string } {
  return utcIsoToZonedParts(isoUtc, EASTERN_TIME_ZONE);
}

/** Splits a stored UTC instant back into local date/time parts in the given zone, for reschedule/edit forms. */
export function utcIsoToZonedParts(isoUtc: string | null | undefined, timeZone: string | null | undefined): { date: string; time: string } {
  if (!isoUtc) return { date: "", time: "" };
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const parts = formatterFor(safeTimeZone(timeZone)).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

// ── Any-zone helpers, for candidate-timezone display ────────────────────────
// The functions above are deliberately restricted to the 5 interview-scheduling zones
// (via safeTimeZone/isInterviewTimeZone, matching interview_schedules' own DB CHECK
// constraint) - silently falling back to Eastern for anything else. That's correct for
// interview scheduling (a recruiter can only pick one of those 5), but wrong for a
// candidate's own derived timezone, which can legitimately be outside that set (Alaska,
// Hawaii, Puerto Rico, a non-US location if one is ever entered manually, etc.) - and
// "accurate" means never silently substituting a different zone. These are separate,
// parallel functions rather than widening safeTimeZone itself, so the existing
// interview-scheduling call sites are completely unaffected.

const ianaTimeZoneValidityCache = new Map<string, boolean>();

/** True only for a syntactically valid, real IANA timezone identifier - not restricted to
 * the 5 interview-scheduling zones. Used to decide whether a candidate's derived/entered
 * timezone can be safely formatted, never to validate what a recruiter can schedule into.
 *
 * Deliberately validates by constructing Intl.DateTimeFormat and catching failure, NOT by
 * checking membership in Intl.supportedValuesOf("timeZone") - confirmed on this runtime that
 * the two disagree (e.g. "Asia/Kolkata" is accepted and formatted correctly by the
 * constructor but is absent from supportedValuesOf's enumerated list), so the enumerated-set
 * approach would wrongly reject a genuinely valid zone. The constructor is the authoritative
 * check; results are cached since the same handful of zones repeat across candidates. */
export function isValidIanaTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  const cached = ianaTimeZoneValidityCache.get(timeZone);
  if (cached !== undefined) return cached;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    valid = true;
  } catch {
    valid = false;
  }
  ianaTimeZoneValidityCache.set(timeZone, valid);
  return valid;
}

/** Formats a UTC instant in any valid IANA zone. Returns null (not a wrong-zone guess) for
 * missing/invalid input or an unrecognized zone. */
export function formatAnyZonedDateTime(isoUtc: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!isoUtc || !isValidIanaTimeZone(timeZone)) return null;
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

/** Time-only counterpart of formatAnyZonedDateTime, for compact display (e.g. a table column). */
export function formatAnyZonedTime(isoUtc: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!isoUtc || !isValidIanaTimeZone(timeZone)) return null;
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

/** UTC offset in whole+fractional hours for a zone at a given instant (e.g. -5, 5.5, 9.75) -
 * used to compute "Dhaka is N hours ahead/behind" style comparisons. Null for an invalid zone. */
export function utcOffsetHours(isoUtc: string, timeZone: string): number | null {
  if (!isValidIanaTimeZone(timeZone)) return null;
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offsetPart);
  if (!match) return 0; // GMT/UTC itself formats with no explicit offset suffix
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  return sign * (hours + minutes / 60);
}
