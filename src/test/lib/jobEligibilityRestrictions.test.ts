import { detectJobEligibilityRestrictions } from "@/lib/jobEligibilityRestrictions";

describe("detectJobEligibilityRestrictions", () => {
  it("no-ops safely on null/undefined/empty/too-short text", () => {
    for (const input of [null, undefined, "", "hi"]) {
      const result = detectJobEligibilityRestrictions(input);
      expect(result).toEqual({
        eligibilityRestricted: false,
        requiresCitizenship: false,
        citizenshipCountries: null,
        exportControlRestricted: false,
        evidence: null,
      });
    }
  });

  it("does not flag an ordinary job posting with no eligibility restriction", () => {
    const result = detectJobEligibilityRestrictions(
      "We are looking for a GIS Technician with 2+ years of ArcGIS experience. Full benefits, 401k, and PTO. Apply today!"
    );
    expect(result.eligibilityRestricted).toBe(false);
    expect(result.requiresCitizenship).toBe(false);
    expect(result.exportControlRestricted).toBe(false);
  });

  it("detects a US citizenship requirement", () => {
    const result = detectJobEligibilityRestrictions(
      "This position requires access to export-controlled data. Must be a U.S. citizen to be considered."
    );
    expect(result.requiresCitizenship).toBe(true);
    expect(result.citizenshipCountries).toContain("United States");
    expect(result.eligibilityRestricted).toBe(true);
    expect(result.evidence).toBeTruthy();
  });

  it("detects a US citizenship requirement phrased as 'United States citizenship is required'", () => {
    const result = detectJobEligibilityRestrictions(
      "United States citizenship is required for this federal contract role."
    );
    expect(result.requiresCitizenship).toBe(true);
    expect(result.citizenshipCountries).toContain("United States");
  });

  it("detects a Canadian citizenship requirement", () => {
    const result = detectJobEligibilityRestrictions(
      "Candidates must be a Canadian citizen due to government contract requirements."
    );
    expect(result.requiresCitizenship).toBe(true);
    expect(result.citizenshipCountries).toContain("Canada");
  });

  it("detects an 'other nation' citizenship requirement via the generic demonym pattern, without an enumerated country list", () => {
    const result = detectJobEligibilityRestrictions(
      "Due to export regulations, applicants must be a British citizen to apply."
    );
    expect(result.requiresCitizenship).toBe(true);
    expect(result.citizenshipCountries).toContain("British");
  });

  it("detects citizenship phrased as 'citizenship of Australia is required'", () => {
    const result = detectJobEligibilityRestrictions(
      "Citizenship of Australia is required for this defence program."
    );
    expect(result.requiresCitizenship).toBe(true);
    expect(result.citizenshipCountries).toContain("Australia");
  });

  it("detects ITAR export-control language", () => {
    const result = detectJobEligibilityRestrictions(
      "This role supports ITAR-controlled programs and requires compliance with export regulations."
    );
    expect(result.exportControlRestricted).toBe(true);
    expect(result.eligibilityRestricted).toBe(true);
  });

  it("detects the 'U.S. Person' regulatory term", () => {
    const result = detectJobEligibilityRestrictions(
      "Applicants must qualify as a U.S. Person as defined by 22 CFR 120.15 to be eligible for this role."
    );
    expect(result.exportControlRestricted).toBe(true);
  });

  it("detects a security clearance requirement", () => {
    const result = detectJobEligibilityRestrictions(
      "An active Secret security clearance is required prior to starting this role."
    );
    expect(result.exportControlRestricted).toBe(true);
  });

  it("detects TS/SCI clearance phrasing", () => {
    const result = detectJobEligibilityRestrictions(
      "Candidate must currently hold an active TS/SCI clearance."
    );
    expect(result.exportControlRestricted).toBe(true);
  });

  it("does NOT false-positive on 'EAR' from ordinary manufacturing/safety prose (case-sensitive guard)", () => {
    const result = detectJobEligibilityRestrictions(
      "Hearing protection and ear plugs are required on the manufacturing floor at all times."
    );
    expect(result.exportControlRestricted).toBe(false);
    expect(result.eligibilityRestricted).toBe(false);
  });

  it("does NOT false-positive on an unrelated mention of a nationality", () => {
    const result = detectJobEligibilityRestrictions(
      "Our team has experience supporting German and Japanese clients across multiple time zones."
    );
    expect(result.requiresCitizenship).toBe(false);
  });

  it("combines citizenship AND export-control signals into one restricted result when both are present", () => {
    const result = detectJobEligibilityRestrictions(
      "This program is ITAR-restricted. Must be a U.S. citizen with an active Secret clearance to be considered."
    );
    expect(result.requiresCitizenship).toBe(true);
    expect(result.exportControlRestricted).toBe(true);
    expect(result.eligibilityRestricted).toBe(true);
    expect(result.citizenshipCountries).toEqual(["United States"]);
  });
});
