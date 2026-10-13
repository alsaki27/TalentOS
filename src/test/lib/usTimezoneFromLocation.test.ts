import { describe, it, expect } from "vitest";
import { deriveTimezoneFromLocation } from "@/lib/usTimezoneFromLocation";

describe("deriveTimezoneFromLocation", () => {
  it("resolves a plain single-timezone state via abbreviation", () => {
    expect(deriveTimezoneFromLocation("Dallas, TX")).toEqual({ timezone: "America/Chicago", state: "tx" });
  });

  it("resolves the same state via its full name, not just the abbreviation", () => {
    expect(deriveTimezoneFromLocation("Dallas, Texas")).toEqual({ timezone: "America/Chicago", state: "tx" });
  });

  it("is case-insensitive and tolerates a trailing period on the state", () => {
    expect(deriveTimezoneFromLocation("seattle, wa.")).toEqual({ timezone: "America/Los_Angeles", state: "wa" });
  });

  it("handles a trailing USA/US segment", () => {
    expect(deriveTimezoneFromLocation("Chicago, IL, USA")).toEqual({ timezone: "America/Chicago", state: "il" });
  });

  it("handles an embedded ZIP code", () => {
    expect(deriveTimezoneFromLocation("Miami, FL 33101")).toEqual({ timezone: "America/New_York", state: "fl" });
  });

  // The known split-state exceptions - this is the whole reason a state-only table isn't enough.
  it("applies the El Paso, TX -> Mountain time override (not Texas's Central default)", () => {
    expect(deriveTimezoneFromLocation("El Paso, TX")).toEqual({ timezone: "America/Denver", state: "tx" });
  });

  it("applies the Florida Panhandle -> Central time override (not Florida's Eastern default)", () => {
    expect(deriveTimezoneFromLocation("Pensacola, FL")).toEqual({ timezone: "America/Chicago", state: "fl" });
  });

  it("does not apply the Panhandle override to the rest of Florida", () => {
    expect(deriveTimezoneFromLocation("Miami, FL")).toEqual({ timezone: "America/New_York", state: "fl" });
  });

  it("applies the western-Indiana -> Central time override", () => {
    expect(deriveTimezoneFromLocation("Evansville, IN")).toEqual({ timezone: "America/Chicago", state: "in" });
  });

  it("does not apply the Indiana override to the rest of Indiana", () => {
    expect(deriveTimezoneFromLocation("Indianapolis, IN")).toEqual({ timezone: "America/New_York", state: "in" });
  });

  it("resolves Arizona with no DST handling needed (single IANA zone covers it)", () => {
    expect(deriveTimezoneFromLocation("Phoenix, AZ")).toEqual({ timezone: "America/Phoenix", state: "az" });
  });

  it("applies the North Idaho -> Pacific time override", () => {
    expect(deriveTimezoneFromLocation("Coeur d'Alene, ID")).toEqual({ timezone: "America/Los_Angeles", state: "id" });
  });

  it("does not apply the Idaho override to the rest of Idaho", () => {
    expect(deriveTimezoneFromLocation("Boise, ID")).toEqual({ timezone: "America/Denver", state: "id" });
  });

  // Things that must NOT produce a confident (possibly wrong) guess.
  it("returns null for 'Remote'", () => {
    expect(deriveTimezoneFromLocation("Remote")).toEqual({ timezone: null, state: null });
  });

  it("returns null for empty/whitespace input", () => {
    expect(deriveTimezoneFromLocation("")).toEqual({ timezone: null, state: null });
    expect(deriveTimezoneFromLocation("   ")).toEqual({ timezone: null, state: null });
  });

  it("returns null for null/undefined input", () => {
    expect(deriveTimezoneFromLocation(null)).toEqual({ timezone: null, state: null });
    expect(deriveTimezoneFromLocation(undefined)).toEqual({ timezone: null, state: null });
  });

  it("returns null for a city-only string with no state", () => {
    expect(deriveTimezoneFromLocation("Dallas")).toEqual({ timezone: null, state: null });
  });

  it("returns null for a non-US location it doesn't recognize", () => {
    expect(deriveTimezoneFromLocation("London, England")).toEqual({ timezone: null, state: null });
  });

  // Real cases found live while running the backfill script against actual candidate resume
  // data — both were silently (and wrongly) returning null before these fixes.
  it("resolves a 'City, State, USA' with no two-letter abbreviation, via the state name alone when USA is skipped", () => {
    expect(deriveTimezoneFromLocation("New Jersey, USA")).toEqual({ timezone: "America/New_York", state: "nj" });
  });

  it("resolves a state followed by a dash-prefixed ZIP code", () => {
    expect(deriveTimezoneFromLocation("Hamtramck, MI - 48212")).toEqual({ timezone: "America/New_York", state: "mi" });
  });

  it("still returns null for a genuinely non-US 'City, Province' pair", () => {
    expect(deriveTimezoneFromLocation("Calgary, AB")).toEqual({ timezone: null, state: null });
  });
});
