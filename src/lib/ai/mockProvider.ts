// Deterministic mock AI provider for CI/testing without live AI costs.
// Returns schema-compliant JSON for each application pipeline agent.
// Activated by setting AI_PROVIDER=mock in the environment.

import type { AiProvider, AiResponse } from "@/lib/ai/provider";
import type { JobAnalysisV1 } from "@/lib/ai/application-agents/schemas";
import type { ResumeDraftV1 } from "@/lib/ai/application-agents/schemas";
import type { ReviewScoreV1 } from "@/lib/ai/application-agents/schemas";
import type { FinalResumeV1 } from "@/lib/ai/application-agents/schemas";

const MOCK_JOB_ANALYSIS: JobAnalysisV1 = {
  title: "Senior Software Engineer",
  company: "Acme Corp",
  location: "Remote",
  requiredSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
  preferredSkills: ["GraphQL", "Docker", "AWS"],
  tools: ["VS Code", "Git", "Docker", "GitHub Actions"],
  methodologies: ["Agile", "Scrum", "CI/CD"],
  certifications: [],
  seniority: "Senior",
  domain: "SaaS",
  atsKeywords: ["TypeScript", "React", "Node.js", "PostgreSQL", "GraphQL", "AWS", "CI/CD", "Agile"],
  responsibilities: ["Build and maintain web applications", "Review code and mentor junior engineers", "Collaborate with product and design teams", "Drive technical decisions and architecture"],
  evidenceRequirements: ["5+ years of professional software engineering experience", "Experience leading technical projects", "Production experience with TypeScript and React"],
  prohibitedUnsupportedClaims: ["Claims of specific revenue impact without evidence", "Claims of single-handedly building entire platforms"],
  ambiguities: ["How much cloud infrastructure experience is truly required"],
  rawSummary: "Senior full-stack TypeScript engineer role at a SaaS company. Remote-friendly, 5+ years experience required.",
  requirementAnalysis: [
    { requirement: "TypeScript", category: "skill", sourceEvidence: ["base.experience[0].bullets[0]"], status: "supported_by_resume", safeToAdd: true },
    { requirement: "React", category: "skill", sourceEvidence: ["base.experience[1].bullets[0]"], status: "supported_by_resume", safeToAdd: true },
    { requirement: "Node.js", category: "skill", sourceEvidence: ["base.experience[0].bullets[0]"], status: "supported_by_resume", safeToAdd: true },
    { requirement: "PostgreSQL", category: "tool", sourceEvidence: ["base.experience[0].bullets[1]"], status: "supported_by_resume", safeToAdd: true },
    { requirement: "GraphQL", category: "skill", sourceEvidence: ["sot:GraphQL"], status: "supported_but_not_surfaced", safeToAdd: true },
    { requirement: "AWS", category: "tool", sourceEvidence: [], status: "unsupported", safeToAdd: false },
    { requirement: "Docker", category: "tool", sourceEvidence: ["base.experience[1].bullets[1]"], status: "supported_but_not_surfaced", safeToAdd: true },
  ],
};

const MOCK_RESUME_DRAFT: ResumeDraftV1 = {
  summary: "Experienced software engineer with 5+ years building scalable web applications using TypeScript, React, and Node.js.",
  skills: [
    { title: "Languages & Frameworks", skills: ["TypeScript", "React", "Node.js"] },
    { title: "Infrastructure & Data", skills: ["PostgreSQL", "AWS", "Docker", "GraphQL"] },
    { title: "Tools", skills: ["Git"] },
  ],
  experience: [
    {
      title: "Senior Software Engineer",
      company: "Acme Corp",
      location: "Remote",
      startDate: "2021-01",
      endDate: null,
      bullets: [
        "Led a team of 5 engineers building a SaaS platform in React and Node.js",
        "Reduced API latency by 40% through query optimization and caching",
        "Implemented CI/CD pipelines using GitHub Actions, cutting deployment time by 60%",
      ],
      evidenceIds: [],
    },
    {
      title: "Software Engineer",
      company: "TechStart Inc",
      location: "San Francisco, CA",
      startDate: "2019-06",
      endDate: "2020-12",
      bullets: [
        "Built customer-facing dashboard with React and TypeScript",
        "Designed and implemented RESTful APIs serving 100k+ daily requests",
      ],
      evidenceIds: [],
    },
  ],
  education: [
    {
      degree: "B.S. Computer Science",
      school: "State University",
      field: "Computer Science",
      graduationDate: "2019",
    },
  ],
  certifications: [],
  projects: [
    {
      name: "Open Source Monitoring Tool",
      description: "Built a monitoring dashboard for microservices using React and Node.js",
      technologies: ["React", "Node.js", "PostgreSQL", "Docker"],
    },
  ],
  changeLog: [
    { change: "Tailored experience bullets to match job requirements", reason: "Job requires TypeScript and React experience", evidenceId: null },
    { change: "Added relevant skills section aligned with ATS keywords", reason: "Improve ATS matching score", evidenceId: null },
  ],
  missingRequirements: [],
  excludedKeywords: [],
  truthRisks: [],
  requirementCoverage: [],
};

const MOCK_REVIEW_SCORE: ReviewScoreV1 = {
  atsScore: 9.0,
  recruiterScore: 8.5,
  roleFitScore: 8.0,
  truthfulnessRisk: 1.0,
  formattingIssues: [],
  requiredEdits: [],
  optionalEdits: [
    { issueId: "opt-1", description: "Consider adding GraphQL project if available" },
  ],
  passFail: "pass",
  disposition: "pursue",
  dispositionReasons: ["Strong TypeScript and React evidence matches the role"],
  overallComment: "Strong candidate with excellent TypeScript and React experience. Resume is well-structured and ATS-friendly.",
  pageFit: null,
  evidenceAudit: null,
};

const MOCK_FINAL_RESUME: FinalResumeV1 = {
  summary: "Experienced software engineer with 5+ years building scalable web applications using TypeScript, React, and Node.js. Proven track record of leading teams and delivering high-impact SaaS products.",
  skills: [
    { title: "Languages & Frameworks", skills: ["TypeScript", "React", "Node.js"] },
    { title: "Infrastructure & Data", skills: ["PostgreSQL", "AWS", "Docker", "GraphQL"] },
    { title: "Tools", skills: ["Git"] },
  ],
  experience: [
    {
      title: "Senior Software Engineer",
      company: "Acme Corp",
      location: "Remote",
      startDate: "2021-01",
      endDate: null,
      bullets: [
        "Led a team of 5 engineers building a SaaS platform in React and Node.js",
        "Reduced API latency by 40% through query optimization and caching",
        "Implemented CI/CD pipelines using GitHub Actions, cutting deployment time by 60%",
      ],
      evidenceIds: [],
    },
    {
      title: "Software Engineer",
      company: "TechStart Inc",
      location: "San Francisco, CA",
      startDate: "2019-06",
      endDate: "2020-12",
      bullets: [
        "Built customer-facing dashboard with React and TypeScript",
        "Designed and implemented RESTful APIs serving 100k+ daily requests",
      ],
      evidenceIds: [],
    },
  ],
  education: [
    {
      degree: "B.S. Computer Science",
      school: "State University",
      field: "Computer Science",
      graduationDate: "2019",
    },
  ],
  certifications: [],
  projects: [
    {
      name: "Open Source Monitoring Tool",
      description: "Built a monitoring dashboard for microservices using React and Node.js",
      technologies: ["React", "Node.js", "PostgreSQL", "Docker"],
    },
  ],
  appliedIssueIds: ["opt-1"],
  rejectedIssueIds: [],
  unresolvedWarnings: [],
  finalQaScore: 9.2,
  exportReady: true,
  pageFit: null,
};

type MockResponseFn = (automationId: string) => unknown;

const MOCK_RESPONSES: Record<string, MockResponseFn> = {
  application_job_lens: () => MOCK_JOB_ANALYSIS,
  application_resume_forge: () => MOCK_RESUME_DRAFT,
  application_hiring_panel: () => MOCK_REVIEW_SCORE,
  application_final_polish: () => MOCK_FINAL_RESUME,
  target_jobs_matching: () => ({
    match: true,
    score: 85,
    matchedSkills: ["TypeScript", "React", "Node.js"],
    missingSkills: ["GraphQL"],
    recommendation: "Good match - proceed with application",
  }),
  application_tailoring: () => ({
    tailoredContent: "Tailored resume content for Senior Software Engineer at Acme Corp",
    skillsHighlight: ["TypeScript", "React", "Node.js"],
    suggestions: [],
  }),
  ai_digest: () => ({
    content: "Digest of AI activity",
    dataSummary: { totalCalls: 3, totalTokens: 500 },
  }),
  job_categorization: () => ({
    category: "engineering",
    subcategory: "full-stack",
    confidence: 0.95,
  }),
  chat_assistant: () => ({
    message: "Mock chat response for testing",
    tokens: 50,
  }),
};

function buildResponse(automationId: string): AiResponse {
  const fn = MOCK_RESPONSES[automationId];
  const data = fn ? fn(automationId) : { mock: true, automationId, note: "No mock configured for this automation" };
  const json = JSON.stringify(data);

  return {
    content: [{ type: "text", text: json }],
    stopReason: "end_turn",
    usage: { input_tokens: 50, output_tokens: json.length },
  };
}

// Rule-based stand-in for copilot_fill_planner — used locally when no live AI
// route is configured (e.g. missing Vertex proxy / key-encryption secrets that
// only exist as Cloudflare Worker secrets in production). Parses the
// CANDIDATE PROFILE / FORM SNAPSHOT / PAST CORRECTIONS blocks that
// buildCopilotFillerPrompt embeds as raw JSON in the prompt text, and maps
// fields by label keyword. Deliberately simple — good enough to exercise the
// analyze -> fill -> correct -> learn loop end-to-end without live AI cost.
function mockCopilotFillPlan(userText: string): unknown {
  const extractJson = (marker: string, endMarker: string) => {
    const start = userText.indexOf(marker);
    if (start === -1) return null;
    const jsonStart = start + marker.length;
    const end = endMarker ? userText.indexOf(endMarker, jsonStart) : userText.length;
    const slice = userText.slice(jsonStart, end === -1 ? undefined : end).trim();
    try { return JSON.parse(slice); } catch { return null; }
  };

  const profile = extractJson("CANDIDATE PROFILE:\n", "\nRESUME TEXT:") || {};
  const fields = extractJson("FORM SNAPSHOT (Detected Fields):\n", "\nINSTRUCTIONS:") || [];
  const correctionsBlock = userText.includes("PAST CORRECTIONS");
  const corrections: { fieldLabel: string; finalValue: string }[] = [];
  if (correctionsBlock) {
    const re = /field labeled "([^"]+)": you previously guessed "[^"]*" but the reviewer corrected it to "([^"]*)"/g;
    let m;
    while ((m = re.exec(userText))) corrections.push({ fieldLabel: m[1].toLowerCase(), finalValue: m[2] });
  }

  // Normalized-equality only, deliberately not loose substring matching:
  // substring matching let a "Last Name" correction ("Saki") bleed into an
  // unrelated single "Name" field on a different form, since "name" is
  // trivially a substring of "last name". A wrong match that actively
  // overwrites a field is worse than a missed match that falls through to
  // the heuristic map below. (The real AI path doesn't have this problem —
  // it reads the corrections as prose and uses actual judgment; this
  // normalize-and-compare stand-in is intentionally conservative instead.)
  const normalizeLabel = (s: string) => s.toLowerCase().replace(/[*:]/g, "").trim();
  const findCorrection = (label: string) => {
    const norm = normalizeLabel(label);
    return corrections.find((c) => normalizeLabel(c.fieldLabel) === norm);
  };

  const instructions = (Array.isArray(fields) ? fields : []).map((f: any) => {
    const label = String(f.label || f.ariaLabel || f.placeholder || f.name || "").toLowerCase();
    // Standing defaults — always win, regardless of profile data or past corrections.
    if (/previously worked (for|at) this company|worked (for|at) .* before|rehire/.test(label)) {
      return { selector: f.selector, fieldType: f.inputType === "checkbox" ? "checkbox" : "text", value: "No", confidence: "high", reasoning: `Standing default: "have you previously worked here" -> No` };
    }
    // Two different EEO widget shapes: a single "Veteran Status"/"Disability
    // Status" field (real <select> or plain text field) vs. one checkbox per
    // specific category + a separate opt-out checkbox ("I do not identify as
    // a veteran"/"...person with a disability"). Setting text "No" on a
    // per-category checkbox would be meaningless — only the opt-out checkbox
    // should be checked; the category checkboxes stay untouched.
    if (f.inputType === "checkbox" && /i do not identify as a (veteran|person with a disability)/.test(label)) {
      return { selector: f.selector, fieldType: "checkbox", value: true, confidence: "high", reasoning: `Standing default: opts out of veteran/disability self-ID` };
    }
    if (f.inputType === "checkbox" && /veteran|disability/.test(label)) {
      return { selector: f.selector, fieldType: "skip", value: "", confidence: "high", reasoning: `Standing default: specific veteran/disability category left unchecked (opt-out checkbox used instead)` };
    }
    if (/veteran/.test(label)) {
      return { selector: f.selector, fieldType: "text", value: "No", confidence: "high", reasoning: `Standing default: veteran status -> No` };
    }
    if (/disability/.test(label)) {
      return { selector: f.selector, fieldType: "text", value: "No", confidence: "high", reasoning: `Standing default: disability status -> No` };
    }
    if (/sponsorship|require.*visa/.test(label)) {
      return { selector: f.selector, fieldType: f.inputType === "checkbox" ? "checkbox" : "text", value: "No", confidence: "high", reasoning: `Standing default: visa sponsorship -> No` };
    }
    if (/open to relocat|willing to relocat|relocation for this/.test(label)) {
      return { selector: f.selector, fieldType: f.inputType === "checkbox" ? "checkbox" : "text", value: "Yes", confidence: "high", reasoning: `Standing default: relocation -> Yes` };
    }
    if (/how did you hear|how did you learn|hear about (us|this job)/.test(label)) {
      const opts: string[] = Array.isArray(f.options) ? f.options : [];
      const pick = opts.find((o: string) => /google/i.test(o)) || opts.find((o: string) => /job board|job site|indeed|linkedin/i.test(o)) || opts[0] || "Google Search";
      return { selector: f.selector, fieldType: opts.length ? "select" : "text", value: pick, confidence: "high", reasoning: `Standing default: source question, any reasonable answer works -> picked "${pick}"` };
    }

    const prior = findCorrection(label);
    if (prior) {
      return { selector: f.selector, fieldType: f.inputType === "checkbox" ? "checkbox" : "text", value: prior.finalValue, confidence: "high", reasoning: `Matches a past reviewer correction for a similarly-labeled field: "${label}"` };
    }
    if (f.inputType === "file") return { selector: f.selector, fieldType: "skip", value: "", confidence: "low", reasoning: "File upload — handled manually" };

    // Checkbox-group "how did you hear about us" pattern: one checkbox per
    // source option (name ends "[]") instead of a single <select>. Each
    // field's own label IS the source name (e.g. "Google Search"), not the
    // question text, so this needs its own match instead of the option-list
    // heuristic used for real <select> elements.
    if (f.inputType === "checkbox" && /\[\]$/.test(f.name || "") && /google|linkedin|indeed|job board|job site|referral|social media|website|campus|networking|press|article|news/i.test(label)) {
      const isPreferred = /google/i.test(label) || /job board|job site/i.test(label);
      return { selector: f.selector, fieldType: "checkbox", value: isPreferred, confidence: isPreferred ? "high" : "medium", reasoning: `Standing default: source question, any reasonable answer works — ${isPreferred ? "checking" : "leaving unchecked"} "${label}"` };
    }
    const map: [RegExp, string][] = [
      [/first name/, profile.name ? String(profile.name).split(" ")[0] : ""],
      [/last name/, profile.name ? String(profile.name).split(" ").slice(1).join(" ") : ""],
      [/full name|^name$|your name/, profile.name || ""],
      [/e-?mail/, profile.email || ""],
      [/phone/, profile.phone || ""],
      [/linkedin/, profile.linkedin || ""],
      [/\b(location|city)\b/, profile.location || ""],
      [/salary|compensation/, profile.salaryExpectation || ""],
      [/work auth|visa|sponsorship|authorized to work/, profile.workAuthorization || ""],
    ];
    const hit = map.find(([re]) => re.test(label));
    if (hit && hit[1]) {
      return { selector: f.selector, fieldType: "text", value: hit[1], confidence: "medium", reasoning: `Heuristic label match: "${label}"` };
    }
    if (f.required) {
      return { selector: f.selector, fieldType: "ai_answer", value: "", confidence: "low", reasoning: `Required field with no direct profile match: "${label}" — needs a written answer` };
    }
    return { selector: f.selector, fieldType: "skip", value: "", confidence: "low", reasoning: `No profile data maps to: "${label}"` };
  });

  return { instructions };
}

function userTextOf(opts: { messages: { content: unknown }[] }): string {
  return opts.messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

function jsonResponse(data: unknown) {
  const json = JSON.stringify(data);
  return { content: [{ type: "text" as const, text: json }], stopReason: "end_turn" as const, usage: { input_tokens: 50, output_tokens: json.length } };
}

// Robust JSON-value extraction: finds the marker, then scans forward
// tracking bracket/brace depth to find where the JSON value actually ends,
// instead of guessing at a fixed end-marker string (a fixed end-marker was
// the root cause of two real bugs earlier this session — the prompt's
// surrounding text shifted and the marker no longer matched).
function extractJsonAfter(text: string, marker: string): unknown {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  const open = text[i];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(i, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Same standing-default rules as the real prompts (prompts/copilotCompliance.ts) —
// used to give the mock Compliance agent something real to test against.
function mockComplianceInstructions(fields: any[]): { instructions: any[] } {
  const instructions: any[] = [];
  for (const f of fields) {
    const label = String(f.label || f.ariaLabel || f.placeholder || f.name || "").toLowerCase();
    if (f.inputType === "checkbox" && /i do not identify as a (veteran|person with a disability)/.test(label)) {
      instructions.push({ selector: f.selector, fieldType: "checkbox", value: true, confidence: "high", reasoning: "Standing default: opts out of veteran/disability self-ID" });
    } else if (f.inputType === "checkbox" && /veteran|disability/.test(label)) {
      continue; // specific-category checkbox — left alone, per Compliance's own rule
    } else if (/previously worked (for|at) this company|worked (for|at) .* before|rehire/.test(label)) {
      instructions.push({ selector: f.selector, fieldType: "text", value: "No", confidence: "high", reasoning: "Standing default: previously worked here -> No" });
    } else if (/veteran/.test(label)) {
      instructions.push({ selector: f.selector, fieldType: "text", value: "No", confidence: "high", reasoning: "Standing default: veteran status -> No" });
    } else if (/disability/.test(label)) {
      instructions.push({ selector: f.selector, fieldType: "text", value: "No", confidence: "high", reasoning: "Standing default: disability status -> No" });
    } else if (/sponsorship|require.*visa/.test(label)) {
      instructions.push({ selector: f.selector, fieldType: "text", value: "No", confidence: "high", reasoning: "Standing default: visa sponsorship -> No" });
    } else if (/open to relocat|willing to relocat|relocation for this/.test(label)) {
      instructions.push({ selector: f.selector, fieldType: "text", value: "Yes", confidence: "high", reasoning: "Standing default: relocation -> Yes" });
    } else if (/how did you hear|how did you learn|hear about (us|this job)/.test(label)) {
      const opts: string[] = Array.isArray(f.options) ? f.options : [];
      const pick = opts.find((o: string) => /google/i.test(o)) || opts.find((o: string) => /job board|job site/i.test(o)) || opts[0] || "Google Search";
      instructions.push({ selector: f.selector, fieldType: opts.length ? "select" : "text", value: pick, confidence: "high", reasoning: `Standing default: source question -> "${pick}"` });
    }
  }
  return { instructions };
}

export function createMockProvider(): AiProvider {
  return {
    send: async (opts) => {
      const system = opts.system.toLowerCase();
      let automationId = "unknown";

      if (system.includes("copilot fill planner")) {
        const userText = userTextOf(opts);
        return jsonResponse(mockCopilotFillPlan(userText));
      }
      if (system.includes("copilot compliance")) {
        const userText = userTextOf(opts);
        const fields = extractJsonAfter(userText, "FORM SNAPSHOT (Detected Fields):");
        return jsonResponse(mockComplianceInstructions(Array.isArray(fields) ? fields : []));
      }
      if (system.includes("copilot form analyst")) {
        return jsonResponse({ atsGuess: "other:mock", structuralNotes: "" });
      }
      if (system.includes("copilot correction reviewer")) {
        const userText = userTextOf(opts);
        const aiMatch = userText.match(/AI's VALUE:\s*(.*)/);
        const finalMatch = userText.match(/FINAL VALUE \(after AE review\):\s*(.*)/);
        const aiVal = (aiMatch?.[1] ?? "").trim().toLowerCase();
        const finalVal = (finalMatch?.[1] ?? "").trim().toLowerCase();
        const isRealCorrection = aiVal !== finalVal;
        return jsonResponse({ isRealCorrection, reason: "mock: string comparison", shouldEscalateToCeo: false });
      }
      if (system.includes("copilot ceo")) {
        return jsonResponse({ proposals: [], tickets: [] });
      }
      if (system.includes("copilot cover letter")) {
        return jsonResponse({ letterText: "Dear Hiring Manager,\n\n(mock) This is a placeholder cover letter body generated by the local mock provider — no live AI configured here.\n\nSincerely," });
      }
      if (system.includes("copilot extension's in-panel chat assistant")) {
        const text = "(mock reply) I don't have a live AI provider configured locally, but the chat endpoint is wired up correctly.";
        return { content: [{ type: "text" as const, text }], stopReason: "end_turn" as const, usage: { input_tokens: 20, output_tokens: text.length } };
      }
      if (system.includes("job lens")) automationId = "application_job_lens";
      else if (system.includes("resume forge")) automationId = "application_resume_forge";
      else if (system.includes("hiring panel")) automationId = "application_hiring_panel";
      else if (system.includes("final polish")) automationId = "application_final_polish";
      else if (system.includes("target job")) automationId = "target_jobs_matching";
      else if (system.includes("tailor")) automationId = "application_tailoring";
      else if (system.includes("digest")) automationId = "ai_digest";
      else if (system.includes("categor")) automationId = "job_categorization";
      else if (system.includes("assistant") || system.includes("chat")) automationId = "chat_assistant";

      return buildResponse(automationId);
    },
  };
}
