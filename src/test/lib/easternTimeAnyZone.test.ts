// Coverage for the any-zone helpers added for candidate-timezone display. These are
// deliberately separate from the existing interview-scheduling helpers (formatZonedDateTime
// etc.), which are restricted to the 5 interview zones and silently fall back to Eastern for
// anything else - correct for interview scheduling, wrong for a candidate's own timezone,
// which can legitimately be outside that set.
import { describe, it, expect } from "vitest";
import { isValidIanaTimeZone, formatAnyZonedDateTime, formatAnyZonedTime, utcOffsetHours } from "@/lib/easternTime";

describe("isValidIanaTimeZone", () => {
  it("accepts a zone outside the 5 interview-scheduling zones", () => {
    expect(isValidIanaTimeZone("America/Anchorage")).toBe(true);
    expect(isValidIanaTimeZone("Pacific/Honolulu")).toBe(true);
    expect(isValidIanaTimeZone("Asia/Dhaka")).toBe(true);
  });

  it("accepts the interview zones too (a superset, not a different set)", () => {
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("America/Phoenix")).toBe(true);
  });

  it("rejects a made-up/invalid zone", () => {
    expect(isValidIanaTimeZone("Not/A_Zone")).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(isValidIanaTimeZone(null)).toBe(false);
    expect(isValidIanaTimeZone(undefined)).toBe(false);
    expect(isValidIanaTimeZone("")).toBe(false);
  });
});

describe("formatAnyZonedDateTime / formatAnyZonedTime", () => {
  it("formats a real instant in a non-interview zone (does not silently substitute Eastern)", () => {
    const formatted = formatAnyZonedDateTime("2026-06-15T12:00:00.000Z", "Asia/Dhaka");
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("2026");
    // Dhaka is UTC+6 year-round, no DST - 12:00 UTC is 18:00 local.
    expect(formatted).toMatch(/6:00\s*PM/i);
  });

  it("returns null for an invalid zone rather than guessing", () => {
    expect(formatAnyZonedDateTime("2026-06-15T12:00:00.000Z", "Not/A_Zone")).toBeNull();
    expect(formatAnyZonedTime("2026-06-15T12:00:00.000Z", "Not/A_Zone")).toBeNull();
  });

  it("returns null for missing input", () => {
    expect(formatAnyZonedDateTime(null, "Asia/Dhaka")).toBeNull();
    expect(formatAnyZonedDateTime("2026-06-15T12:00:00.000Z", null)).toBeNull();
  });
});

describe("utcOffsetHours", () => {
  it("computes Dhaka's fixed +6 offset", () => {
    expect(utcOffsetHours("2026-06-15T12:00:00.000Z", "Asia/Dhaka")).toBe(6);
  });

  it("computes a negative offset (US Eastern, summer DST)", () => {
    // 2026-06-15 is within US DST - Eastern is UTC-4 then.
    expect(utcOffsetHours("2026-06-15T12:00:00.000Z", "America/New_York")).toBe(-4);
  });

  it("computes a half-hour offset zone", () => {
    expect(utcOffsetHours("2026-06-15T12:00:00.000Z", "Asia/Kolkata")).toBe(5.5);
  });

  it("returns null for an invalid zone", () => {
    expect(utcOffsetHours("2026-06-15T12:00:00.000Z", "Not/A_Zone")).toBeNull();
  });
});
