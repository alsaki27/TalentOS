import { describe, expect, it } from "vitest";
import { getDueEmailReminderSlot } from "@/lib/emailReminderSchedule";

describe("email reminder delivery schedule", () => {
  it("uses the 08:00 Bangladesh slot and a rolling 12-hour window", () => {
    const slot = getDueEmailReminderSlot(new Date("2026-11-01T02:04:00.000Z"));
    expect(slot?.key).toBe("2026-11-01T08:00+06:00");
    expect(slot?.windowEnd.toISOString()).toBe("2026-11-01T02:00:00.000Z");
    expect(slot?.windowStart.toISOString()).toBe("2026-10-31T14:00:00.000Z");
  });

  it("uses the 20:00 slot, retries the same slot for 15 minutes, then waits", () => {
    expect(getDueEmailReminderSlot(new Date("2026-11-01T14:14:00.000Z"))?.key).toBe("2026-11-01T20:00+06:00");
    expect(getDueEmailReminderSlot(new Date("2026-11-01T14:15:00.000Z"))).toBeNull();
    expect(getDueEmailReminderSlot(new Date("2026-11-01T14:00:00.000Z"))?.key).toBe("2026-11-01T20:00+06:00");
  });
});
