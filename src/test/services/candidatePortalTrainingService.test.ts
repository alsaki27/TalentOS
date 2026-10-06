import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));
vi.mock("@/server/services/studentAuditLink", () => ({
  ensureLinked: vi.fn(async () => "audit-student-1"),
}));

import { getCandidatePortalMockSession, getCandidatePortalTrainingAudit } from "@/lib/candidatePortalTrainingService";
import { ensureLinked } from "@/server/services/studentAuditLink";
import { query, queryOne } from "@/server/db/neon";

const sessionRow = {
  id: "mock-1",
  session_date: "2026-08-14",
  target_role: "Data Analyst",
  round_type: "Behavioral",
  evaluator: "Mayukh",
  overall_score: "8.5",
  overall_score_max: "10",
  feedback_summary: "Clear structure.",
  strengths_noted: "Communication",
  areas_for_improvement: "Edge cases",
  has_audit_report: true,
  has_transcript: true,
};

describe("candidate training audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (query as any).mockResolvedValue([]);
    (queryOne as any).mockResolvedValue(null);
  });

  it("returns mock sessions without transcript, report text, or storage fields", async () => {
    (queryOne as any)
      .mockResolvedValueOnce({ id: "audit-student-1", domain: "Data", target_role: "Analyst", progress: "62", mock_interviews: 1, synced_at: null, placement_company: null, placement_role: null, placement_date: null })
      .mockResolvedValueOnce({ count: 1 });
    (query as any).mockResolvedValueOnce([sessionRow]);

    const audit = await getCandidatePortalTrainingAudit("candidate-a");

    const sql = (query as any).mock.calls.map((call: any[]) => String(call[0])).join("\n");
    // The summary may test for a transcript or report with BTRIM(...), but must never select the text itself.
    expect(sql).not.toMatch(/m\.(raw_analysis_text|transcript_raw_text)\s*(,|FROM)/);
    expect(sql).not.toContain("pdf_url");
    expect(sql).not.toContain("sticky");
    expect(JSON.stringify(audit)).not.toMatch(/pdf|sticky|rating|raw_analysis|transcript_raw/);
    expect(audit.mockSessions[0]).toMatchObject({ id: "mock-1", evaluator: "Mayukh", overall_score: 8.5, overall_score_max: 10, has_audit_report: true, has_transcript: true });
    expect(audit.student?.progress).toBe(62);
    expect(audit.student?.placement).toBeNull();
    expect(ensureLinked).toHaveBeenCalledWith("candidate-a");
  });

  it("returns a placement only when the training record has one", async () => {
    (queryOne as any)
      .mockResolvedValueOnce({ id: "audit-student-1", domain: null, target_role: null, progress: 0, mock_interviews: 0, synced_at: null, placement_company: "Acme", placement_role: "Analyst", placement_date: new Date("2026-07-01T00:00:00Z") })
      .mockResolvedValueOnce({ count: 0 });

    const audit = await getCandidatePortalTrainingAudit("candidate-a");
    expect(audit.student?.placement).toEqual({ company: "Acme", role: "Analyst", date: "2026-07-01" });
  });

  it("reports an unlinked candidate with no sessions", async () => {
    (queryOne as any).mockResolvedValueOnce(null);
    const audit = await getCandidatePortalTrainingAudit("candidate-b");
    expect(audit).toEqual({ linked: false, student: null, mockInterviewCount: 0, mockSessions: [] });
  });
});

describe("candidate mock session detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (query as any).mockResolvedValue([]);
    (queryOne as any).mockResolvedValue(null);
  });

  it("returns null when the candidate has no linked training record", async () => {
    const result = await getCandidatePortalMockSession("candidate-c", "mock-1");
    expect(result).toBeNull();
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it("scopes the session lookup to the candidate's own linked student", async () => {
    (queryOne as any)
      .mockResolvedValueOnce({ audit_student_id: "audit-student-1" })
      .mockResolvedValueOnce(null);

    const result = await getCandidatePortalMockSession("candidate-a", "someone-elses-session");

    expect(result).toBeNull();
    const [sql, params] = (queryOne as any).mock.calls[1];
    expect(sql).toContain("m.id = $1 AND m.student_id = $2");
    expect(params).toEqual(["someone-elses-session", "audit-student-1"]);
  });

  it("returns the audit report and transcript, but never the PDF or storage URL", async () => {
    (queryOne as any)
      .mockResolvedValueOnce({ audit_student_id: "audit-student-1" })
      .mockResolvedValueOnce({ ...sessionRow, raw_analysis_text: "Overall Assessment: 8.5 / 10", transcript_raw_text: "Mayukh [0:03]: Hello", pdf_url: "https://storage.example/x.pdf", pdf_filename: "x.pdf" });

    const session = await getCandidatePortalMockSession("candidate-a", "mock-1");

    expect(session).toMatchObject({
      id: "mock-1",
      raw_analysis_text: "Overall Assessment: 8.5 / 10",
      transcript_raw_text: "Mayukh [0:03]: Hello",
      overall_score: 8.5,
    });
    expect(session).not.toHaveProperty("pdf_url");
    expect(session).not.toHaveProperty("pdf_filename");
  });
});
