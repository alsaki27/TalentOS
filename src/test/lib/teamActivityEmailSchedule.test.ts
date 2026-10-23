import { describe, expect, it } from "vitest";
import { getDueTeamActivityReportPeriods } from "@/lib/teamActivityEmailSchedule";

describe("team activity report schedule", () => {
  it("runs daily at 5 PM Eastern during daylight time", () => {
    expect(getDueTeamActivityReportPeriods(new Date("2026-10-23T21:00:00.000Z"))).toEqual(["daily"]);
  });

  it("runs daily at 5 PM Eastern during standard time", () => {
    expect(getDueTeamActivityReportPeriods(new Date("2026-11-02T22:00:00.000Z"))).toEqual(["daily"]);
  });

  it("runs the weekly report on Sunday at 6 PM Eastern in daylight time", () => {
    expect(getDueTeamActivityReportPeriods(new Date("2026-10-25T22:00:00.000Z"))).toEqual(["weekly"]);
  });

  it("runs the weekly report on Sunday at 6 PM Eastern in standard time", () => {
    expect(getDueTeamActivityReportPeriods(new Date("2026-11-01T23:00:00.000Z"))).toEqual(["weekly"]);
  });

  it("runs the daily report separately from the Sunday weekly report", () => {
    expect(getDueTeamActivityReportPeriods(new Date("2026-10-25T21:00:00.000Z"))).toEqual(["daily"]);
  });

  it("ignores cron minutes outside the scheduled report times", () => {
    expect(getDueTeamActivityReportPeriods(new Date("2026-10-23T21:01:00.000Z"))).toEqual([]);
    expect(getDueTeamActivityReportPeriods(new Date("2026-10-24T22:00:00.000Z"))).toEqual([]);
  });
});
