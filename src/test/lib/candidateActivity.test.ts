import { describe, expect, it } from "vitest";
import { activityDate, activityDateLabel, activityPage, readActivityCursor, safeActivityUrl, type CandidateActivityItem } from "@/lib/candidateActivity";
import { initialCandidateProfileTab } from "@/lib/candidateProfileTabs";

const item = (id: string, at = "2026-11-23T12:00:00.000Z"): CandidateActivityItem => ({ id, candidateId: "candidate", at, type: "training", title: "Note", summary: "", dateOnly: false, timeZone: null, details: [], links: [] });
describe("Candidate activity boundaries", () => {
  it("paginates identical timestamps without duplicates or skipped records", () => {
    const items = Array.from({ length: 18 }, (_, index) => item(String(index).padStart(2, "0")));
    const first = activityPage([...items, items[0]], 7, null);
    expect(first.total).toBe(18);
    const second = activityPage(items, 7, readActivityCursor(first.nextCursor));
    const third = activityPage(items, 7, readActivityCursor(second.nextCursor));
    expect(new Set([...first.items, ...second.items, ...third.items].map((row) => row.id)).size).toBe(18);
    expect(third.nextCursor).toBeNull();
  });
  it("keeps recorded date-only dates and rejects missing or malformed dates", () => {
    expect(activityDate("2026-02-30")).toBeNull();
    expect(activityDate("Not Provided")).toBeNull();
    expect(activityDate("2026-11")).toBeNull();
    expect(activityDate("2026-11-23T12:00:00")).toBeNull();
    expect(activityDate("2026-02-30T12:00:00Z")).toBeNull();
    expect(activityDate("2026-11-23")).toBe("2026-11-23");
    expect(activityDateLabel("2026-11-23", true, "America/Los_Angeles")).toBe("Nov 23, 2026");
    expect(activityDate(new Date("2026-11-23T12:00:00Z"))).toBe("2026-11-23T12:00:00.000Z");
  });
  it("rejects invalid cursors and unsafe links", () => {
    for (const cursor of ["{}", "garbage", '["tomorrow","id"]', '["2026-11-23",""]']) expect(() => readActivityCursor(cursor)).toThrow();
    for (const link of ["javascript:alert(1)", "//evil.example", "/\\evil.example", "https://user:pass@example.com", "/\t/evil.example"]) expect(safeActivityUrl(link)).toBeNull();
    expect(safeActivityUrl("/candidates/id?tab=Training%20Audit")).toBeTruthy();
    expect(safeActivityUrl("https://example.com/meeting")).toBeTruthy();
  });
  it("opens source tabs directly and preserves the old resume-files link", () => {
    for (const tab of ["Training Audit", "OPT Status", "Profile Overview"] as const) expect(initialCandidateProfileTab(tab)).toBe(tab);
    expect(initialCandidateProfileTab("Resume Files")).toBe("Base Resumes");
    expect(initialCandidateProfileTab("unknown")).toBe("Applications");
  });
});
