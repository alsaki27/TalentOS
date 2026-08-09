export type DateExclusionReason =
  | "missing_date"
  | "unparseable_date"
  | "ambiguous_date"
  | "before_window"
  | "after_window";

export type PostingDatePrecision = "timestamp" | "relative_minute" | "relative_hour" | "relative_day";

export interface ParsedPostingDate {
  postedAt: string;
  earliestPossibleAt: string;
  latestPossibleAt: string;
  precision: PostingDatePrecision;
}

export type PostingDateParseResult =
  | { ok: true; value: ParsedPostingDate }
  | { ok: false; reason: "missing_date" | "unparseable_date" | "ambiguous_date" };

const ISO_TIMESTAMP_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Strictly parse source posting dates. Date-only values and calendar words such
 * as "today"/"yesterday" are intentionally rejected because they cannot prove
 * membership in an exact 48-hour timestamp window.
 *
 * Relative numeric values are modeled as a conservative interval because job
 * sites normally round them down ("3 hours ago" means between 3 and 4 hours).
 */
export function parsePostingDateStrict(
  rawValue: string | null | undefined,
  referenceTime: string | Date,
): PostingDateParseResult {
  const raw = rawValue?.trim();
  if (!raw) return { ok: false, reason: "missing_date" };

  const reference = referenceTime instanceof Date
    ? new Date(referenceTime.getTime())
    : new Date(referenceTime);
  if (!Number.isFinite(reference.getTime())) {
    throw new Error("Invalid posting-date reference time.");
  }

  if (ISO_TIMESTAMP_WITH_ZONE.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) {
      return { ok: false, reason: "unparseable_date" };
    }
    const iso = parsed.toISOString();
    return {
      ok: true,
      value: {
        postedAt: iso,
        earliestPossibleAt: iso,
        latestPossibleAt: iso,
        precision: "timestamp",
      },
    };
  }

  const normalized = raw.toLowerCase().replace(/^posted\s+/, "").trim();
  if (normalized === "just now" || normalized === "just posted" || normalized === "moments ago") {
    const iso = reference.toISOString();
    return {
      ok: true,
      value: {
        postedAt: iso,
        earliestPossibleAt: iso,
        latestPossibleAt: iso,
        precision: "relative_minute",
      },
    };
  }

  // Calendar dates/times without an explicit timezone and words that represent
  // a whole calendar period are ambiguous by design.
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    /^(today|yesterday|this week|last week)$/.test(normalized) ||
    /^\d+\+\s+(minute|hour|day|week|month)s?\s+ago$/.test(normalized)
  ) {
    return { ok: false, reason: "ambiguous_date" };
  }

  const relative = normalized.match(/^(\d+|an?|one)\s+(minute|hour|day)s?\s+ago$/);
  if (!relative) return { ok: false, reason: "unparseable_date" };

  const amount = /^(a|an|one)$/.test(relative[1]) ? 1 : Number(relative[1]);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return { ok: false, reason: "unparseable_date" };
  }

  const unit = relative[2] as "minute" | "hour" | "day";
  const unitMs = unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  const latest = new Date(reference.getTime() - amount * unitMs);
  const earliest = new Date(reference.getTime() - (amount + 1) * unitMs);
  return {
    ok: true,
    value: {
      postedAt: latest.toISOString(),
      earliestPossibleAt: earliest.toISOString(),
      latestPossibleAt: latest.toISOString(),
      precision: `relative_${unit}`,
    },
  };
}

export interface DateWindowCandidate {
  date_posted?: string;
  posted_at?: string;
}

export interface ExcludedDateWindowItem<T> {
  item: T;
  rawDate: string | null;
  reason: DateExclusionReason;
}

export interface DateWindowFilterResult<T> {
  included: T[];
  excluded: Array<ExcludedDateWindowItem<T>>;
  reasonCounts: Record<DateExclusionReason, number>;
}

export interface DateWindowFilterOptions {
  windowStart: string | Date;
  windowEnd: string | Date;
  /** Latest possible time relative labels were observed; defaults to window end. */
  referenceTime?: string | Date;
  /** Earliest possible observation time, used to model actor runtime uncertainty. */
  referenceStartTime?: string | Date;
}

function emptyReasonCounts(): Record<DateExclusionReason, number> {
  return {
    missing_date: 0,
    unparseable_date: 0,
    ambiguous_date: 0,
    before_window: 0,
    after_window: 0,
  };
}

/**
 * Keep only jobs whose entire possible posting-time interval is inside the
 * immutable window. Included rows receive a canonical ISO `date_posted` value.
 */
export function filterItemsToDateWindow<T extends DateWindowCandidate>(
  items: T[],
  options: DateWindowFilterOptions,
): DateWindowFilterResult<T> {
  const start = options.windowStart instanceof Date
    ? new Date(options.windowStart.getTime())
    : new Date(options.windowStart);
  const end = options.windowEnd instanceof Date
    ? new Date(options.windowEnd.getTime())
    : new Date(options.windowEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() >= end.getTime()) {
    throw new Error("Invalid posting-date window; expected valid windowStart before windowEnd.");
  }

  const referenceEnd = options.referenceTime ?? end;
  const referenceStart = options.referenceStartTime ?? referenceEnd;
  const referenceStartDate = referenceStart instanceof Date ? referenceStart : new Date(referenceStart);
  const referenceEndDate = referenceEnd instanceof Date ? referenceEnd : new Date(referenceEnd);
  if (
    !Number.isFinite(referenceStartDate.getTime()) ||
    !Number.isFinite(referenceEndDate.getTime()) ||
    referenceStartDate.getTime() > referenceEndDate.getTime()
  ) {
    throw new Error("Invalid posting-date reference interval.");
  }
  const included: T[] = [];
  const excluded: Array<ExcludedDateWindowItem<T>> = [];
  const reasonCounts = emptyReasonCounts();

  const reject = (item: T, rawDate: string | null, reason: DateExclusionReason) => {
    excluded.push({ item, rawDate, reason });
    reasonCounts[reason] += 1;
  };

  for (const item of items) {
    const rawDate = String(item.date_posted ?? item.posted_at ?? "").trim() || null;
    const parsedAtStart = parsePostingDateStrict(rawDate, referenceStartDate);
    if (!parsedAtStart.ok) {
      reject(item, rawDate, parsedAtStart.reason);
      continue;
    }

    const parsedAtEnd = referenceEndDate.getTime() === referenceStartDate.getTime()
      ? parsedAtStart
      : parsePostingDateStrict(rawDate, referenceEndDate);
    if (!parsedAtEnd.ok) {
      reject(item, rawDate, parsedAtEnd.reason);
      continue;
    }

    const earliestMs = new Date(parsedAtStart.value.earliestPossibleAt).getTime();
    const latestMs = new Date(parsedAtEnd.value.latestPossibleAt).getTime();
    if (latestMs < start.getTime()) {
      reject(item, rawDate, "before_window");
      continue;
    }
    if (earliestMs > end.getTime()) {
      reject(item, rawDate, "after_window");
      continue;
    }
    if (earliestMs < start.getTime() || latestMs > end.getTime()) {
      reject(item, rawDate, "ambiguous_date");
      continue;
    }

    included.push({ ...item, date_posted: parsedAtEnd.value.postedAt });
  }

  return { included, excluded, reasonCounts };
}
