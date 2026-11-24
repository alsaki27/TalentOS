import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), execute: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/services/submissionRecordService", () => ({ listRecordingCandidates: mocks.list, saveSubmissionRecords: mocks.save }));
import { POST } from "@/app/api/extension/v1/submission-records/route";
import { GET } from "@/app/api/extension/v1/submission-records/candidates/route";
import { parseSubmissionRecord, submissionRecordHash, SUBMISSION_RECORD_SCOPE } from "@/lib/submissionRecords";
const candidate = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entry = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", candidate_id: candidate,
  instance_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", instance_name: "Work browser", question: "Experience?", answer: "Five years",
  page_url: "https://forms.test/apply?token=private#fragment", page_title: "Apply", field_key: "experience", field_type: "textarea", event_type: "change", recorded_at: "2026-01-01T10:00:00Z" };
function request(body: unknown = { records: [entry] }, headers = true) {
  return new NextRequest("https://talentos.test/api/extension/v1/submission-records", { method: "POST",
    headers: headers ? { authorization: "Bearer tos_test", "X-TalentOS-Client": "recorder-test" } : {}, body: JSON.stringify(body) });
}
let key: {id: string; scopes: string[]; candidate_id: string | null; owner_user_id: string | null};
describe("submission recording access and ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    key = { id: "key", scopes: [SUBMISSION_RECORD_SCOPE], candidate_id: null, owner_user_id: "owner" };
    mocks.queryOne.mockImplementation(async (sql: string) => sql.includes("extension_api_keys") ? key : { user_id: "owner" });
    mocks.list.mockResolvedValue([{ id: candidate, name: "Candidate" }]);
    mocks.save.mockResolvedValue({ accepted: [entry.id], conflicts: [] });
  });
  it("rejects unauthenticated traffic before reading records", async () => {
    expect((await POST(request(undefined, false))).status).toBe(400);
    const req = request(); req.headers.delete("authorization");
    expect((await POST(req)).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects revoked keys, missing scope and inactive owners", async () => {
    mocks.queryOne.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    key.scopes = [];
    expect((await POST(request())).status).toBe(403);
    key.scopes = [SUBMISSION_RECORD_SCOPE]; key.owner_user_id = null;
    expect((await POST(request())).status).toBe(403);
    key.owner_user_id = "owner";
    mocks.queryOne.mockResolvedValueOnce(key).mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("restricts the picker and write path to a candidate-bound key", async () => {
    key.candidate_id = candidate;
    expect((await GET(request())).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(candidate);
    expect((await POST(request({ records: [{ ...entry, candidate_id: other }] }))).status).toBe(403);
    expect((await POST(request({ records: [{ ...entry, candidate_id: other, question: "Password" }] }))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not reassign queued records when a candidate becomes unavailable", async () => {
    mocks.list.mockResolvedValue([]);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("preserves empty answers and strips URL tokens before persistence", async () => {
    const response = await POST(request({ records: [{ ...entry, answer: "" }] }));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith([expect.objectContaining({ answer: "", page_url: "https://forms.test/apply" })], "owner", "key");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("excludes credentials without saving them", async () => {
    mocks.save.mockResolvedValue({ accepted: [], conflicts: [] });
    const response = await POST(request({ records: [{ ...entry, question: "API key" }] }));
    expect((await response.json()).excluded).toEqual([entry.id]);
    expect(mocks.save).toHaveBeenCalledWith([], "owner", "key");
  });
  it("rejects malformed, duplicate, oversized and non-HTTPS records", async () => {
    for (const body of [null, {records: [null]}, {records: [entry, entry]}, {records: [{...entry, page_url:"javascript:alert(1)"}]}, {records: [{...entry, answer:"x".repeat(100001)}]}]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request({records:[{...entry, answer:"x".repeat(1500001)}]}))).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
describe("record identity", () => {
  it("normalizes UUID case and equivalent timestamps for retries", async () => {
    const a = parseSubmissionRecord(entry)!;
    const b = parseSubmissionRecord({...entry,id:entry.id.toUpperCase(),candidate_id:candidate.toUpperCase(),recorded_at:"2026-01-01T10:00:00.000Z"})!;
    expect(await submissionRecordHash(a)).toBe(await submissionRecordHash(b));
    expect(await submissionRecordHash({...a, answer:"different"})).not.toBe(await submissionRecordHash(a));
  });
});
