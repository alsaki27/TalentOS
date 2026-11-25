import { describe, expect, it } from "vitest";
import { TEAM_ROLE_KEYS, getTeamRoleStorage } from "@/lib/auth-edge";
import { canEditCustomActivity, canManageCustomActivity, customActivityState, parseCustomActivity, type CandidateCustomActivity } from "@/lib/candidateCustomActivity";
const base = { title: "Vacation", body: "Away with family", schedule_mode: "none" };
describe("Custom activity validation and permissions", () => {
  it("requires title and reason and rejects unsafe links", () => {
    for (const value of [{ ...base, title: " " }, { ...base, body: "" }, { ...base, link: "javascript:alert(1)" }, { ...base, link: "//example.com" }]) expect(() => parseCustomActivity(value)).toThrow();
    expect(parseCustomActivity(base)).toMatchObject({ title: "Vacation", body: "Away with family", start_date: null });
  });
  it("keeps all-day vacation dates without converting them to another calendar day", () => {
    const activity = parseCustomActivity({ ...base, schedule_mode: "date_range", start_date: "2026-12-01", end_date: "2026-12-05", time_zone: "Asia/Dhaka" });
    expect(activity).toMatchObject({ start_date: "2026-12-01", end_date: "2026-12-05", starts_at: null });
    expect(customActivityState(activity as CandidateCustomActivity, new Date("2026-12-02T10:00:00Z"))).toBe("in_progress");
    expect(() => parseCustomActivity({ ...activity, end_date: "2026-11-30" })).toThrow();
    expect(() => parseCustomActivity({ ...activity, start_date: "2026-02-30" })).toThrow();
  });
  it("converts valid local times and rejects reversed ranges and DST gaps", () => {
    const activity = { ...base, schedule_mode: "time_range", start_date: "2026-12-01", end_date: "2026-12-01", start_time: "09:00", end_time: "10:00", time_zone: "Asia/Dhaka" };
    expect(parseCustomActivity(activity).starts_at).toBe("2026-12-01T03:00:00.000Z");
    expect(() => parseCustomActivity({ ...activity, end_time: "08:00" })).toThrow();
    expect(() => parseCustomActivity({ ...activity, start_date: "2026-03-08", end_date: "2026-03-08", start_time: "02:30", time_zone: "America/New_York" })).toThrow();
  });
  it("allows all staff to edit and restricts creation and deletion for Grunters", () => {
    for (const key of TEAM_ROLE_KEYS) {
      const profile = getTeamRoleStorage(key);
      expect(canEditCustomActivity(profile)).toBe(true);
      expect(canManageCustomActivity(profile)).toBe(key !== "application_engineer_grunter");
    }
    expect(canEditCustomActivity(null)).toBe(false);
    expect(canManageCustomActivity(null)).toBe(false);
  });
});
