// Regression coverage for the real root cause behind the Application
// Queue's stale/never-updating page-fit badge: "Open in Studio" bridges an
// application_resume_versions row into a *separate* table,
// falood_saved_applications (the Tailor Studio), and saving there never
// reached the Queue's actual data source. This PATCH route is the save
// path - it must sync edited content (and, via updateApplicationResumeVersion,
// freshly re-measured page_fit_metrics) back to application_resume_versions
// whenever the session's name marks it as sourced from one
// ("application_resume_version:<uuid>"), mirroring the pre-existing
// base_resume sync directly above it in the same handler.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  backgroundDispatch: vi.fn((p: Promise<unknown>) => p),
  updateApplicationResumeVersion: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
}));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: mocks.backgroundDispatch }));
vi.mock("@/server/repositories/applicationResumeVersionsRepository", () => ({
  updateApplicationResumeVersion: mocks.updateApplicationResumeVersion,
}));

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/falood/applications/route";

const RESUME_VERSION_ID = "11111111-1111-1111-1111-111111111111";
const BASE_RESUME_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

const EXISTING_CANONICAL_CONTENT = {
  header: { fullName: "Istiaque Uddin Hyder" },
  summary: { id: "s1", text: "Old summary" },
  skills: [{ id: "g1", title: "Skills", skills: ["AutoCAD"] }],
  experience: [],
  education: [],
};

const RESUME_DATA = {
  personalInfo: { fullName: "Istiaque Uddin Hyder" },
  summary: "Trimmed summary to fit one page",
  skills: { mode: "simple", simple: ["AutoCAD", "Telecom Drafting"] },
  experience: [],
  education: [],
};

function req(id: string, body: unknown) {
  return new NextRequest(`https://talentos.test/api/falood/applications?id=${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.backgroundDispatch.mockImplementation((p: Promise<unknown>) => p);
});

describe("PATCH /api/falood/applications - application_resume_version sync", () => {
  it("syncs edited content back to application_resume_versions when the session is sourced from one", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: SESSION_ID, createdAt: "t", updatedAt: "t", name: `application_resume_version:${RESUME_VERSION_ID}` });
      }
      if (sql.includes("SELECT content FROM application_resume_versions")) {
        return Promise.resolve({ content: EXISTING_CANONICAL_CONTENT });
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    });

    const res = await PATCH(req(SESSION_ID, { resumeData: RESUME_DATA }));

    expect(res.status).toBe(200);
    expect(mocks.updateApplicationResumeVersion).toHaveBeenCalledTimes(1);
    const [calledId, calledInput] = mocks.updateApplicationResumeVersion.mock.calls[0];
    expect(calledId).toBe(RESUME_VERSION_ID);
    expect((calledInput.content as any).summary.text).toBe("Trimmed summary to fit one page");
    expect((calledInput.content as any).header.fullName).toBe("Istiaque Uddin Hyder");
  });

  it("does not touch application_resume_versions for a base_resume-sourced session", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: SESSION_ID, createdAt: "t", updatedAt: "t", name: `base_resume:${BASE_RESUME_ID}` });
      }
      if (sql.includes("SELECT content FROM base_resumes")) {
        return Promise.resolve({ content: EXISTING_CANONICAL_CONTENT });
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    });
    mocks.execute.mockResolvedValue({ rowCount: 1 });

    const res = await PATCH(req(SESSION_ID, { resumeData: RESUME_DATA }));

    expect(res.status).toBe(200);
    expect(mocks.updateApplicationResumeVersion).not.toHaveBeenCalled();
  });

  it("does not sync when the save has no resumeData (e.g. chatHistory-only)", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: SESSION_ID, createdAt: "t", updatedAt: "t", name: `application_resume_version:${RESUME_VERSION_ID}` });
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    });

    const res = await PATCH(req(SESSION_ID, { chatHistory: [{ role: "user", text: "hi" }] }));

    expect(res.status).toBe(200);
    expect(mocks.updateApplicationResumeVersion).not.toHaveBeenCalled();
  });

  it("still returns success from the Tailor Studio's own save even when the background sync fails", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: SESSION_ID, createdAt: "t", updatedAt: "t", name: `application_resume_version:${RESUME_VERSION_ID}` });
      }
      if (sql.includes("SELECT content FROM application_resume_versions")) {
        throw new Error("DB connection dropped");
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    });

    const res = await PATCH(req(SESSION_ID, { resumeData: RESUME_DATA }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mocks.updateApplicationResumeVersion).not.toHaveBeenCalled();
  });

  it("does nothing when no application_resume_versions row exists for the matched id (stale/deleted source)", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: SESSION_ID, createdAt: "t", updatedAt: "t", name: `application_resume_version:${RESUME_VERSION_ID}` });
      }
      if (sql.includes("SELECT content FROM application_resume_versions")) {
        return Promise.resolve(null);
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    });

    const res = await PATCH(req(SESSION_ID, { resumeData: RESUME_DATA }));

    expect(res.status).toBe(200);
    expect(mocks.updateApplicationResumeVersion).not.toHaveBeenCalled();
  });
});
