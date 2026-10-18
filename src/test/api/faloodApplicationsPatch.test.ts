// Regression coverage for the data-loss incident (2026-10-15): the Falood
// Studio tailor page's exit-flush logic once PATCHed a blank placeholder
// resume over a candidate's real, reviewed/applied tailored resume (see
// src/lib/falood/resumeEmptyCheck.ts and src/app/falood/studio/tailor/[id]/page.tsx
// for the full writeup). This exercises the REAL route handler - not a
// simulated copy of its logic - against the structural server-side backstop:
// it must refuse to let any client (buggy or otherwise) replace existing
// non-empty resume content with the blank shape.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), execute: vi.fn() }));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/falood/applications/route";

const BLANK_RESUME = {
  personalInfo: { fullName: "", jobTitle: "", email: "", phone: "", location: "", website: "", linkedin: "", github: "", profileImage: "", birthDate: "" },
  summary: "",
  experience: [],
  education: [],
  projects: [],
  skills: { mode: "simple", simple: [], categorized: [] },
};

const REAL_RESUME = {
  ...BLANK_RESUME,
  personalInfo: { ...BLANK_RESUME.personalInfo, fullName: "Mir Najiur Rahman" },
  experience: [{ title: "Designer", company: "Janicki Industries", bullets: ["Did design work"], evidenceIds: [] }],
};

function req(id: string, body: unknown) {
  return new NextRequest(`https://talentos.test/api/falood/applications?id=${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/falood/applications - blank-overwrite guard", () => {
  it("refuses to overwrite a non-empty saved resume with an empty one", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT resume_data FROM falood_saved_applications")) {
        return Promise.resolve({ resume_data: JSON.stringify(REAL_RESUME) });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("app-1", { resumeData: BLANK_RESUME }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/refus/i);
    // The actual UPDATE must never have been attempted.
    expect(mocks.queryOne).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE falood_saved_applications"), expect.anything());
  });

  it("allows saving empty resumeData over an already-empty row (new session's first save)", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT resume_data FROM falood_saved_applications")) {
        return Promise.resolve({ resume_data: JSON.stringify(BLANK_RESUME) });
      }
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: "app-1", createdAt: "2026-01-01", updatedAt: "2026-01-02", name: null });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("app-1", { resumeData: BLANK_RESUME }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("allows saving non-empty resumeData regardless of what was there before", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: "app-1", createdAt: "2026-01-01", updatedAt: "2026-01-02", name: null });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("app-1", { resumeData: REAL_RESUME }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The guard's pre-check SELECT must only run when the incoming data is
    // empty - a normal non-empty save shouldn't pay for an extra round trip.
    expect(mocks.queryOne).not.toHaveBeenCalledWith(expect.stringContaining("SELECT resume_data FROM falood_saved_applications"), expect.anything());
  });

  it("does not run the guard at all for a PATCH that doesn't touch resumeData", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve({ id: "app-1", createdAt: "2026-01-01", updatedAt: "2026-01-02", name: null });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("app-1", { chatHistory: [{ id: "1", role: "user", content: "hi" }] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mocks.queryOne).not.toHaveBeenCalledWith(expect.stringContaining("SELECT resume_data FROM falood_saved_applications"), expect.anything());
  });

  it("allows the guard's empty check through when there is no existing row at all (defers to the normal 404 path)", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT resume_data FROM falood_saved_applications")) {
        return Promise.resolve(null);
      }
      if (sql.includes("UPDATE falood_saved_applications")) {
        return Promise.resolve(null); // no row matched WHERE id = $N
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("nonexistent", { resumeData: BLANK_RESUME }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
  });
});
