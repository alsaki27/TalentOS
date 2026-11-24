import { describe, expect, it } from "vitest";
import { activityDate, activityDateLabel, activityInDateRange, activityPage, readActivityCursor, readActivityDateRange, safeActivityUrl, type CandidateActivityItem } from "@/lib/candidateActivity";
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
  it("accepts valid complete and one-sided date ranges, including leap days", () => {
    expect(readActivityDateRange(new URLSearchParams())).toEqual({});
    expect(readActivityDateRange(new URLSearchParams("dateStart=&dateEnd="))).toEqual({});
    expect(readActivityDateRange(new URLSearchParams("dateStart=2024-02-29"))).toEqual({ dateStart: "2024-02-29" });
    expect(readActivityDateRange(new URLSearchParams("dateEnd=2026-11-24"))).toEqual({ dateEnd: "2026-11-24" });
    expect(readActivityDateRange(new URLSearchParams("dateStart=2026-11-24&dateEnd=2026-11-24"))).toEqual({ dateStart: "2026-11-24", dateEnd: "2026-11-24" });
  });
  it.each(["dateStart=2026-02-29", "dateEnd=2026-11-31", "dateStart=tomorrow", "dateStart=2026-11-24T00:00:00Z", "dateStart=2026-11-25&dateEnd=2026-11-24"])("rejects malformed or reversed date filters: %s", search => {
    expect(() => readActivityDateRange(new URLSearchParams(search))).toThrow();
  });
  it("includes the full first and last calendar days in the displayed timezone", () => {
    const range = { dateStart: "2026-11-24", dateEnd: "2026-11-24" };
    const event = (at: string) => ({ ...item("boundary", at), timeZone: "America/New_York" });
    expect(activityInDateRange(event("2026-11-24T04:59:59.999Z"), range)).toBe(false);
    expect(activityInDateRange(event("2026-11-24T05:00:00.000Z"), range)).toBe(true);
    expect(activityInDateRange(event("2026-11-25T04:59:59.999Z"), range)).toBe(true);
    expect(activityInDateRange(event("2026-11-25T05:00:00.000Z"), range)).toBe(false);
    expect(activityInDateRange({ ...event("2026-11-23T18:00:00.000Z"), timeZone: "Asia/Dhaka" }, range)).toBe(true);
  });
  it("keeps date-only activities unchanged and uses UTC when a timezone is missing or invalid", () => {
    const range = { dateStart: "2026-11-24", dateEnd: "2026-11-24" };
    expect(activityInDateRange({ ...item("day", "2026-11-24"), dateOnly: true, timeZone: "America/Los_Angeles" }, range)).toBe(true);
    expect(activityInDateRange({ ...item("missing", "2026-11-24T00:00:00Z"), timeZone: null }, range)).toBe(true);
    expect(activityInDateRange({ ...item("invalid", "2026-11-24T00:00:00Z"), timeZone: "invalid" }, range)).toBe(true);
    expect(activityInDateRange(item("any"), {})).toBe(true);
  });
  it("handles daylight-saving transitions without assuming every calendar day is 24 hours", () => {
    const range = { dateStart: "2026-03-08", dateEnd: "2026-03-08" };
    const event = (at: string) => ({ ...item("dst", at), timeZone: "America/New_York" });
    expect(activityInDateRange(event("2026-03-08T04:59:59Z"), range)).toBe(false);
    expect(activityInDateRange(event("2026-03-08T05:00:00Z"), range)).toBe(true);
    expect(activityInDateRange(event("2026-03-09T03:59:59Z"), range)).toBe(true);
    expect(activityInDateRange(event("2026-03-09T04:00:00Z"), range)).toBe(false);
  });
});
