import { describe, expect, test, vi } from "vitest";

// The service imports the Cloudflare background-dispatch adapter through the
// batch importer. It is unrelated to this pure date calculation and requires
// Next.js's server-only package in a deployed runtime, so isolate it here.
vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: vi.fn().mockResolvedValue(undefined),
}));

import {
  getDhakaNightlyWindow,
  NIGHTLY_TIMEZONE,
} from "@/server/services/jobAgentNightlyService";

describe("canonical Dhaka nightly window", () => {
  test("anchors the business date at Dhaka midnight and spans exactly 48 hours", () => {
    const window = getDhakaNightlyWindow(new Date("2026-08-06T18:00:00.000Z"));

    expect(NIGHTLY_TIMEZONE).toBe("Asia/Dhaka");
    expect(window).toEqual({
      businessDate: "2026-08-07",
      windowStart: "2026-08-04T18:00:00.000Z",
      windowEnd: "2026-08-06T18:00:00.000Z",
    });
    expect(Date.parse(window.windowEnd) - Date.parse(window.windowStart)).toBe(48 * 60 * 60 * 1000);
  });

  test("a delayed invocation keeps the current Dhaka business-date boundary", () => {
    expect(getDhakaNightlyWindow(new Date("2026-08-06T23:59:59.999Z"))).toEqual({
      businessDate: "2026-08-07",
      windowStart: "2026-08-04T18:00:00.000Z",
      windowEnd: "2026-08-06T18:00:00.000Z",
    });
  });

  test("accepts an explicit recovery date and rejects normalized or malformed dates", () => {
    expect(getDhakaNightlyWindow(new Date("2030-01-01T00:00:00.000Z"), "2028-02-29")).toEqual({
      businessDate: "2028-02-29",
      windowStart: "2028-02-26T18:00:00.000Z",
      windowEnd: "2028-02-28T18:00:00.000Z",
    });

    expect(() => getDhakaNightlyWindow(new Date(), "2026-02-29")).toThrow("Invalid businessDate");
    expect(() => getDhakaNightlyWindow(new Date(), "06-08-2026")).toThrow(
      "businessDate must use YYYY-MM-DD format"
    );
    expect(() => getDhakaNightlyWindow(new Date("invalid"))).toThrow(
      "Invalid schedule reference time"
    );
  });
});
