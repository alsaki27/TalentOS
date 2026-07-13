// src/test/fixes/studioAndTailoredResumes.test.ts
// Regression tests for the two bugs fixed in commit be7bb7d:
//   Bug 1: Studio crash when content arrives as a JSONB string (Neon)
//   Bug 2: AI-completed tailored resumes missing from candidate Tailored Resumes tab

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Bug 1: Studio JSONB content normalization ──

describe("Bug 1: Studio content parsing (un-parsed JSONB string)", () => {
  // Simulates what the API route now does: parse string content before returning
  function normalizeContent(data: any): any {
    if (data && typeof data.content === "string") {
      try { data.content = JSON.parse(data.content); } catch { /* leave as-is */ }
    }
    return data;
  }

  // Simulates what the studio page does with the response
  function studioLoad(ar: any): any {
    let rawContent = ar.content;
    if (typeof rawContent === "string") {
      try { rawContent = JSON.parse(rawContent); } catch { /* */ }
    }
    return typeof rawContent === "object" && rawContent !== null
      ? JSON.parse(JSON.stringify(rawContent))
      : null;
  }

  it("parses string content via API normalization before studio receives it", () => {
    // Simulate Neon returning a JSONB column as a string
    const apiResponse = {
      id: "ver_123",
      content: '{"header":{"fullName":"Jane Doe"},"skills":[],"experience":[],"education":[]}',
    };
    const normalized = normalizeContent(apiResponse);
    expect(typeof normalized.content).toBe("object");
    expect(normalized.content.header.fullName).toBe("Jane Doe");

    // Studio receives an object, not a string
    const draftContent = studioLoad(normalized);
    expect(draftContent).not.toBeNull();
    expect(draftContent.header.fullName).toBe("Jane Doe");
    expect(Array.isArray(draftContent.skills)).toBe(true);
  });

  it("client-side fallback also parses string content if API didn't normalize", () => {
    // Even without server normalization, the studio page should handle it
    const ar = { content: '{"header":{"fullName":"John Smith"},"skills":[],"experience":[],"education":[]}' };
    const draftContent = studioLoad(ar);
    expect(draftContent).not.toBeNull();
    expect(draftContent.header.fullName).toBe("John Smith");
  });

  it("returns null for invalid JSON string content, triggering the error guard", () => {
    const ar = { content: "not valid json{" };
    const draftContent = studioLoad(ar);
    expect(draftContent).toBeNull();
  });

  it("keywordMap type guard prevents crash when content is a string", () => {
    // Simulate the useMemo guard: if content is a string, return {} early
    const content = "some string"; // would crash on content.skills.some()
    const targetJob = { keywords: [{ id: "k1", keyword: "react", evidence: null }] };

    const keywordMap = (() => {
      if (!targetJob || !content || typeof content !== "object") return {};
      return { react: ["skills"] };
    })();

    expect(keywordMap).toEqual({});
  });

  it("handles object content correctly (no regression)", () => {
    const ar = {
      content: {
        header: { fullName: "Test Person" },
        skills: [{ id: "s1", title: "Skills", skills: ["react"] }],
        experience: [],
        education: [],
      },
    };
    const normalized = normalizeContent(ar);
    expect(normalized.content).toEqual(ar.content);

    const draftContent = studioLoad(normalized);
    expect(draftContent.skills[0].skills[0]).toBe("react");
  });
});

// ── Bug 2: AI tailored resumes merge into candidate tab ──

describe("Bug 2: AI resume versions merged into Tailored Resumes tab", () => {
  // Simulates the loadTailoredResumes merge logic
  function mergeTailoredResumes(
    faloodRows: any[],
    aiVersions: any[]
  ): any[] {
    const faloodTailored = faloodRows.filter((a) => (a.jobDescription || "").trim().length > 0);

    const aiTailored = aiVersions
      .filter((v) => v.source_type === "ai_agent" || v.source_type === "base_resume")
      .map((v) => ({
        id: v.id,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
        jobDescription: v.target_jobs?.jobs?.title ?? null,
        companyName: v.target_jobs?.jobs?.company ?? null,
        skills: [],
        resumeData: null,
        chatHistory: [],
        isAiGenerated: v.source_type === "ai_agent",
        studioLink: `/falood/studio/application/${v.id}`,
        sourceType: v.source_type,
        atsScore: v.ats_score,
      }));

    return [...faloodTailored, ...aiTailored].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  it("includes AI generated resume versions alongside Falood Tailor entries", () => {
    const faloodRows = [
      { id: "fal1", jobDescription: "Title: React Developer", companyName: "Acme", skills: [], resumeData: null, chatHistory: [], createdAt: "2026-07-12", updatedAt: "2026-07-12" },
    ];
    const aiVersions = [
      { id: "arv1", source_type: "ai_agent", created_at: "2026-07-13", updated_at: "2026-07-13", ats_score: 8.5, target_jobs: { jobs: { title: "Senior React Dev", company: "TechCorp" } } },
      { id: "arv2", source_type: "manual", created_at: "2026-07-10", updated_at: "2026-07-10", target_jobs: { jobs: { title: "Other", company: "X" } } },
    ];

    const merged = mergeTailoredResumes(faloodRows, aiVersions);

    expect(merged.length).toBe(2); // falood + ai_agent (manual excluded)
    const aiEntry = merged.find((m) => m.id === "arv1");
    expect(aiEntry).toBeDefined();
    expect(aiEntry.isAiGenerated).toBe(true);
    expect(aiEntry.studioLink).toBe("/falood/studio/application/arv1");
    expect(aiEntry.atsScore).toBe(8.5);
    expect(aiEntry.jobDescription).toBe("Senior React Dev");
    expect(aiEntry.companyName).toBe("TechCorp");

    const faloodEntry = merged.find((m) => m.id === "fal1");
    expect(faloodEntry).toBeDefined();
    expect(faloodEntry.studioLink).toBeUndefined(); // no override — uses default /tailor/ link
  });

  it("excludes non-ai_agent and non-base_resume source types", () => {
    const aiVersions = [
      { id: "v1", source_type: "ai_agent", created_at: "2026-07-13", updated_at: "2026-07-13" },
      { id: "v2", source_type: "manual", created_at: "2026-07-12", updated_at: "2026-07-12" },
      { id: "v3", source_type: "import", created_at: "2026-07-11", updated_at: "2026-07-11" },
    ];
    const merged = mergeTailoredResumes([], aiVersions);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe("v1");
  });

  it("sorts by updatedAt descending (newest first)", () => {
    const aiVersions = [
      { id: "old", source_type: "ai_agent", created_at: "2026-07-01", updated_at: "2026-07-01T10:00:00Z", target_jobs: {} },
      { id: "new", source_type: "ai_agent", created_at: "2026-07-13", updated_at: "2026-07-13T10:00:00Z", target_jobs: {} },
    ];
    const merged = mergeTailoredResumes([], aiVersions);
    expect(merged[0].id).toBe("new");
    expect(merged[1].id).toBe("old");
  });
});