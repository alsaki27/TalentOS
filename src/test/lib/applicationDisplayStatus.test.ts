import { describe, expect, it } from "vitest";
import { applicationDashboardStatusGroup, countApplicationStatusRows } from "@/lib/applicationDisplayStatus";

describe("applicationDashboardStatusGroup", () => {
  it("keeps the same six display buckets used by candidate application dashboards", () => {
    expect(applicationDashboardStatusGroup("applied", null, false)).toBe("Applied");
    expect(applicationDashboardStatusGroup("assigned", null, false)).toBe("In Progress");
    expect(applicationDashboardStatusGroup("replied", null, false)).toBe("Screening");
    expect(applicationDashboardStatusGroup("offer", null, false)).toBe("Offer");
    expect(applicationDashboardStatusGroup("withdrawn", null, false)).toBe("Rejected");
  });

  it("counts scheduled stages as interviews while preserving final outcomes", () => {
    expect(applicationDashboardStatusGroup("applied", null, true)).toBe("Interview");
    expect(applicationDashboardStatusGroup("applied", "interview", false)).toBe("Interview");
    expect(applicationDashboardStatusGroup("offer", "interview", true)).toBe("Offer");
    expect(applicationDashboardStatusGroup("rejected", "interview", true)).toBe("Rejected");
  });

  it("keeps the status bucket when a closed application has a final stage marker", () => {
    expect(applicationDashboardStatusGroup("applied", "closed", false)).toBe("Applied");
  });

  it("respects a custom interview's saved status after moving backward with existing interview rounds", () => {
    expect(applicationDashboardStatusGroup("replied", "screening", true, "custom_interview")).toBe("Screening");
    expect(applicationDashboardStatusGroup("applied", "applied", true, "custom_interview")).toBe("Applied");
    expect(applicationDashboardStatusGroup("assigned", "ready_for_review", true, "custom_interview")).toBe("In Progress");
    expect(applicationDashboardStatusGroup("interview", "interview", true, "custom_interview")).toBe("Interview");
    expect(countApplicationStatusRows([
      {status: "replied", application_stage: "screening", has_active_interview: true, source_type: "custom_interview"},
      {status: "applied", application_stage: "applied", has_active_interview: true, source_type: "custom_interview"},
      {status: "assigned", application_stage: "ready_for_review", has_active_interview: true, source_type: "custom_interview"},
    ])).toEqual({Applied: 1, "In Progress": 1, Screening: 1, Interview: 0, Offer: 0, Rejected: 0});
  });

  it("counts interview state per application instead of promoting its whole status group", () => {
    expect(countApplicationStatusRows([
      { status: "assigned", application_stage: "in_progress", has_active_interview: true },
      { status: "assigned", application_stage: "in_progress", has_active_interview: false },
      { status: "assigned", application_stage: "in_progress", has_active_interview: false },
    ])).toEqual({
      Applied: 0,
      "In Progress": 2,
      Screening: 0,
      Interview: 1,
      Offer: 0,
      Rejected: 0,
    });
  });
});
