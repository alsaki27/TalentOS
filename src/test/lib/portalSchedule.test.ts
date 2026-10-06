import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  buildScheduleEvents,
  clampEndMinute,
  dateKeyOf,
  defaultDisplayZone,
  eventDayKey,
  formatDateOnly,
  formatWeekRange,
  gridHourRange,
  interviewBucket,
  layoutDayColumns,
  weekKeys,
  zonedMinuteOfDay,
  type PortalInterview,
  type PortalMockSessionSummary,
} from "@/lib/portalSchedule";

const NOW = new Date("2026-08-12T16:00:00.000Z");

function interview(overrides: Partial<PortalInterview> = {}): PortalInterview {
  return {
    id: "schedule-1",
    application_id: "application-1",
    job_id: "job-1",
    job_title: "Analyst",
    company_name: "Acme",
    location: null,
    job_location: "Remote",
    job_posting_url: null,
    round_name: "Interview",
    round_number: 1,
    scheduled_at: "2026-08-20T15:00:00.000Z",
    time_zone: "America/Chicago",
    duration_minutes: 45,
    status: "upcoming",
    interview_status: "scheduled",
    interview_format: "online",
    meeting_link: "https://meet.example/abc",
    panel: ["Recruiter"],
    visible_updates: [],
    ...overrides,
  };
}

function mock(overrides: Partial<PortalMockSessionSummary> = {}): PortalMockSessionSummary {
  return {
    id: "mock-1",
    session_date: "2026-08-14",
    target_role: "Data Analyst",
    round_type: "Behavioral",
    evaluator: "Mayukh",
    overall_score: 8,
    overall_score_max: 10,
    feedback_summary: null,
    strengths_noted: null,
    areas_for_improvement: null,
    has_audit_report: true,
    has_transcript: false,
    ...overrides,
  };
}

describe("interview buckets", () => {
  it("classifies future, past, cancelled, and undated interviews", () => {
    expect(interviewBucket(interview(), NOW)).toBe("upcoming");
    expect(interviewBucket(interview({ scheduled_at: "2026-08-01T15:00:00.000Z" }), NOW)).toBe("past");
    expect(interviewBucket(interview({ interview_status: "cancelled", status: "cancelled" }), NOW)).toBe("cancelled");
    expect(interviewBucket(interview({ scheduled_at: null, status: "not_scheduled" }), NOW)).toBe("unscheduled");
  });

  it("treats completed interviews as past even when the time is still ahead", () => {
    expect(interviewBucket(interview({ interview_status: "completed", status: "completed" }), NOW)).toBe("past");
  });
});

describe("zone placement", () => {
  it("places the same instant at different minutes in each display zone", () => {
    const instant = "2026-08-12T15:00:00.000Z";
    expect(zonedMinuteOfDay(instant, "America/New_York")).toBe(11 * 60);
    expect(zonedMinuteOfDay(instant, "America/Chicago")).toBe(10 * 60);
    expect(zonedMinuteOfDay(instant, "America/Los_Angeles")).toBe(8 * 60);
  });

  it("returns null for an invalid instant instead of a bogus minute", () => {
    expect(zonedMinuteOfDay("not-a-date", "America/New_York")).toBeNull();
  });

  it("assigns the calendar day in the display zone, not in UTC", () => {
    // 02:30 UTC on Aug 13 is still Aug 12 evening in Eastern Time.
    const event = buildScheduleEvents([interview({ scheduled_at: "2026-08-13T02:30:00.000Z", time_zone: "America/New_York" })], [], NOW)[0];
    expect(eventDayKey(event, "America/New_York")).toBe("2026-08-12");
    expect(eventDayKey(event, "America/Los_Angeles")).toBe("2026-08-12");
  });

  it("opens the grid in the next upcoming interview's zone, else Eastern", () => {
    const events = buildScheduleEvents([interview({ time_zone: "America/Denver" })], [], NOW);
    expect(defaultDisplayZone(events)).toBe("America/Denver");
    expect(defaultDisplayZone(buildScheduleEvents([], [], NOW))).toBe("America/New_York");
  });
});

describe("mock interviews", () => {
  it("places a date-only mock session on its calendar date as an all-day item", () => {
    const [event] = buildScheduleEvents([], [mock({ session_date: "2026-08-14" })], NOW);
    expect(event.kind).toBe("mock");
    expect(event.startsAt).toBeNull();
    expect(event.dateKey).toBe("2026-08-14");
    expect(event.href).toBe("/portal/interviews/mock/mock-1");
    expect(event.bucket).toBe("upcoming");
  });

  it("marks a mock session past once its date has gone", () => {
    const [event] = buildScheduleEvents([], [mock({ session_date: "2026-08-01" })], NOW);
    expect(event.bucket).toBe("past");
  });

  it("drops a mock session whose date cannot be read", () => {
    expect(buildScheduleEvents([], [mock({ session_date: "bad" })], NOW)).toHaveLength(0);
    expect(dateKeyOf("2026-08-14T00:00:00.000Z")).toBe("2026-08-14");
  });
});

describe("interview links", () => {
  it("links each interview to its application page, anchored to that interview", () => {
    const [event] = buildScheduleEvents([interview({ id: "schedule-9", application_id: "app-7" })], [], NOW);
    expect(event.href).toBe("/portal/applications/app-7#interview-schedule-9");
  });

  it("keeps an unscheduled interview off the grid", () => {
    const [event] = buildScheduleEvents([interview({ id: null, scheduled_at: null, status: "not_scheduled", interview_status: null })], [], NOW);
    expect(event.bucket).toBe("unscheduled");
    expect(event.startsAt).toBeNull();
    expect(event.timeZone).toBeNull();
  });
});

describe("overlap layout", () => {
  it("gives non-overlapping items the full day width", () => {
    const placed = layoutDayColumns([
      { item: "a", startMinute: 540, endMinute: 600 },
      { item: "b", startMinute: 660, endMinute: 720 },
    ]);
    expect(placed.map((p) => [p.column, p.columns])).toEqual([[0, 1], [0, 1]]);
  });

  it("splits overlapping items into side-by-side lanes", () => {
    const placed = layoutDayColumns([
      { item: "a", startMinute: 540, endMinute: 630 },
      { item: "b", startMinute: 570, endMinute: 600 },
      { item: "c", startMinute: 610, endMinute: 660 },
    ]);
    const byItem = Object.fromEntries(placed.map((p) => [p.item, p]));
    expect(byItem.a.columns).toBe(2);
    expect(byItem.b.columns).toBe(2);
    expect(byItem.a.column).not.toBe(byItem.b.column);
    // c starts after b ends, so it reuses b's lane instead of opening a third.
    expect(byItem.c.column).toBe(byItem.b.column);
  });

  it("widens the grid hour range to include early and late events", () => {
    expect(gridHourRange([])).toEqual({ startHour: 8, endHour: 18 });
    expect(gridHourRange([{ startMinute: 6 * 60 + 30, endMinute: 19 * 60 + 15 }])).toEqual({ startHour: 6, endHour: 20 });
  });

  it("clamps an event that runs past midnight to the end of the day", () => {
    expect(clampEndMinute(23 * 60 + 30, 90)).toBe(24 * 60);
    expect(clampEndMinute(9 * 60, null)).toBe(10 * 60);
  });
});

describe("date labels", () => {
  it("formats a date-only key without any zone shifting the day", () => {
    expect(formatDateOnly("2026-08-14")).toBe("Aug 14, 2026");
  });

  it("returns a malformed key unchanged instead of throwing", () => {
    expect(formatDateOnly("not-a-date")).toBe("not-a-date");
    expect(formatDateOnly("2026-13-45")).toBe("2026-13-45");
  });
});

describe("week math", () => {
  it("builds a Monday-first week for any anchor day", () => {
    // 2026-08-12 is a Wednesday.
    expect(weekKeys("2026-08-12")).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16",
    ]);
    // A Sunday belongs to the week that started the Monday before it.
    expect(weekKeys("2026-08-16")[0]).toBe("2026-08-10");
  });

  it("moves across month and year boundaries", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("formats a week range within one month and across two", () => {
    expect(formatWeekRange(weekKeys("2026-08-12"))).toBe("Aug 10 – 16, 2026");
    expect(formatWeekRange(weekKeys("2026-08-31"))).toBe("Aug 31 – Sep 6, 2026");
  });
});
