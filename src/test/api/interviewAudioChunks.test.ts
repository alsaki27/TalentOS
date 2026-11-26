import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERVIEW_AUDIO_CHUNK_BYTES as chunk, MAX_INTERVIEW_AUDIO_BYTES as limit, MAX_PREPARATION_FILE_BYTES } from "@/lib/applicationInterviewPreparation";
import { uploadInterviewRecording } from "@/lib/uploadInterviewRecording";
import * as staff from "@/app/api/applications/[id]/interviews/[scheduleId]/preparation/route";
import * as portal from "@/app/api/portal/me/applications/[id]/interviews/[scheduleId]/preparation/route";
import { uploadInterviewPreparation } from "@/server/services/interviewPreparationFiles";

const fixture = vi.hoisted(() => ({
  app: "11111111-1111-4111-8111-111111111111",
  stage: "22222222-2222-4222-8222-222222222222",
  candidate: "33333333-3333-4333-8333-333333333333",
  actor: { user_id: "staff-id", email: null, display_name: "Staff" },
  db: vi.fn(), start: vi.fn(), find: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ ALL_USER_ROLES: [], requireCurrentUser: async () => ({ context: { profile: fixture.actor } }) }));
vi.mock("@/server/auth/candidateAuth", () => ({
  requireCurrentCandidate: async () => ({ context: { candidateId: fixture.candidate, candidate: { name: "Candidate" } } }),
}));
vi.mock("@/server/db/neon", () => ({ queryOne: fixture.db }));
vi.mock("@/lib/integrations/sharepoint", () => ({ createSharePointUploadSession: fixture.start, findSharePointUpload: fixture.find }));

const params = { params: { id: fixture.app, scheduleId: fixture.stage } };
const graph = "https://storage.test/recording";
const endpoint = "https://talentos.test/interview";
const json = (data: unknown, status = 200) => Response.json(data, { status });
function declaration(size: number) {
  return new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "sample.wav", size, visible: false }) });
}

describe("large interview recordings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("MS_CLIENT_SECRET", "fixture-only");
    fixture.start.mockResolvedValue(graph);
    fixture.db.mockImplementation(async (sql: string, args: unknown[]) => sql.includes("WITH added")
      ? { id: args[0], size_bytes: args[5], visible_to_candidate: args[7] }
      : { candidate_id: fixture.candidate, candidate_name: "Fixture", round_number: 1, status: "interview" });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([["staff", staff], ["portal", portal]] as const)("uploads exactly 300 MB through the %s route", async (who, route) => {
    const block = new Blob([new Uint8Array(chunk)]);
    const first = new Blob(["RIFF0000WAVE", block.slice(12)]);
    const recording = new File([first, ...Array(limit / chunk - 1).fill(block)], "sample.wav");
    let received = 0;
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url === endpoint) return route[init.method === "PUT" ? "PUT" : "POST"](new Request(endpoint, init), params);
      expect(url).toBe(graph);
      const bytes = init.body as Uint8Array;
      expect(bytes.length).toBe(chunk);
      expect(new Headers(init.headers).get("Content-Range")).toBe(`bytes ${received}-${received + chunk - 1}/${limit}`);
      received += bytes.length;
      calls++;
      return received === limit ? json({ id: "stored", size: received }, 201) : json({ nextExpectedRanges: [`${received}-`] }, 202);
    });
    const saved = await uploadInterviewRecording(endpoint, recording, false);
    expect(received).toBe(314572800);
    expect(calls).toBe(60);
    expect(saved).toMatchObject({ size_bytes: limit, visible_to_candidate: who === "portal" });
    expect(fixture.db.mock.calls[0][1][2]).toBe(who === "portal" ? fixture.candidate : null);
  }, 30000);

  it("rejects one extra byte at both entry points and keeps the document limit", async () => {
    for (const route of [staff, portal]) expect((await route.POST(declaration(limit + 1), params)).status).toBe(413);
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await expect(uploadInterviewRecording(endpoint, { size: limit + 1 } as File)).rejects.toThrow("300 MB");
    const doc = new Request(endpoint, { method: "POST", headers: { "Content-Length": String(MAX_PREPARATION_FILE_BYTES + 65537) } });
    expect((await uploadInterviewPreparation(doc, fixture.app, null, fixture.actor)).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it("binds a session to its uploader and stage, checks signatures and rejects invalid ranges", async () => {
    const { handle } = await (await staff.POST(declaration(12), params)).json();
    const put = (range: string) => new Request(endpoint, { method: "PUT", body: "abcdefghijkl", headers: { "X-Recording-Upload": handle, "Content-Range": range } });
    expect((await portal.PUT(put("bytes 0-11/12"), params)).status).toBe(403);
    expect((await staff.PUT(put("bytes 0-11/12"), { params: { ...params.params, scheduleId: fixture.app } })).status).toBe(403);
    expect((await staff.PUT(put("bytes 0-11/13"), params)).status).toBe(400);
    expect((await staff.PUT(put("bytes 0-11/12"), params)).status).toBe(400);
  });

  it("recovers a lost acknowledgement for an intermediate or final fragment", async () => {
    const size = chunk + 1;
    const { handle } = await (await staff.POST(declaration(size), params)).json();
    const upstream = vi.fn().mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(json({ nextExpectedRanges: [`${chunk}-`] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", upstream);
    const put = (body: Blob, start: number) => staff.PUT(new Request(endpoint, { method: "PUT", body, headers: {
      "X-Recording-Upload": handle, "Content-Range": `bytes ${start}-${start + body.size - 1}/${size}`,
    } }), params);
    expect(await (await put(new Blob(["RIFF0000WAVE", new Uint8Array(chunk - 12)]), 0)).json()).toEqual({ nextOffset: chunk });
    fixture.find.mockResolvedValue({ id: "stored", size });
    expect((await put(new Blob(["x"]), chunk)).status).toBe(201);
    expect(fixture.find).toHaveBeenCalledWith(fixture.start.mock.calls[0][0]);
  });
});
