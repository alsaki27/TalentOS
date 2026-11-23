import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "@/server/repositories/candidateActivityRepository";
import { getCandidateActivity } from "@/server/services/candidateActivityService";
const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), upcoming: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("@/server/repositories/candidateActivityRepository", async (original) => ({ ...await original<typeof repo>(), candidateUpcoming: mocks.upcoming }));
const id = "11111111-1111-4111-8111-111111111111";
describe("Candidate activity source accuracy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.queryOne.mockResolvedValue({ id, name: "Fixture", pipeline_stage: "applying", timezone: "America/New_York" });
    mocks.query.mockResolvedValue([]);
    mocks.upcoming.mockResolvedValue(new Map([[id, []]]));
  });
  it("does not present sync timestamps, future mock report dates, or undated notes as new activity", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql === repo.ACTIVITY_TRAINING_SQL) return [{ progress: 42, rating: "good", synced_at: "2099-01-01" }];
      if (sql === repo.ACTIVITY_NOTES_SQL) return [{ id: "note", date: "invalid", source_created_at: null, content: "Undated note" }];
      if (sql === repo.ACTIVITY_MOCKS_SQL) return [{ id: "mock", session_date: "2099-01-01", created_at: "2026-11-22T10:00:00Z", updated_at: "2026-11-22T10:00:00Z", feedback_summary: "Recorded feedback", overall_score: 0, overall_score_max: 10 }];
      return [];
    });
    const result = await getCandidateActivity(id, { limit: 7, cursor: null });
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].at).toBe("2026-11-22T10:00:00.000Z");
    expect(result?.items[0].details).toContainEqual({ label: "Score", value: "0/10" });
    expect(result?.upcoming).toEqual([]);
    expect(result?.current).toContainEqual(expect.objectContaining({ value: "42% · good" }));
    expect(mocks.query.mock.calls.every(([, params]) => params[0] === id)).toBe(true);
  });
  it("avoids duplicate creation events and preserves rescheduling evidence and false mock answers", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql === repo.ACTIVITY_INTERVIEWS_SQL ? [{ id: "stage", application_id: "app", logged_creation: true, logged_reschedule: true }] :
      sql === repo.ACTIVITY_AUDIT_SQL ? [{ id: "event", application_id: "app", action: "interview_stage.rescheduled", created_at: "2026-11-23T11:00:00Z", metadata: { mock_interview_taken: false, previous_scheduled_at: "2026-11-24T13:00:00Z", scheduled_at: "2026-11-25T14:00:00Z" } }] : []);
    const result = await getCandidateActivity(id, { limit: 7, cursor: null });
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]).toMatchObject({ title: "Interview rescheduled", status: "rescheduled" });
    expect(result?.items[0].details).toContainEqual({ label: "Mock interview taken", value: "No" });
    expect(result?.items[0].details.map((field) => field.label)).toContain("Previous appointment");
  });
  it("shows partial-source failures visibly rather than inventing an empty complete history", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.query.mockImplementation(async (sql: string) => { if (sql === repo.ACTIVITY_MOCKS_SQL) throw { code: "42P01" }; return []; });
    const result = await getCandidateActivity(id, { limit: 7, cursor: null });
    expect(result?.warnings).toEqual(["Mock interviews could not be loaded."]);
    log.mockRestore();
  });
  it("returns not found without querying any activity for a missing candidate", async () => {
    mocks.queryOne.mockResolvedValue(null);
    expect(await getCandidateActivity(id, { limit: 7, cursor: null })).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("shows only actual training changes rather than repeating unchanged snapshot fields", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql === repo.ACTIVITY_LOGS_SQL ? [{
      id: "training-edit", entity_type: "candidate_training", created_at: "2026-11-23T12:00:00Z",
      metadata: { before: { progress: 42, rating: "good" }, after: { progress: 55, rating: "good" } },
    }] : []);
    const result = await getCandidateActivity(id, { limit: 7, cursor: null });
    expect(result?.items[0].summary).toBe("Progress: 42% → 55%");
    expect(result?.items[0].details.map((field) => field.label)).not.toContain("Rating");
  });
  it("excludes generic application status rows while retaining actual interview milestones", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("FROM application_events") ? [{
      id: "noise", to_status: "interview", created_at: "2026-11-23T12:00:00Z",
    }] : sql === repo.ACTIVITY_AUDIT_SQL ? [{
      id: "stage-added", action: "interview_stage.added", application_id: "app", created_at: "2026-11-23T12:01:00Z", metadata: { round: 1 },
    }] : []);
    const result = await getCandidateActivity(id, { limit: 7, cursor: null });
    expect(result?.items.map((item) => item.title)).toEqual(["Interview stage added"]);
    expect(result?.total).toBe(1);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("FROM application_events"))).toBe(false);
  });
  it("keeps historical reschedule times separate from current stage details and includes document activity", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql === repo.ACTIVITY_AUDIT_SQL ? [{
      id: "file", application_id: "app", action: "interview_file.added", created_at: "2026-11-23T12:00:00Z",
      metadata: { filename: "Preparation.docx", actor: "Staff", round: 1 },
      current_stage: { round_number: 2, round_name: "Technical round", scheduled_at: "2026-11-26T14:00:00Z", time_zone: "UTC", mock_interview_taken: false, preparation_notes: "Review the job description.", notes: "Bring examples." },
    }, {
      id: "reschedule", application_id: "app", action: "interview_stage.rescheduled", created_at: "2026-11-22T12:00:00Z",
      metadata: { previous_scheduled_at: "2026-11-24T14:00:00Z", scheduled_at: "2026-11-25T14:00:00Z", time_zone: "UTC", previous_time_zone: "UTC" },
      current_stage: { scheduled_at: "2026-11-26T14:00:00Z", time_zone: "UTC" },
    }] : []);
    const result = await getCandidateActivity(id, { limit: 7, cursor: null });
    expect(result?.items[0]).toMatchObject({ title: "Preparation document added" });
    expect(result?.items[0].details).toContainEqual({ label: "File", value: "Preparation.docx" });
    expect(result?.items[0].currentDetails).toContainEqual({ label: "Mock interview taken", value: "No" });
    expect(result?.items[0].currentDetails).toContainEqual({ label: "Staff notes", value: "Bring examples." });
    expect(result?.items[1].details.find((field) => field.label === "Appointment")?.value).toContain("Nov 25");
    expect(result?.items[1].currentDetails?.find((field) => field.label === "Appointment")?.value).toContain("Nov 26");
  });
});
