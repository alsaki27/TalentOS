import { describe, expect, test } from "vitest";
import { normalizeJobAgentBusinessDate } from "@/lib/jobAgentBusinessDate";

describe("Job Agent business date normalization", () => {
  test("preserves a database date-only string", () => {
    expect(normalizeJobAgentBusinessDate("2026-11-01", "Asia/Dhaka")).toBe("2026-11-01");
  });

  test("converts a PostgreSQL DATE decoded as UTC midnight in Dhaka", () => {
    // PostgreSQL's local DATE parser can decode midnight Dhaka as 18:00 UTC
    // on the preceding day. Keep the intended business date when normalizing.
    expect(normalizeJobAgentBusinessDate(new Date("2026-10-31T18:00:00.000Z"), "Asia/Dhaka"))
      .toBe("2026-11-01");
    expect(normalizeJobAgentBusinessDate("2026-10-31T18:00:00.000Z", "Asia/Dhaka"))
      .toBe("2026-11-01");
  });

  test("rejects invalid date values", () => {
    expect(() => normalizeJobAgentBusinessDate("not-a-date", "Asia/Dhaka"))
      .toThrow("Job Agent business date is invalid.");
  });
});
