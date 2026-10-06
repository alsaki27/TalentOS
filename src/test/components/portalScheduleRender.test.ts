import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScheduleWeekCalendar from "@/components/portal/schedule/ScheduleWeekCalendar";
import ScheduleAgenda from "@/components/portal/schedule/ScheduleAgenda";
import TrainingAuditTab from "@/components/portal/schedule/TrainingAuditTab";
import CandidatePortalMockInterviewDetail from "@/components/portal/schedule/CandidatePortalMockInterviewDetail";
import { MockTranscriptViewer } from "@/components/portal/schedule/MockReportSections";
import {
  buildScheduleEvents,
  weekKeys,
  type PortalInterview,
  type PortalMockSessionDetail,
  type PortalMockSessionSummary,
  type PortalTrainingAudit,
} from "@/lib/portalSchedule";

// Wednesday 12 Aug 2026, 16:00 UTC. The week is Mon 10 - Sun 16 Aug.
const NOW = new Date("2026-08-12T16:00:00.000Z");
const WEEK = weekKeys("2026-08-12");

const interview: PortalInterview = {
  id: "schedule-1",
  application_id: "application-1",
  job_id: "job-1",
  job_title: "Analyst",
  company_name: "Acme",
  location: null,
  job_location: null,
  job_posting_url: null,
  round_name: "Interview",
  round_number: 1,
  // 15:00 UTC = 10:00 AM Chicago (CDT) = 11:00 AM New York (EDT).
  scheduled_at: "2026-08-13T15:00:00.000Z",
  time_zone: "America/Chicago",
  duration_minutes: 45,
  status: "upcoming",
  interview_status: "scheduled",
  interview_format: "online",
  meeting_link: "https://meet.example/abc",
  panel: ["Recruiter"],
  visible_updates: [],
};

const mock: PortalMockSessionSummary = {
  id: "mock-1",
  session_date: "2026-08-14",
  target_role: "Data Analyst",
  round_type: "Behavioral",
  evaluator: "Mayukh",
  overall_score: 8.5,
  overall_score_max: 10,
  feedback_summary: "Clear structure.",
  strengths_noted: null,
  areas_for_improvement: null,
  has_audit_report: false,
  has_transcript: true,
};

describe("schedule week grid", () => {
  it("places an interview at its time in the display zone, not in its saved zone", () => {
    const events = buildScheduleEvents([interview], [mock], NOW, "America/New_York");
    const markup = renderToStaticMarkup(createElement(ScheduleWeekCalendar, { events, days: WEEK, zone: "America/New_York", now: NOW }));
    // The card shows the range in the display zone: 11:00 to 11:45 AM Eastern.
    // ICU versions differ in the space before AM (plain, narrow no-break), so match any whitespace.
    expect(markup).toContain('class="psc-block-time">11:00');
    expect(markup).toMatch(/11:45\s+AM/);
    expect(markup).not.toContain(">10:00");
  });

  it("shows the same interview at the Chicago wall-clock time when Chicago is the display zone", () => {
    const events = buildScheduleEvents([interview], [mock], NOW, "America/Chicago");
    const markup = renderToStaticMarkup(createElement(ScheduleWeekCalendar, { events, days: WEEK, zone: "America/Chicago", now: NOW }));
    expect(markup).toContain('class="psc-block-time">10:00');
    expect(markup).toMatch(/10:45\s+AM/);
  });

  it("puts a mock session in the all-day row of its date and links it to the detail page", () => {
    const events = buildScheduleEvents([], [mock], NOW, "America/New_York");
    const markup = renderToStaticMarkup(createElement(ScheduleWeekCalendar, { events, days: WEEK, zone: "America/New_York", now: NOW }));
    expect(markup).toContain('href="/portal/interviews/mock/mock-1"');
    expect(markup).toContain("psc-chip-mock");
  });
});

describe("schedule agenda", () => {
  it("shows each interview in its own saved zone and links to its anchored application section", () => {
    const events = buildScheduleEvents([interview], [], NOW, "America/New_York");
    const markup = renderToStaticMarkup(createElement(ScheduleAgenda, {
      events, zone: "America/New_York", now: NOW, tab: "upcoming", onTabChange: () => undefined,
    }));
    expect(markup).toMatch(/10:00\s+AM/);
    expect(markup).toContain("CDT");
    expect(markup).toContain('href="/portal/applications/application-1#interview-schedule-1"');
    expect(markup).toContain("Upcoming (1)");
  });

  it("lists cancelled and past items only under their own tab", () => {
    const cancelled: PortalInterview = { ...interview, id: "schedule-2", interview_status: "cancelled", status: "cancelled" };
    const events = buildScheduleEvents([cancelled], [], NOW, "America/New_York");
    const upcoming = renderToStaticMarkup(createElement(ScheduleAgenda, {
      events, zone: "America/New_York", now: NOW, tab: "upcoming", onTabChange: () => undefined,
    }));
    const cancelledTab = renderToStaticMarkup(createElement(ScheduleAgenda, {
      events, zone: "America/New_York", now: NOW, tab: "cancelled", onTabChange: () => undefined,
    }));
    expect(upcoming).toContain("Nothing upcoming");
    expect(cancelledTab).toContain("Cancelled (1)");
    expect(cancelledTab).toContain("psc-status-cancelled");
  });
});

describe("training audit tab", () => {
  const audit: PortalTrainingAudit = {
    linked: true,
    student: {
      domain: "Data",
      target_role: "Analyst",
      progress: 62,
      synced_at: null,
      placement: { company: "Acme", role: "Analyst", date: "2026-07-01" },
    },
    mockInterviewCount: 1,
    mockSessions: [mock],
  };

  it("lists mock sessions with links to their full report and the placement", () => {
    const markup = renderToStaticMarkup(createElement(TrainingAuditTab, { audit, loading: false, error: "" }));
    expect(markup).toContain("Mock interview history (1)");
    expect(markup).toContain('href="/portal/interviews/mock/mock-1"');
    expect(markup).toContain("8.5 / 10");
    expect(markup).toContain("Placed as Analyst at Acme");
  });

  it("explains when the training record is not linked yet", () => {
    const markup = renderToStaticMarkup(createElement(TrainingAuditTab, {
      audit: { linked: false, student: null, mockInterviewCount: 0, mockSessions: [] }, loading: false, error: "",
    }));
    expect(markup).toContain("will appear here once your training record is linked");
  });
});

describe("mock interview detail", () => {
  const session: PortalMockSessionDetail = {
    ...mock,
    raw_analysis_text: null,
    transcript_raw_text: "Mayukh [0:03]: Tell me about yourself.\n\nJane Doe [0:10]: I analysed sales data for two years.",
  };

  it("renders the result, evaluator, and an empty audit state when no report exists", () => {
    const markup = renderToStaticMarkup(createElement(CandidatePortalMockInterviewDetail, { session }));
    expect(markup).toContain("Behavioral");
    expect(markup).toContain("out of 10");
    expect(markup).toContain("Mayukh");
    expect(markup).toContain("The audit report has not been added");
    expect(markup).toContain("/portal/interviews?tab=training");
  });

  it("does not crash on a malformed session date", () => {
    const markup = renderToStaticMarkup(createElement(CandidatePortalMockInterviewDetail, {
      session: { ...session, session_date: "not-a-date" },
    }));
    expect(markup).toContain("not-a-date");
  });

  it("lays the transcript out as a conversation with the candidate on the right", () => {
    const markup = renderToStaticMarkup(createElement(MockTranscriptViewer, { rawText: session.transcript_raw_text }));
    expect(markup).toContain("Showing 2 of 2 lines");
    expect(markup).toContain("psc-bubble-row-candidate");
    expect(markup).toContain("I analysed sales data");
    expect(markup).toContain("0:03");
  });

  it("shows the transcript empty state when none was saved", () => {
    const markup = renderToStaticMarkup(createElement(MockTranscriptViewer, { rawText: null }));
    expect(markup).toContain("No transcript has been added");
  });
});
