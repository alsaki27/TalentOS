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
  overallComment: "Strong candidate with excellent TypeScript and React experience. Resume is well-structured and ATS-friendly.",
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

export function createMockProvider(): AiProvider {
  return {
    send: async (opts) => {
      const system = opts.system.toLowerCase();
      let automationId = "unknown";

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
