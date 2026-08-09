import { describe, expect, test } from "vitest";
import {
  filterItemsToDateWindow,
  parsePostingDateStrict,
} from "@/lib/jobAgentDateWindow";

const WINDOW_START = "2026-08-04T18:00:00.000Z";
const WINDOW_END = "2026-08-06T18:00:00.000Z";

describe("strict Job Agent posting-date parsing", () => {
  test("accepts timezone-qualified ISO timestamps and rejects date-only values", () => {
    expect(parsePostingDateStrict("2026-08-05T01:02:03-04:00", WINDOW_END)).toMatchObject({
      ok: true,
      value: { postedAt: "2026-08-05T05:02:03.000Z", precision: "timestamp" },
    });
    expect(parsePostingDateStrict("2026-08-05", WINDOW_END)).toEqual({
      ok: false,
      reason: "ambiguous_date",
    });
  });

  test("models rounded relative labels as conservative time intervals", () => {
    expect(parsePostingDateStrict("1 day ago", WINDOW_END)).toMatchObject({
      ok: true,
      value: {
        postedAt: "2026-08-05T18:00:00.000Z",
        earliestPossibleAt: WINDOW_START,
        precision: "relative_day",
      },
    });
    expect(parsePostingDateStrict("today", WINDOW_END)).toEqual({
      ok: false,
      reason: "ambiguous_date",
    });
  });

  test.each(["just now", "just posted", "moments ago"])(
    "treats %s as an exact reference-time timestamp",
    (label) => {
      expect(parsePostingDateStrict(label, WINDOW_END)).toEqual({
        ok: true,
        value: {
          postedAt: WINDOW_END,
          earliestPossibleAt: WINDOW_END,
          latestPossibleAt: WINDOW_END,
          precision: "relative_minute",
        },
      });
    }
  );
});

describe("auditable exact 48-hour filtering", () => {
  test("includes exact boundaries and excludes every unproven date with a reason", () => {
    const result = filterItemsToDateWindow([
      { id: "at-start", date_posted: WINDOW_START },
      { id: "at-end", date_posted: WINDOW_END },
      { id: "just-posted", date_posted: "just posted" },
      { id: "47-hours", date_posted: "47 hours ago" },
      { id: "one-day", date_posted: "1 day ago" },
      { id: "before", date_posted: "2026-08-04T17:59:59.999Z" },
      { id: "after", date_posted: "2026-08-06T18:00:00.001Z" },
      { id: "crosses-boundary", date_posted: "48 hours ago" },
      { id: "date-only", date_posted: "2026-08-05" },
      { id: "unknown", date_posted: "recently" },
      { id: "missing" },
    ], {
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      referenceTime: WINDOW_END,
    });

    expect(result.included.map((item) => item.id)).toEqual([
      "at-start",
      "at-end",
      "just-posted",
      "47-hours",
      "one-day",
    ]);
    expect(result.included.find((item) => item.id === "47-hours")?.date_posted)
      .toBe("2026-08-04T19:00:00.000Z");
    expect(result.excluded.map((entry) => [entry.item.id, entry.reason])).toEqual([
      ["before", "before_window"],
      ["after", "after_window"],
      ["crosses-boundary", "ambiguous_date"],
      ["date-only", "ambiguous_date"],
      ["unknown", "unparseable_date"],
      ["missing", "missing_date"],
    ]);
    expect(result.reasonCounts).toEqual({
      missing_date: 1,
      unparseable_date: 1,
      ambiguous_date: 2,
      before_window: 1,
      after_window: 1,
    });
  });

  test("rejects malformed or inverted windows", () => {
    expect(() => filterItemsToDateWindow([], {
      windowStart: WINDOW_END,
      windowEnd: WINDOW_START,
    })).toThrow(/windowStart before windowEnd/);
  });

  test("uses scrape time for relative labels and rejects jobs after immutable midnight", () => {
    const result = filterItemsToDateWindow([
      { id: "future-just-posted", date_posted: "just posted" },
      { id: "midnight-one-hour-ago", date_posted: "1 hour ago" },
    ], {
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      referenceStartTime: WINDOW_END,
      referenceTime: "2026-08-06T19:00:00.000Z",
    });

    expect(result.included.map((item) => item.id)).toEqual(["midnight-one-hour-ago"]);
    expect(result.excluded.map((entry) => [entry.item.id, entry.reason])).toEqual([
      ["future-just-posted", "ambiguous_date"],
    ]);
  });
});
