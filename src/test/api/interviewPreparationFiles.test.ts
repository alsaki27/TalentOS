import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  upload: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne }));
vi.mock("@/lib/integrations/sharepoint", () => ({
  uploadToSharePoint: mocks.upload,
  openSharePointItem: mocks.open,
  deleteSharePointItem: mocks.remove,
}));

import { downloadInterviewPreparation, uploadInterviewPreparation } from "@/server/services/interviewPreparationFiles";

const applicationId = "11111111-1111-1111-1111-111111111111";
const stageId = "22222222-2222-2222-2222-222222222222";
const fileId = "33333333-3333-3333-3333-333333333333";
const candidateId = "44444444-4444-4444-4444-444444444444";
const actor = { user_id: candidateId, display_name: "Test staff", email: null };

function fileRequest(filename: string, content: string) {
  const form = new FormData();
  form.set("file", new File([content], filename));
  form.set("visible", "true");
  return new Request("https://talentos.test/file", { method: "POST", body: form });
}

describe("Application preparation and interview audio", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.queryOne.mockResolvedValueOnce({ candidate_id: candidateId, candidate_name: "Test candidate", job_id: applicationId, round_number: 2, status: "interview" });
    mocks.queryOne.mockResolvedValueOnce({ id: fileId });
    mocks.upload.mockResolvedValue({ itemId: "sharepoint-item" });
  });

  it("uploads job documents without an interview stage", async () => {
    const result = await uploadInterviewPreparation(fileRequest("prep.pdf", "%PDF-1.7"), applicationId, null, actor);
    expect(result.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringContaining("/Documents/"), expect.any(File), "application/pdf");
    const parameters = mocks.queryOne.mock.calls[1][1];
    expect([parameters[1], parameters[2], parameters[7]]).toEqual([applicationId, null, true]);
  });

  it("attaches audio to a particular stage", async () => {
    const result = await uploadInterviewPreparation(fileRequest("recording.mp3", "ID3 fixture"), applicationId, stageId, actor);
    expect(result.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringContaining(`/Stage 2 (${stageId})/Audio/`), expect.any(File), "audio/mpeg");
    expect(mocks.queryOne.mock.calls[1][1][2]).toBe(stageId);
  });

  it("cleans up the SharePoint upload if the application leaves Interview before the file record is saved", async () => {
    mocks.queryOne
      .mockReset()
      .mockResolvedValueOnce({ candidate_id: candidateId, candidate_name: "Test candidate", job_id: applicationId, round_number: 2, status: "interview" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ can_access: false, has_stage: true });
    mocks.upload.mockResolvedValue({ itemId: "sharepoint-item" });
    mocks.remove.mockResolvedValue(undefined);

    const result = await uploadInterviewPreparation(fileRequest("recording.mp3", "ID3 fixture"), applicationId, stageId, actor);

    expect(result.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith("sharepoint-item");
  });

  it("rejects a document in the audio upload and audio in the job upload", async () => {
    const badStage = await uploadInterviewPreparation(fileRequest("prep.pdf", "%PDF-1.7"), applicationId, stageId, actor);
    const badJob = await uploadInterviewPreparation(fileRequest("prep.mp3", "ID3 fixture"), applicationId, null, actor);
    expect(badStage.status).toBe(400);
    expect(badJob.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("serves Word previews as PDF and offers the original separately", async () => {
    mocks.queryOne.mockReset().mockResolvedValue({
      filename: "prep.doc", content_type: "application/msword", sharepoint_item_id: "sharepoint-item",
    });
    mocks.open.mockImplementation(async (_id, options) => new Response(options.asPdf ? "%PDF-1.7" : "word"));
    const preview = await downloadInterviewPreparation(new Request("https://talentos.test/file?preview=1"), applicationId, null, fileId, candidateId);
    const download = await downloadInterviewPreparation(new Request("https://talentos.test/file"), applicationId, null, fileId, candidateId);
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toMatch(/^inline/);
    expect(download.headers.get("content-type")).toBe("application/msword");
    expect(download.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(mocks.queryOne.mock.calls[0][1]).toEqual([fileId, applicationId, null, candidateId]);
  });

  it("streams byte ranges for candidate audio and rejects files outside the candidate's access", async () => {
    mocks.queryOne.mockReset()
      .mockResolvedValueOnce({ filename: "stage.mp3", content_type: "audio/mpeg", sharepoint_item_id: "sharepoint-item" })
      .mockResolvedValueOnce(null);
    mocks.open.mockResolvedValue(new Response("1234", { status: 206, headers: { "Content-Range": "bytes 0-3/40" } }));
    const request = new Request("https://talentos.test/audio", { headers: { Range: "bytes=0-3" } });
    const audio = await downloadInterviewPreparation(request, applicationId, stageId, fileId, candidateId);
    const missing = await downloadInterviewPreparation(request, applicationId, stageId, fileId, candidateId);
    expect(audio.status).toBe(206);
    expect(audio.headers.get("content-range")).toBe("bytes 0-3/40");
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
    expect(missing.status).toBe(404);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith("sharepoint-item", { asPdf: false, range: "bytes=0-3" });
  });
});
