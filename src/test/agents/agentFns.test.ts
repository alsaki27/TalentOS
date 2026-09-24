// Hard test: each agent function, with a mocked AI provider returning
// valid/invalid/malformed JSON to verify schema validation catches bad output.

import { describe, it, expect, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "@/lib/ai/application-agents/types";
import { JobAnalysisSchema, ResumeDraftSchema, ReviewScoreSchema, FinalResumeSchema } from "@/lib/ai/application-agents/schemas";

// runHiringPanel/runFinalPolish now render a real PDF (via jsPDF) to measure
// page-fit before/after their LLM call - a genuinely heavier synchronous cost
// than this file's other agent calls. The first test in the process to touch
// it pays jsPDF's cold module-load cost on top of the render itself, which
// can exceed vitest's 5000ms default under full-suite load even though each
// individual test completes in well under a second in isolation.
vi.setConfig({ testTimeout: 15000 });

function mockProvider(returnText: string): AiProvider {
  return {
    send: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: returnText }],
      stopReason: "end_turn",
    }),
  };
}

// runResumeForge now also does the job-analysis work formerly split out as
// its own "Job Lens" stage (see resumeForge.ts's analyzeJob()), so a single
// call to it makes up to 3 sequential provider.send calls in order:
// (1) job-only extraction (skipped on a jobs.job_analysis cache hit),
// (2) per-candidate requirement analysis (always runs), (3) the resume
// draft itself (plus an optional 4th coverage-retry call). Returns each
// text in `texts` in order for successive calls, then keeps returning the
// last one for any calls beyond that (e.g. a coverage retry no fixture here
// is expected to trigger, since the default job-analysis fixtures below
// classify no requirements as missed).
function mockProviderSequence(...texts: string[]): AiProvider {
  const send = vi.fn();
  for (const t of texts) {
    send.mockResolvedValueOnce({ content: [{ type: "text", text: t }], stopReason: "end_turn" });
  }
  if (texts.length > 0) {
    send.mockResolvedValue({ content: [{ type: "text", text: texts[texts.length - 1] }], stopReason: "end_turn" });
  }
  return { send };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    applicationId: "app-1",
    candidateId: "cand-1",
    job: { id: "job-1", title: "Engineer", company: "Acme", description: "Engineering role", rawDescription: null, employmentType: null, seniorityLevel: null, salaryRange: null, location: null },
    baseResume: { id: "res-1", title: null, content: {}, skills: [], experience: [], education: [], certifications: [] },
    evidence: [],
    verifiedSkills: [],
    previousOutputs: {},
    ...overrides,
  };
}

// Minimal fixtures for the two job-analysis sub-calls, reused by every
// runResumeForge test below that doesn't care about job-analysis specifics -
// classifies nothing as a missed-but-supported requirement, so no coverage
// retry fires and the call sequence stays a predictable 3 calls long.
const DEFAULT_JOB_ONLY = {
  title: "Engineer", company: "Acme", location: "Remote",
  requiredSkills: [], preferredSkills: [], tools: [], methodologies: [], certifications: [],
  seniority: null, domain: null, atsKeywords: [], responsibilities: [],
  evidenceRequirements: [], prohibitedUnsupportedClaims: [], ambiguities: [], rawSummary: "",
};
const DEFAULT_REQUIREMENT_ANALYSIS = { requirementAnalysis: [] };

const MINIMAL_VALID_DRAFT = {
  summary: null, skills: [], experience: [], education: [],
  certifications: [], projects: [], changeLog: [],
  missingRequirements: [], excludedKeywords: [], truthRisks: [],
};

describe("runResumeForge - job analysis (formerly the standalone Job Lens stage)", () => {
  it("validates valid job analysis output from AI", async () => {
    const validAnalysis = {
      title: "Senior Engineer",
      company: "Acme Corp",
      location: "Remote",
      requiredSkills: ["Go", "Kubernetes"],
      preferredSkills: ["Python"],
      tools: ["Docker", "Git"],
      methodologies: ["Agile"],
      certifications: ["CKA"],
      seniority: "Senior",
      domain: "Infrastructure",
      atsKeywords: ["Go", "Kubernetes", "distributed"],
      responsibilities: ["Design systems"],
      evidenceRequirements: ["System design examples"],
      prohibitedUnsupportedClaims: ["No direct reports claim"],
      ambiguities: ["Team size unknown"],
      rawSummary: "Senior infra role",
    };
    const provider = mockProviderSequence(
      JSON.stringify(validAnalysis),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, makeContext());
    expect(result.jobAnalysis.title).toBe("Senior Engineer");
    expect(result.jobAnalysis.requiredSkills).toContain("Go");
    // Cache miss (the mock job has no job_analysis) -> job-only extraction
    // call, the always-fresh requirement-analysis call, then the draft call.
    expect(provider.send).toHaveBeenCalledTimes(3);
  });

  it("throws on invalid JSON from AI", async () => {
    const provider = mockProvider("not json at all");
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await expect(runResumeForge({}, provider, makeContext())).rejects.toThrow();
  });

  it("falls back to the canonical job title when AI omits it", async () => {
    const provider = mockProviderSequence(
      JSON.stringify({ company: "Acme" }),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, makeContext());
    expect(result.jobAnalysis.title).toBe("Engineer");
    expect(result.jobAnalysis.company).toBe("Acme");
  });

  it("cache HIT: skips the job-only extraction call (jobs.job_analysis present and current)", async () => {
    const requirementAnalysisOnly = {
      requirementAnalysis: [
        // sourceEvidence: [] deliberately - schemas.ts's parseRequirementAnalysis
        // re-derives safeToAdd as `supported && sourceEvidence.length > 0`,
        // ignoring whatever the raw JSON claims. With real sourceEvidence this
        // row would be "addable", and since this test's draft never surfaces
        // "Go" (MINIMAL_VALID_DRAFT has no skills/experience), that would
        // correctly trigger Resume Forge's own coverage retry - a real 3rd
        // provider.send call this test isn't exercising.
        { requirement: "Go", category: "skill", sourceEvidence: [], status: "supported_but_not_surfaced", safeToAdd: true },
      ],
    };
    const cachedJobOnly = {
      title: "Senior Engineer", company: "Acme Corp", location: "Remote",
      requiredSkills: ["Go"], preferredSkills: [], tools: [], methodologies: [], certifications: [],
      seniority: "Senior", domain: "Infrastructure", atsKeywords: ["Go"], responsibilities: [],
      evidenceRequirements: [], prohibitedUnsupportedClaims: [], ambiguities: [], rawSummary: "Senior infra role",
    };
    // Cache hit skips extraction, so the sequence is requirement-analysis
    // then the draft call - one fewer than the cache-miss case above.
    const provider = mockProviderSequence(
      JSON.stringify(requirementAnalysisOnly),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const ctx = makeContext({
      job: { ...makeContext().job, job_analysis: cachedJobOnly, job_analysis_schema_version: "JobOnlyAnalysisV1" } as any,
    });

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, ctx);

    expect(provider.send).toHaveBeenCalledTimes(2);
    // The cached job-only fields survive untouched into the merged result.
    expect(result.jobAnalysis.title).toBe("Senior Engineer");
    expect(result.jobAnalysis.atsKeywords).toEqual(["Go"]);
    expect(result.jobAnalysis.requirementAnalysis).toHaveLength(1);
    expect(result.jobAnalysis.requirementAnalysis[0].requirement).toBe("Go");
  });

  it("cache MISS due to a schema-version mismatch: re-extracts job-only analysis instead of trusting a stale cache shape", async () => {
    const validAnalysis = {
      title: "Senior Engineer", company: "Acme Corp", location: "Remote",
      requiredSkills: ["Go"], preferredSkills: [], tools: [], methodologies: [], certifications: [],
      seniority: "Senior", domain: "Infrastructure", atsKeywords: ["Go"], responsibilities: [],
      evidenceRequirements: [], prohibitedUnsupportedClaims: [], ambiguities: [], rawSummary: "Senior infra role",
    };
    const provider = mockProviderSequence(
      JSON.stringify(validAnalysis),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const ctx = makeContext({
      job: { ...makeContext().job, job_analysis: { title: "Stale" }, job_analysis_schema_version: "JobOnlyAnalysisV0-old" } as any,
    });

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await runResumeForge({}, provider, ctx);
    // Job-only extraction + requirement-analysis + draft - the stale cache
    // shape must not be trusted, so extraction still runs.
    expect(provider.send).toHaveBeenCalledTimes(3);
  });

  it("shape-equivalence: the merged job analysis is structurally identical whether job-only data came from cache or a fresh extraction", async () => {
    const jobOnlyFields = {
      title: "Senior Engineer", company: "Acme Corp", location: "Remote",
      requiredSkills: ["Go"], preferredSkills: [], tools: [], methodologies: [], certifications: [],
      seniority: "Senior", domain: "Infrastructure", atsKeywords: ["Go"], responsibilities: [],
      evidenceRequirements: [], prohibitedUnsupportedClaims: [], ambiguities: [], rawSummary: "Senior infra role",
    };
    const reqOnly = { requirementAnalysis: [] };

    // Fresh path (cache miss): job-only extraction, requirement analysis, draft.
    const freshProvider = mockProviderSequence(
      JSON.stringify({ ...jobOnlyFields, ...reqOnly }),
      JSON.stringify(reqOnly),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const freshResult = await runResumeForge({}, freshProvider, makeContext());

    // Cached path: same job-only fields served from jobs.job_analysis, only
    // the requirement-analysis and draft calls actually reach the provider.
    const cachedProvider = mockProviderSequence(
      JSON.stringify(reqOnly),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const cachedCtx = makeContext({
      job: { ...makeContext().job, job_analysis: jobOnlyFields, job_analysis_schema_version: "JobOnlyAnalysisV1" } as any,
    });
    const cachedResult = await runResumeForge({}, cachedProvider, cachedCtx);

    expect(Object.keys(freshResult.jobAnalysis).sort()).toEqual(Object.keys(cachedResult.jobAnalysis).sort());
    expect(freshResult.jobAnalysis).toMatchObject(jobOnlyFields);
    expect(cachedResult.jobAnalysis).toMatchObject(jobOnlyFields);
  });
});

describe("runResumeForge", () => {
  it("validates valid resume draft output", async () => {
    const validDraft = {
      summary: "Experienced engineer",
      skills: [{ title: "Languages", skills: ["Go"] }],
      experience: [{ title: "Engineer", company: "C", bullets: ["Built things"], evidenceIds: [] }],
      education: [],
      certifications: [],
      projects: [],
      changeLog: [{ change: "Added Go", reason: "JD requires", evidenceId: "ev-1" }],
      missingRequirements: [],
      excludedKeywords: [],
      truthRisks: [],
    };
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(validDraft),
    );

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, makeContext());
    expect(result.draft.skills[0]?.skills).toContain("Go");
    expect(result.draft.changeLog).toHaveLength(1);
  });

  it("rejects truth risks with invalid severity instead of filtering", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify({
        summary: null, skills: [], experience: [], education: [],
        certifications: [], projects: [], changeLog: [],
        missingRequirements: [], excludedKeywords: [],
        truthRisks: [{ risk: "Bad", severity: "extreme" }],
      }),
    );
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await expect(runResumeForge({}, provider, makeContext())).rejects.toThrow();
  });

  it("removes fabricated replacement roles and preserves legacy base identity and education month", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify({
        summary: null,
        skills: [],
        experience: [
          { title: "AutoCAD Drafter", company: "ALTERED COMPANY", startDate: "Wrong", endDate: "Wrong", bullets: ["Tailored first role"], evidenceIds: [] },
          { title: "Invented Engineer", company: "Invented Employer", startDate: "2025", endDate: "Present", bullets: ["Fabricated role"], evidenceIds: [] },
        ],
        education: [{ degree: "Master of Engineering Management", school: "WUST", field: null, graduationDate: "2019" }],
        certifications: [], projects: [], changeLog: [], missingRequirements: [], excludedKeywords: [], truthRisks: [],
      }),
    );
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: {
          personalInfo: { fullName: "Najiur Rahman" },
          experience: [
            { title: "AutoCAD Drafter", company: { text: "SWOT Technologies" }, location: "Charlotte, NC", startDate: "May 2024", endDate: "Dec 2025", bullets: [{ text: "Base CAD bullet" }] },
            { title: { text: "Architectural Drafter" }, company: "Fiber-Grounded Ltd.", location: "Dhaka, Bangladesh", startDate: "Feb 2018", endDate: "Jan 2022", bullets: [{ text: "Base architecture bullet" }] },
          ],
          education: [{ degree: "Master of Engineering Management", school: "Washington University of Science and Technology (WUST)", graduationDate: "May 2024" }],
        },
      } as any,
    });

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, ctx);

    expect(result.draft.experience.map((entry) => [entry.title, entry.company])).toEqual([
      ["AutoCAD Drafter", "SWOT Technologies"],
      ["Architectural Drafter", "Fiber-Grounded Ltd."],
    ]);
    expect(result.draft.experience[0]?.startDate).toBe("May 2024");
    expect(result.draft.experience[1]?.bullets).toContain("Base architecture bullet");
    expect(result.draft.education[0]?.school).toBe("Washington University of Science and Technology (WUST)");
    expect(result.draft.education[0]?.graduationDate).toBe("May 2024");
  });

  it("restores the base professional summary when the AI returns null", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify({
        summary: null, skills: [], experience: [], education: [],
        certifications: [], projects: [], changeLog: [], missingRequirements: [], excludedKeywords: [], truthRisks: [],
      }),
    );
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: { summary: { id: "summary-1", text: "Staff Accountant with progressive experience supporting accounting operations." } },
      } as any,
    });
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, ctx);
    expect(result.draft.summary).toBe("Staff Accountant with progressive experience supporting accounting operations.");
  });

  it("forces summary to null when the base resume has no professional summary", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify({
        summary: "Invented summary that must be discarded",
        skills: [], experience: [], education: [],
        certifications: [], projects: [], changeLog: [], missingRequirements: [], excludedKeywords: [], truthRisks: [],
      }),
    );
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, makeContext());
    expect(result.draft.summary).toBeNull();
  });

  it("strips personalInfo.email/phone, experience dates, AND experience bullets from the raw-JSON block (dates/contact are force-overwritten regardless of the model's output, and bullets are fully duplicated by the EXPERIENCE SNAPSHOT), while both still reach the model via the snapshot section", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: {
          personalInfo: { fullName: "Jane Doe", email: "jane.doe@example.com", phone: "555-0100-secret" },
          experience: [{ title: "GIS Technician", company: "Acme", startDate: "2024-06-DATEMARK", endDate: "Present", bullets: [{ text: "Did UNIQUEBULLETMARKER GIS work" }] }],
        },
      } as any,
    });
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await runResumeForge({}, provider, ctx);

    // Call index 2 = the resume-drafting call (0 = job-only extraction,
    // 1 = requirement analysis, 2 = the draft prompt itself).
    const sentText = (provider.send as any).mock.calls[2][0].messages[0].content[0].text as string;
    // "EXPERIENCE SNAPSHOT —" (with the dash) matches only the real section
    // header, not the raw-JSON heading's own inline mention of it.
    const rawJsonSection = sentText.slice(sentText.indexOf("BASE RESUME — RAW JSON"), sentText.indexOf("EXPERIENCE SNAPSHOT —"));
    expect(rawJsonSection).not.toMatch(/jane\.doe@example\.com/);
    expect(rawJsonSection).not.toMatch(/555-0100-secret/);
    expect(rawJsonSection).not.toMatch(/2024-06-DATEMARK/);
    expect(rawJsonSection).not.toMatch(/UNIQUEBULLETMARKER/);
    expect(rawJsonSection).toMatch(/GIS Technician/); // title/company still present
    // The date and the bullet are still available to the model, just via the
    // snapshot instead of duplicated in raw JSON.
    expect(sentText).toMatch(/2024-06-DATEMARK/);
    expect(sentText).toMatch(/UNIQUEBULLETMARKER/);
  });

  it("preserves full bullet fidelity via the EXPERIENCE SNAPSHOT even when a large base resume would have truncated the 12,000-char raw-JSON block under the old behavior (bullets are no longer duplicated into that block at all, so truncation can no longer garble them)", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    // Many roles with long bullets - large enough that the raw-JSON block's
    // 12,000-char slice would have cut into the bullets under the old
    // (bullets-included) behavior.
    const manyRoles = Array.from({ length: 8 }, (_, i) => ({
      title: `Role ${i}`,
      company: `Company ${i}`,
      startDate: `202${i}-01`,
      endDate: "Present",
      bullets: Array.from({ length: 6 }, (_, j) => ({ text: `TAILEND-MARKER-${i}-${j} ` + "Delivered a large, detailed accomplishment description ".repeat(6) })),
    }));
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: { personalInfo: { fullName: "Jane Doe" }, experience: manyRoles },
      } as any,
    });
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await runResumeForge({}, provider, ctx);

    const sentText = (provider.send as any).mock.calls[2][0].messages[0].content[0].text as string;
    // The very last role's very last bullet - the one most likely to have
    // been cut off by truncation if bullets still lived in the raw-JSON
    // block - must still reach the model intact via the snapshot.
    expect(sentText).toMatch(/TAILEND-MARKER-7-5/);
  });

  it("sends verifiedSkills and Source of Truth confirmedSkills as one merged, provenance-tagged list instead of two separate arrays", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const ctx = makeContext({
      verifiedSkills: ["AutoCAD", "Excel"],
      sourceOfTruth: { confirmedSkills: ["AutoCAD", "ArcGIS Pro"], notesContext: null },
    });
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await runResumeForge({}, provider, ctx);

    const sentText = (provider.send as any).mock.calls[2][0].messages[0].content[0].text as string;
    expect(sentText).toMatch(/CONFIRMED\/VERIFIED SKILLS/);
    expect(sentText).toMatch(/AutoCAD \(verified, confirmed\)/);
    expect(sentText).toMatch(/ArcGIS Pro \(confirmed\)/);
    expect(sentText).toMatch(/Excel \(verified\)/);
    // AutoCAD must appear exactly once as a skill entry, not once per source.
    expect((sentText.match(/"AutoCAD \(/g) ?? []).length).toBe(1);
  });

  it("sends the JSON-output instruction exactly once, not the redundant mid-prompt copy", async () => {
    const provider = mockProviderSequence(
      JSON.stringify(DEFAULT_JOB_ONLY),
      JSON.stringify(DEFAULT_REQUIREMENT_ANALYSIS),
      JSON.stringify(MINIMAL_VALID_DRAFT),
    );
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await runResumeForge({}, provider, makeContext());

    const sentText = (provider.send as any).mock.calls[2][0].messages[0].content[0].text as string;
    expect(sentText).not.toMatch(/Output only the final resume in valid JSON format/);
    expect(sentText).toMatch(/Return ONLY valid JSON\. No markdown fences, no explanation\./);
  });
});

describe("runHiringPanel", () => {
  it("validates valid review score output", async () => {
    const provider = mockProvider(JSON.stringify({
      atsScore: 8, recruiterScore: 7, roleFitScore: 6, truthfulnessRisk: 2,
      formattingIssues: [], requiredEdits: [], optionalEdits: [],
      passFail: "pass", overallComment: "Good",
    }));
    const ctx = makeContext({
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "ResumeDraftV1", contentHash: "def", data: {}, createdAt: "" },
      },
    });
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    const result = await runHiringPanel({}, provider, ctx);
    expect(result.atsScore).toBe(8);
    expect(result.passFail).toBe("pass");
  });

  it("throws on missing required score", async () => {
    const provider = mockProvider(JSON.stringify({
      recruiterScore: 7, roleFitScore: 6,
    }));
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    await expect(runHiringPanel({}, provider, makeContext())).rejects.toThrow();
  });

  it("rejects atsScore above 10", async () => {
    const provider = mockProvider(JSON.stringify({
      atsScore: 15, recruiterScore: 7, roleFitScore: 6, passFail: "pass",
    }));
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    await expect(runHiringPanel({}, provider, makeContext())).rejects.toThrow("must be 0-10");
  });

  it("computes evidenceAudit deterministically from the draft's evidenceIds, never trusting the model's own JSON for it", async () => {
    const provider = mockProvider(JSON.stringify({
      atsScore: 8, recruiterScore: 7, roleFitScore: 6, truthfulnessRisk: 2,
      formattingIssues: [], requiredEdits: [], optionalEdits: [],
      passFail: "pass", overallComment: "Good",
      // A model claiming its own evidenceAudit must never survive - the
      // field is always overwritten post-hoc, same as pageFit.
      evidenceAudit: { citedCount: 999, danglingCount: 999 },
    }));
    const ctx = makeContext({
      evidence: [{ id: "ev-1", title: "Led migration", description: "", relatedSkills: [], confidenceScore: 1, source: "resume" }],
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: {
          id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "ResumeDraftV1", contentHash: "def",
          data: { experience: [{ title: "Engineer", company: "Acme", evidenceIds: ["ev-1", "ev-fake"] }], changeLog: [] },
          createdAt: "",
        },
      },
    });
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    const result = await runHiringPanel({}, provider, ctx);
    expect(result.evidenceAudit).toEqual({ citedCount: 1, danglingCount: 1 });
  });

  it("interpolates the real PAGE QA METRICS block into the prompt instead of computing it and never sending it", async () => {
    const provider = mockProvider(JSON.stringify({
      atsScore: 8, recruiterScore: 7, roleFitScore: 6, truthfulnessRisk: 2,
      formattingIssues: [], requiredEdits: [], optionalEdits: [],
      passFail: "pass", overallComment: "Good",
    }));
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    await runHiringPanel({}, provider, makeContext());

    const sentText = (provider.send as any).mock.calls[0][0].messages[0].content[0].text as string;
    // Either the real measured block or the explicit "unavailable" fallback
    // must appear - what must NOT happen is the computed block being built
    // and then silently dropped, which is what line 69's own instruction
    // ("use the PAGE QA METRICS below") was previously pointing at nothing.
    expect(sentText).toMatch(/PAGE QA METRICS/);
    expect(sentText).not.toMatch(/SKILL_CATEGORY_MAP/);
  });
});

describe("runFinalPolish", () => {
  it("validates valid final resume output", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: "Final", skills: [{ title: "Languages", skills: ["Go"] }], experience: [], education: [],
      certifications: [], projects: [], appliedIssueIds: ["r1"],
      rejectedIssueIds: [], unresolvedWarnings: [],
      finalQaScore: 9, exportReady: true,
    }));
    const ctx = makeContext({
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "ResumeDraftV1", contentHash: "def", data: {}, createdAt: "" },
        application_hiring_panel: { id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "ReviewScoreV1", contentHash: "ghi", data: {}, createdAt: "" },
      },
    });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const result = await runFinalPolish({}, provider, ctx);
    expect(result.exportReady).toBe(true);
    expect(result.finalQaScore).toBe(9);
  });

  it("restores the draft's professional summary when the AI returns null and the base has one", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: null, skills: [{ title: "Languages", skills: ["Go"] }], experience: [], education: [],
      certifications: [], projects: [], appliedIssueIds: [],
      rejectedIssueIds: [], unresolvedWarnings: [],
      finalQaScore: 9, exportReady: true,
    }));
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: { summary: { id: "summary-1", text: "Base financial analyst summary." } },
      } as any,
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "ResumeDraftV1", contentHash: "def", data: { summary: "Tailored financial analyst summary." }, createdAt: "" },
        application_hiring_panel: { id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "ReviewScoreV1", contentHash: "ghi", data: {}, createdAt: "" },
      },
    });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const result = await runFinalPolish({}, provider, ctx);
    expect(result.summary).toBe("Tailored financial analyst summary.");
  });

  it("normalizes percentage-style QA and reasserts base employment and education facts", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: null, skills: [],
      experience: [{ title: "Fake Role", company: "Fake Company", bullets: ["Fake bullet"], evidenceIds: [] }],
      education: [{ degree: "MEM", school: "WUST", graduationDate: "2019" }],
      certifications: [], projects: [], appliedIssueIds: [], rejectedIssueIds: [], unresolvedWarnings: [],
      finalQaScore: 93, exportReady: true,
    }));
    const baseExperience = [{ title: { text: "OSP Design Engineer" }, company: { value: "Bayshore Communication" }, location: "Tampa, FL", startDate: "Jan 2026", endDate: "Present", bullets: [{ text: "Designed OSP systems" }] }];
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: {
          experience: baseExperience,
          education: [{ degree: "Master of Engineering Management (MEM)", school: { text: "Washington University of Science and Technology (WUST)" }, graduationDate: "May 2024" }],
        },
      } as any,
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "a", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "ResumeDraftV1", contentHash: "b", data: { experience: baseExperience }, createdAt: "" },
        application_hiring_panel: { id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "ReviewScoreV1", contentHash: "c", data: {}, createdAt: "" },
      },
    });

    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const result = await runFinalPolish({}, provider, ctx);

    expect(result.finalQaScore).toBe(9.3);
    expect(result.experience).toHaveLength(1);
    expect(result.experience[0]).toMatchObject({
      title: "OSP Design Engineer",
      company: "Bayshore Communication",
      startDate: "Jan 2026",
      endDate: "Present",
    });
    expect(result.education[0]?.graduationDate).toBe("May 2024");
  });

  it("rejects ambiguous out-of-range QA scores", () => {
    const result = FinalResumeSchema.parse({
      summary: null, skills: [], experience: [], education: [], certifications: [], projects: [],
      appliedIssueIds: [], rejectedIssueIds: [], unresolvedWarnings: [], finalQaScore: 15, exportReady: false,
    });
    expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("finalQaScore") }));
  });

  it("never sends the dead SKILL_CATEGORY_MAP reference", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: "Final", skills: [{ title: "Languages", skills: ["Go"] }], experience: [], education: [],
      certifications: [], projects: [], appliedIssueIds: ["r1"],
      rejectedIssueIds: [], unresolvedWarnings: [],
      finalQaScore: 9, exportReady: true,
    }));
    const ctx = makeContext({
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "ResumeDraftV1", contentHash: "def", data: {}, createdAt: "" },
        application_hiring_panel: { id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "ReviewScoreV1", contentHash: "ghi", data: {}, createdAt: "" },
      },
    });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    await runFinalPolish({}, provider, ctx);

    const sentText = (provider.send as any).mock.calls[0][0].messages[0].content[0].text as string;
    expect(sentText).not.toMatch(/SKILL_CATEGORY_MAP/);
    expect(sentText).toMatch(/rules 5-7 above/);
  });
});
