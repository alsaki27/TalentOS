import { describe, it, expect } from "vitest";
import { validateEmploymentChronology } from "@/lib/ai/application-agents/resumeIntegrity";

const NOW = new Date("2026-08-24T00:00:00Z");

const experience = [
  { title: "CAD Technician", company: "Acme", location: null, startDate: "2021-01", endDate: "Present", bullets: [], evidenceIds: [] },
  { title: "Drafter", company: "OldCo", location: null, startDate: "2018-05", endDate: "2020-12", bullets: [], evidenceIds: [] },
];

describe("validateEmploymentChronology", () => {
  it("returns no flags when the job has no posting date", () => {
    const warnings = validateEmploymentChronology(experience, [], {}, NOW);
    expect(warnings).toEqual([]);
    const nullJob = validateEmploymentChronology(experience, [], null, NOW);
    expect(nullJob).toEqual([]);
  });

  it("skips job-relative checks but still checks the calendar when only created_at is missing", () => {
    // Job has no date at all -> calendar checks still apply? No: the spec says
    // job-relative checks are skipped, but future-vs-today checks are
    // independent of the job date and must still run.
    const future = [
      { title: "Future Role", company: "X", location: null, startDate: "2028-03", endDate: "Present", bullets: [], evidenceIds: [] },
    ];
    const warnings = validateEmploymentChronology(future, [], {}, NOW);
    expect(warnings.some((w) => w.includes("Future Role"))).toBe(true);
    expect(warnings.some((w) => w.includes("future"))).toBe(true);
  });

  it("flags roles starting after the job was posted", () => {
    const job = { posted_at: "2020-01-15" };
    const roleStartingAfterPosting = [
      { title: "Weird Role", company: "X", location: null, startDate: "2024-01", endDate: "Present", bullets: [], evidenceIds: [] },
    ];
    const warnings = validateEmploymentChronology(roleStartingAfterPosting, [], job, NOW);
    expect(warnings.some((w) => w.includes("Weird Role") && w.includes("posted"))).toBe(true);
  });

  it("flags future graduation dates", () => {
    const warnings = validateEmploymentChronology(
      experience,
      [{ degree: "B.S.", school: "U", field: null, graduationDate: "2030-05" }],
      { posted_at: "2025-01-01" },
      NOW
    );
    expect(warnings.some((w) => w.includes("graduation"))).toBe(true);
  });

  it("is silent on clean dates", () => {
    const warnings = validateEmploymentChronology(
      experience,
      [{ degree: "B.S.", school: "U", field: null, graduationDate: "2017" }],
      { posted_at: "2026-02-01" },
      NOW
    );
    expect(warnings).toEqual([]);
  });

  it("never rewrites any date", () => {
    const bad = [
      { title: "Future Role", company: "X", location: null, startDate: "2028-03", endDate: "Present", bullets: [], evidenceIds: [] },
    ];
    validateEmploymentChronology(bad, [], { posted_at: "2026-01-01" }, NOW);
    expect(bad[0].startDate).toBe("2028-03");
    expect(bad[0].endDate).toBe("Present");
  });
});
