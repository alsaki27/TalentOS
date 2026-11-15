import { describe, expect, it } from "vitest";
import { getInterviewBookingIdentity, getSingleInterviewCalendarInvite, parseInterviewCalendarInvite } from "@/lib/integrations/interviewCalendarInvite";

function invite(fields: string[], method = "REQUEST") {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:" + method, "BEGIN:VEVENT", ...fields, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

describe("interview invite identity", () => {
  it("keeps the Outlook UID across time changes and reads the actual start with its timezone", () => {
    const first = parseInterviewCalendarInvite(invite(["UID:stable", "DTSTART;TZID=Eastern Standard Time:20261116T120000",
      "DTEND;TZID=Eastern Standard Time:20261116T124500", "DTSTAMP:20261111T200118Z"]));
    const later = parseInterviewCalendarInvite(invite(["UID:stable", "DTSTART;TZID=Eastern Standard Time:20261117T120000",
      "DTSTAMP:20261112T200118Z", "SEQUENCE:2"]));
    expect(first).toMatchObject({ scheduledAt: "2026-11-16T17:00:00.000Z", sequence: 0, durationMinutes: 45 });
    expect(later).toMatchObject({ key: first?.key, scheduledAt: "2026-11-17T17:00:00.000Z", sequence: 2 });
    expect(getSingleInterviewCalendarInvite([invite(["UID:stable"]), invite(["UID:different"])])).toBeNull();
  });

  it("distinguishes recurring instances and accepts a targeted cancellation without a start", () => {
    const base = ["UID:recurring", "DTSTART:20261116T120000Z"];
    const one = parseInterviewCalendarInvite(invite([...base, "RECURRENCE-ID:20261116T120000Z"]));
    const two = parseInterviewCalendarInvite(invite([...base, "RECURRENCE-ID:20261123T120000Z"]));
    const cancel = parseInterviewCalendarInvite(invite(["UID:recurring", "RECURRENCE-ID:20261116T120000Z"], "CANCEL"));
    expect(one?.key).not.toBe(two?.key);
    expect(cancel).toMatchObject({ key: one?.key, cancelled: true, scheduledAt: null });
    expect(parseInterviewCalendarInvite(invite([...base, "RRULE:FREQ=WEEKLY"]))).toBeNull();
  });

  it("uses one stable Actalent booking and keeps the bearer-like link identifier out of storage", async () => {
    const host = "https://talentassistant.actalentservices.com/assistant/bookings/";
    const id = "demoToken01";
    const key = await getInterviewBookingIdentity("Reschedule Meeting<" + host + "reschedule/" + id + ">");
    expect(key).toMatch(/^actalent-booking:[a-f0-9]{64}$/);
    expect(key).not.toContain(id);
    expect(await getInterviewBookingIdentity(host + "cancel/" + id)).toBe(key);
    expect(await getInterviewBookingIdentity(host + "cancel/" + id + " " + host + "reschedule/demoToken02")).toBeNull();
  });
});
