import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/server/db/neon", () => mocks);
import { saveSubmissionRecords } from "@/server/services/submissionRecordService";
import { submissionRecordHash } from "@/lib/submissionRecords";
const entry = {id:"a",instance_id:"b",candidate_id:"c",instance_name:"Work",question:"Question",answer:"Answer",page_url:"https://test.example/",page_title:"Title",field_key:"q",field_type:"text",event_type:"change",recorded_at:"2026-01-01T00:00:00.000Z"};
describe("submission record retry storage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("acknowledges an exact replay, including a rotated key with the same owner", async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{event_id:"a",instance_id:"b",content_hash:await submissionRecordHash(entry),recorded_by:"owner"}]);
    expect(await saveSubmissionRecords([entry],"owner","new-key")).toEqual({accepted:["a"],conflicts:[]});
    expect(mocks.query.mock.calls[0][0]).toContain("ON CONFLICT(instance_id,event_id) DO NOTHING");
    expect(mocks.query.mock.calls[0][0]).toContain("k.revoked_at IS NULL");
    expect(mocks.query.mock.calls[0][1][2]).toBe("new-key");
  });
  it.each(["changed content", "different owner", "not inserted"])("does not acknowledge %s", async reason => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce(reason === "not inserted" ? [] : [{event_id:"a",instance_id:"b",content_hash:reason === "changed content" ? "wrong" : await submissionRecordHash(entry),recorded_by:reason === "different owner" ? "other" : "owner"}]);
    expect(await saveSubmissionRecords([entry],"owner","key")).toEqual({accepted:[],conflicts:["a"]});
  });
});
