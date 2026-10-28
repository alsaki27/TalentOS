// Regression coverage for the data-loss incident the base-resume Falood
// Studio page carried (see src/lib/falood/resumeEmptyCheck.ts and
// src/app/falood/studio/base/[baseResumeId]/page.tsx for the full writeup):
// the tailored-resume studio page's exit-flush race was fixed once with a
// matching server-side backstop, but the sibling base-resume save route
// never got one. This exercises the REAL route handler - not a simulated
// copy of its logic - against that backstop. base_resumes.content is stored
// in two different shapes in production (confirmed live: ~88% of rows are
// the older "canonical" header/skills/experience shape, not the
// Resumify-native personalInfo one), so this also proves the guard works
// against a canonical-shape existing row without throwing.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
  APPLICATION_WORKER_ROLES: ["admin", "manager", "application_engineer"],
  DESTRUCTIVE_MANAGER_ROLES: ["admin", "manager"],
}));

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/base-resumes/[id]/route";

const BLANK_NATIVE = {
  personalInfo: { fullName: "", jobTitle: "", email: "", phone: "", location: "", website: "", linkedin: "", github: "", profileImage: "", birthDate: "" },
  summary: "",
  experience: [],
  education: [],
  projects: [],
  skills: { mode: "simple", simple: [], categorized: [] },
};

const REAL_NATIVE = {
  ...BLANK_NATIVE,
  personalInfo: { ...BLANK_NATIVE.personalInfo, fullName: "Mir Najiur Rahman" },
  experience: [{ id: "e1", jobTitle: "Designer", company: "Janicki Industries", bulletPoints: ["Did design work"] }],
};

// The older, more common production shape (~88% of real base_resumes rows) -
// header.fullName, summary as {id, text}, skills as a bare array of groups.
const REAL_CANONICAL = {
  header: { fullName: "MD MAHBUBUL ALAM", email: "mahbub@example.com" },
  summary: { id: "summary", text: "CCIE-certified network engineer." },
  skills: [{ id: "g1", title: "Networking", skills: ["BGP", "MPLS"] }],
  experience: [{ id: "e1", title: "Senior Network Engineer", bullets: [] }],
};

function req(id: string, body: unknown) {
  return new NextRequest(`https://talentos.test/api/base-resumes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({
    context: { profile: { user_id: "admin-1", role: "admin" } },
    response: null,
  });
});

describe("PATCH /api/base-resumes/[id] - blank-overwrite guard", () => {
  it("refuses to overwrite a non-empty canonical-shape row with empty content, without throwing", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT content FROM base_resumes")) {
        return Promise.resolve({ content: REAL_CANONICAL });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("resume-1", { content: BLANK_NATIVE }), { params: { id: "resume-1" } });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/refus/i);
    // The actual UPDATE must never have been attempted.
    expect(mocks.queryOne).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE base_resumes"), expect.anything());
  });

  it("refuses to overwrite a non-empty Resumify-native row with empty content", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT content FROM base_resumes")) {
        return Promise.resolve({ content: REAL_NATIVE });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("resume-1", { content: BLANK_NATIVE }), { params: { id: "resume-1" } });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/refus/i);
  });

  it("allows saving empty content over an already-empty row (a brand-new resume's first save)", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT content FROM base_resumes")) {
        return Promise.resolve({ content: BLANK_NATIVE });
      }
      if (sql.includes("UPDATE base_resumes")) {
        // candidate_id omitted so the keyword-regeneration background task
        // (unrelated to this guard) never fires in this test.
        return Promise.resolve({ id: "resume-1", content: BLANK_NATIVE });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("resume-1", { content: BLANK_NATIVE }), { params: { id: "resume-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("resume-1");
  });

  it("allows saving non-empty content regardless of what was there before, without the extra SELECT round trip", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE base_resumes")) {
        return Promise.resolve({ id: "resume-1", content: REAL_NATIVE });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("resume-1", { content: REAL_NATIVE }), { params: { id: "resume-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("resume-1");
    expect(mocks.queryOne).not.toHaveBeenCalledWith(expect.stringContaining("SELECT content FROM base_resumes"), expect.anything());
  });

  it("does not run the guard at all for a PATCH that doesn't touch content", async () => {
    mocks.queryOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE base_resumes")) {
        return Promise.resolve({ id: "resume-1", name: "Renamed" });
      }
      throw new Error(`Unexpected queryOne call in this test: ${sql}`);
    });

    const res = await PATCH(req("resume-1", { name: "Renamed" }), { params: { id: "resume-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.name).toBe("Renamed");
    expect(mocks.queryOne).not.toHaveBeenCalledWith(expect.stringContaining("SELECT content FROM base_resumes"), expect.anything());
  });

  it("returns a graceful 500 instead of an unhandled rejection if something inside the handler throws", async () => {
    mocks.queryOne.mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await PATCH(req("resume-1", { content: REAL_NATIVE }), { params: { id: "resume-1" } });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(typeof json.error).toBe("string");
  });
});
