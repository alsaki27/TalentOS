import { describe, it, expect } from "vitest";
import { enforceExperienceIntegrity } from "@/lib/ai/application-agents/resumeIntegrity";

describe("enforceExperienceIntegrity — date sanitization", () => {
  it("drops a chronologically impossible end date (confirmed live bug: endDate before startDate)", () => {
    const base = [
      { title: "GIS Analyst", company: "BAYSHORE COMMUNICATION", startDate: "Jul 2025", endDate: "Jan 2001", isCurrent: false },
    ];
    const result = enforceExperienceIntegrity([], base);
    expect(result[0].startDate).toBe("Jul 2025");
    expect(result[0].endDate).toBeNull();
  });

  it("keeps a valid, chronologically sound end date untouched", () => {
    const base = [
      { title: "GIS Technician", company: "SWOP TECHNOLOGIES", startDate: "Mar 2025", endDate: "Jul 2025" },
    ];
    const result = enforceExperienceIntegrity([], base);
    expect(result[0].endDate).toBe("Jul 2025");
  });

  it("keeps a missing end date as null (current role) rather than inventing one", () => {
    const base = [
      { title: "OSP Design Engineer", company: "BAYSHORE COMMUNICATION", startDate: "Jul 2025", isCurrent: true },
    ];
    const result = enforceExperienceIntegrity([], base);
    expect(result[0].endDate).toBeNull();
  });

  it("does not flag dates it cannot parse a year from", () => {
    const base = [
      { title: "Freelance Consultant", company: "Self", startDate: "Ongoing", endDate: "TBD" },
    ];
    const result = enforceExperienceIntegrity([], base);
    expect(result[0].endDate).toBe("TBD");
  });

  it("applies the same sanitization on the matched (non-empty generated) path, not just the empty-base fallback", () => {
    const base = [
      { title: "GIS Analyst", company: "BAYSHORE COMMUNICATION", startDate: "Jul 2025", endDate: "Jan 2001" },
    ];
    const generated = [
      { title: "GIS Analyst", company: "BAYSHORE COMMUNICATION", startDate: "Jul 2025", endDate: "Jan 2001", bullets: ["Tailored bullet"] },
    ];
    const result = enforceExperienceIntegrity(generated, base);
    expect(result[0].endDate).toBeNull();
    expect(result[0].bullets).toEqual(["Tailored bullet"]);
  });

  it("still pins title/company/dates to the base resume regardless of what the generated entry claims", () => {
    const base = [
      { title: "AutoCAD Drafter", company: "SWOT Technologies", startDate: "May 2024", endDate: "Dec 2025" },
    ];
    const generated = [
      { title: "Senior Fabricated Title", company: "Invented Employer", startDate: "2099", endDate: "2100", bullets: ["Tailored bullet"] },
    ];
    const result = enforceExperienceIntegrity(generated, base);
    expect(result[0].title).toBe("AutoCAD Drafter");
    expect(result[0].company).toBe("SWOT Technologies");
    expect(result[0].startDate).toBe("May 2024");
    expect(result[0].endDate).toBe("Dec 2025");
  });
});
