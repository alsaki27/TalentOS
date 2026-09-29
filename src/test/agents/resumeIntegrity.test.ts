import { describe, it, expect } from "vitest";
import { enforceExperienceIntegrity, enforceEducationIntegrity, flagDuplicateRoleIdentity } from "@/lib/ai/application-agents/resumeIntegrity";

function exp(overrides: Partial<{ title: string; company: string; location: string | null; startDate: string | null; endDate: string | null; bullets: string[]; evidenceIds: string[] }> = {}) {
  return {
    title: "Role", company: "Acme", location: null, startDate: null, endDate: null,
    bullets: [], evidenceIds: [],
    ...overrides,
  };
}

describe("enforceExperienceIntegrity — date sanitization", () => {
  it("drops a chronologically impossible end date (confirmed live bug: endDate before startDate)", () => {
    const base = [
      { title: "GIS Analyst", company: "BAYSHORE COMMUNICATION", startDate: "Jul 2025", endDate: "Jan 2001", isCurrent: false },
    ];
    const result = enforceExperienceIntegrity([], base);
    expect(result[0].startDate).toBe("Jul 2025");
    expect(result[0].endDate).toBe("Present");
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
    expect(result[0].endDate).toBe("Present");
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

describe("flagDuplicateRoleIdentity", () => {
  it("flags a same-title-same-company pair whose bullets are highly similar (a likely data-entry duplicate)", () => {
    const bullets = [
      "Managed 500+ spatial records using ArcGIS Pro and FME for a regional infrastructure project",
      "Produced 40+ maps and dashboards for stakeholder review using ArcGIS Online",
    ];
    const result = flagDuplicateRoleIdentity([
      exp({ title: "GIS Technician", company: "Acme Corp", bullets }),
      exp({ title: "GIS Technician", company: "Acme Corp", bullets: [...bullets] }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/GIS Technician/);
    expect(result[0]).toMatch(/Acme Corp/);
  });

  it("does not flag the same title+company when the bullets describe clearly different work (a plausible rehire)", () => {
    const result = flagDuplicateRoleIdentity([
      exp({
        title: "Project Manager", company: "Acme Corp",
        bullets: ["Led a team of 5 engineers delivering a $2M fiber buildout across three counties"],
      }),
      exp({
        title: "Project Manager", company: "Acme Corp",
        bullets: ["Directed vendor negotiations and budget planning for a facilities renovation program"],
      }),
    ]);
    expect(result).toHaveLength(0);
  });

  it("does not flag two different roles at the same company", () => {
    const result = flagDuplicateRoleIdentity([
      exp({ title: "GIS Technician", company: "Acme Corp", bullets: ["Did GIS work"] }),
      exp({ title: "GIS Analyst", company: "Acme Corp", bullets: ["Did GIS work"] }),
    ]);
    expect(result).toHaveLength(0);
  });

  it("does not flag the same title at two different companies", () => {
    const result = flagDuplicateRoleIdentity([
      exp({ title: "GIS Technician", company: "Acme Corp", bullets: ["Did GIS work"] }),
      exp({ title: "GIS Technician", company: "Other Corp", bullets: ["Did GIS work"] }),
    ]);
    expect(result).toHaveLength(0);
  });

  it("returns no warnings for a single-role or empty experience list", () => {
    expect(flagDuplicateRoleIdentity([])).toEqual([]);
    expect(flagDuplicateRoleIdentity([exp()])).toEqual([]);
  });
});

// B4 (2026-09-28): the Resumify studio editor (src/components/falood/resumify/
// types/resume.ts) saves experience under jobTitle (not title) and education
// under institution/graduationYear (not school/graduationDate). Before this
// fix, enforceExperienceIntegrity/enforceEducationIntegrity's "does this base
// entry have valid identity fields" filter only recognized the canonical
// names, so for a base resume using this shape `validBase` came back empty
// and both functions fell through to their "no valid base - trust the AI's
// entries unchanged" branch, providing zero identity protection. Measured
// live: 9 of 81 base_resumes use this shape.
describe("enforceExperienceIntegrity — legacy Resumify shape (jobTitle instead of title)", () => {
  it("still locks identity from the base resume when the base uses jobTitle", () => {
    const base = [
      { jobTitle: "AutoCAD Drafter", company: "Real Company", location: "Charlotte, NC", startDate: "May 2024", endDate: "Dec 2025" },
    ];
    const generated = [
      { title: "Senior Designer", company: "Fabricated Employer", bullets: ["Fabricated bullet"] },
    ];
    const result = enforceExperienceIntegrity(generated, base);
    expect(result).toHaveLength(1);
    // Identity comes from the base (jobTitle/company/dates), not the AI's
    // invented title/company - proving validBase was non-empty this time
    // (the pre-fix bug would have returned the AI's entry completely
    // unchanged: "Senior Designer" @ "Fabricated Employer").
    expect(result[0].title).toBe("AutoCAD Drafter");
    expect(result[0].company).toBe("Real Company");
    expect(result[0].startDate).toBe("May 2024");
  });

  it("matches a legacy-shaped base role against a canonical-shaped generated role for bullet tailoring", () => {
    const base = [{ jobTitle: "GIS Analyst", company: "Acme Corp", startDate: "2020", endDate: "2022" }];
    const generated = [{ title: "GIS Analyst", company: "Acme Corp", bullets: ["Matched and tailored"] }];
    const result = enforceExperienceIntegrity(generated, base);
    expect(result[0].bullets).toEqual(["Matched and tailored"]);
  });
});

describe("enforceEducationIntegrity — legacy Resumify shape (institution/graduationYear instead of school/graduationDate)", () => {
  it("still locks identity from the base resume when the base uses institution/graduationYear", () => {
    const base = [
      { degree: "B.S. Computer Science", institution: "Real University", graduationYear: "2019" },
    ];
    const generated = [{ degree: "Fabricated Degree", school: "Fabricated University", graduationDate: "2099" }];
    const result = enforceEducationIntegrity(generated, base);
    expect(result).toHaveLength(1);
    expect(result[0].school).toBe("Real University");
    expect(result[0].graduationDate).toBe("2019");
    expect(result[0].degree).toBe("B.S. Computer Science");
  });
});
