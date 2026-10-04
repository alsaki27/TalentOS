import {
  CANDIDATE_OPT_STATUS_FIELDS,
  CANDIDATE_OPT_STATUS_NOT_PROVIDED,
  candidateOptStatusDbEntries,
  emptyCandidateOptStatusData,
  parseCandidateOptStatusData,
} from "@/lib/candidateOptStatus";

describe("candidate OPT status data", () => {
  it("keeps the exact sixteen CSV headers and omits Candidate Name", () => {
    expect(CANDIDATE_OPT_STATUS_FIELDS.map(({ label }) => label)).toEqual([
      "EAD / Work Authorization Type",
      "Application Filed Date",
      "Receipt Notice Date",
      "Biometrics Date",
      "Processing Type",
      "Premium Processing Status",
      "Premium Trigger / Plan",
      "USCIS Current Status",
      "Approval Date",
      "Card Produced Date",
      "Card Mailed Date",
      "EAD Card Received Date",
      "Expected Start / Work-Eligible Date",
      "Ready for Full Application Volume?",
      "Days Pending",
      "Notes",
    ]);
    expect(CANDIDATE_OPT_STATUS_FIELDS.some(({ label }) => label === "Candidate Name")).toBe(false);
  });

  it("creates a blank editable row with every field initialized", () => {
    const data = emptyCandidateOptStatusData();
    expect(Object.keys(data)).toHaveLength(CANDIDATE_OPT_STATUS_FIELDS.length);
    expect(Object.values(data).every((value) => value === null)).toBe(true);
  });

  it("preserves free-form text while normalizing empty cells to null", () => {
    const result = parseCandidateOptStatusData({
      eadWorkAuthorizationType: "  STEM OPT  ",
      applicationFiledDate: "   ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.eadWorkAuthorizationType).toBe("  STEM OPT  ");
    expect(result.data.applicationFiledDate).toBeNull();
    expect(result.data.notes).toBeNull();
  });

  it("rejects unknown keys, non-text values, and overlong values", () => {
    expect(parseCandidateOptStatusData({ unexpected: "value" }).ok).toBe(false);
    expect(parseCandidateOptStatusData({ daysPending: 42 }).ok).toBe(false);
    expect(parseCandidateOptStatusData({ notes: "x".repeat(10_001) }).ok).toBe(false);
  });

  it("validates exact dates, preserves month/year precision, and supports Not Provided", () => {
    const parsed = parseCandidateOptStatusData({
      applicationFiledDate: "2026-05-04",
      receiptNoticeDate: "2026-05",
      biometricsDate: CANDIDATE_OPT_STATUS_NOT_PROVIDED,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const values = Object.fromEntries(candidateOptStatusDbEntries(parsed.data).map(({ column, value }) => [column, value]));
    expect(values.application_filed_date).toBe("2026-05-04");
    expect(values.application_filed_month_year).toBeNull();
    expect(values.receipt_notice_date).toBeNull();
    expect(values.receipt_notice_month_year).toBe("2026-05");
    expect(values.biometrics_not_provided).toBe(true);
    expect(values.biometrics_date).toBeNull();
  });

  it("rejects invalid calendar dates and malformed month/year values", () => {
    expect(parseCandidateOptStatusData({ applicationFiledDate: "2026-02-29" }).ok).toBe(false);
    expect(parseCandidateOptStatusData({ applicationFiledDate: "2026-13" }).ok).toBe(false);
    expect(parseCandidateOptStatusData({ applicationFiledDate: "May-26" }).ok).toBe(false);
  });
});
