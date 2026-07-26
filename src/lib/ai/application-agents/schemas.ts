// Runtime-validated schemas for every agent input/output.
// Uses plain validation to avoid Zod dependency. Each schema exposes:
//   parse(input: unknown): T | { error: string }

export interface Schema<T> {
  parse(input: unknown): T | { error: string };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function expectString(v: unknown, field: string): string | null {
  if (typeof v === "string") return v;
  return null;
}

function expectNumber(v: unknown, field: string): number | null {
  if (typeof v === "number") return v;
  return null;
}

function expectStringArray(v: unknown, field: string): string[] | null {
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  return null;
}

// ── JobAnalysisV1 ──

export interface JobAnalysisV1 {
  title: string;
  company: string;
  location: string | null;
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  methodologies: string[];
  certifications: string[];
  seniority: string | null;
  domain: string | null;
  atsKeywords: string[];
  responsibilities: string[];
  evidenceRequirements: string[];
  prohibitedUnsupportedClaims: string[];
  ambiguities: string[];
  rawSummary: string;
  roleContext?: Record<string, unknown>;
  topThreePageOneWins?: string[];
}

export const JobAnalysisSchema: Schema<JobAnalysisV1> = {
  parse(input: unknown): JobAnalysisV1 | { error: string } {
    if (!isRecord(input)) return { error: "JobAnalysisV1 must be an object" };
    const requiredSkills = expectStringArray(input.requiredSkills, "requiredSkills");
    const preferredSkills = expectStringArray(input.preferredSkills, "preferredSkills");
    const title = expectString(input.title, "title");
    const company = expectString(input.company, "company");
    if (!title) return { error: "title is required" };
    if (!company) return { error: "company is required" };
    return {
      title,
      company,
      location: expectString(input.location, "location"),
      requiredSkills: requiredSkills ?? [],
      preferredSkills: preferredSkills ?? [],
      tools: expectStringArray(input.tools, "tools") ?? [],
      methodologies: expectStringArray(input.methodologies, "methodologies") ?? [],
      certifications: expectStringArray(input.certifications, "certifications") ?? [],
      seniority: expectString(input.seniority, "seniority"),
      domain: expectString(input.domain, "domain"),
      atsKeywords: expectStringArray(input.atsKeywords, "atsKeywords") ?? [],
      responsibilities: expectStringArray(input.responsibilities, "responsibilities") ?? [],
      evidenceRequirements: expectStringArray(input.evidenceRequirements, "evidenceRequirements") ?? [],
      prohibitedUnsupportedClaims: expectStringArray(input.prohibitedUnsupportedClaims, "prohibitedUnsupportedClaims") ?? [],
      ambiguities: expectStringArray(input.ambiguities, "ambiguities") ?? [],
      rawSummary: expectString(input.rawSummary, "rawSummary") ?? "",
      roleContext: isRecord(input.roleContext) ? input.roleContext : undefined,
      topThreePageOneWins: expectStringArray(input.topThreePageOneWins, "topThreePageOneWins") ?? undefined,
    };
  },
};

// ── ResumeDraftV1 ──

export interface ExperienceEntry {
  title: string;
  company: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
  evidenceIds: string[];
}

export interface SkillGroup {
  title: string;
  skills: string[];
}

export interface ResumeDraftV1 {
  summary: string | null;
  skills: SkillGroup[];
  experience: ExperienceEntry[];
  education: {
    degree: string;
    school: string;
    field: string | null;
    graduationDate: string | null;
  }[];
  certifications: string[];
  projects: { name: string; description: string; technologies: string[] }[];
  changeLog: { change: string; reason: string; evidenceId: string | null }[];
  missingRequirements: string[];
  excludedKeywords: string[];
  truthRisks: { risk: string; severity: "low" | "medium" | "high" }[];
}

// Accepts the categorized shape ({title, skills}[]) the agents are now prompted to return.
// Also accepts a flat string[] as a fallback (wrapped into one "Skills" group) so an agent
// that ignores the categorized instruction still produces a valid, renderable result instead
// of failing validation outright.
function parseSkillGroups(v: unknown): SkillGroup[] {
  if (!Array.isArray(v)) return [];
  if (v.every((x) => typeof x === "string")) {
    const flat = v as string[];
    return flat.length > 0 ? [{ title: "Skills", skills: flat }] : [];
  }
  const groups: SkillGroup[] = [];
  for (const g of v) {
    if (!isRecord(g)) continue;
    const title = expectString(g.title, "title");
    const skills = expectStringArray(g.skills, "skills");
    if (!title || !skills) continue;
    groups.push({ title, skills });
  }
  return groups;
}

function parseExperienceEntry(v: unknown): ExperienceEntry | null {
  if (!isRecord(v)) return null;
  const title = expectString(v.title, "title");
  if (!title) return null;
  return {
    title,
    company: expectString(v.company, "company") ?? "",
    location: expectString(v.location, "location"),
    startDate: expectString(v.startDate, "startDate"),
    endDate: expectString(v.endDate, "endDate"),
    bullets: Array.isArray(v.bullets) ? v.bullets.filter((b): b is string => typeof b === "string") : (Array.isArray(v.bulletPoints) ? v.bulletPoints.filter((b): b is string => typeof b === "string") : []),
    evidenceIds: Array.isArray(v.evidenceIds) ? v.evidenceIds.filter((e): e is string => typeof e === "string") : [],
  };
}

export const ResumeDraftSchema: Schema<ResumeDraftV1> = {
  parse(input: unknown): ResumeDraftV1 | { error: string } {
    if (!isRecord(input)) return { error: "ResumeDraftV1 must be an object" };
    const skills = parseSkillGroups(input.skills);
    const experience = Array.isArray(input.experience) ? input.experience.map(parseExperienceEntry).filter((e): e is ExperienceEntry => e !== null) : [];
    const truthRisks: { risk: string; severity: "low" | "medium" | "high" }[] = [];
    if (Array.isArray(input.truthRisks)) {
      for (const r of input.truthRisks) {
        if (!isRecord(r) || typeof r.risk !== "string" || !["low", "medium", "high"].includes(r.severity as string)) {
          return { error: `Invalid truthRisk severity: ${JSON.stringify(r)}` };
        }
        truthRisks.push(r as any);
      }
    }
    return {
      summary: expectString(input.summary, "summary"),
      skills,
      experience,
      education: Array.isArray(input.education) ? input.education.filter((e: unknown): e is { degree: string; school: string; field: string | null; graduationDate: string | null } => {
        if (!isRecord(e)) return false;
        return typeof e.degree === "string" && typeof e.school === "string";
      }).map((e) => ({
        degree: e.degree,
        school: e.school,
        field: e.field ?? null,
        graduationDate: e.graduationDate ?? null,
      })) : [],
      certifications: expectStringArray(input.certifications, "certifications") ?? [],
      projects: Array.isArray(input.projects) ? input.projects.filter((p: unknown): p is { name: string; description: string; technologies: string[] } => {
        if (!isRecord(p)) return false;
        return typeof p.name === "string";
      }).map((p) => ({
        name: p.name,
        description: p.description ?? "",
        technologies: Array.isArray(p.technologies) ? p.technologies.filter((t: unknown): t is string => typeof t === "string") : [],
      })) : [],
      changeLog: Array.isArray(input.changeLog) ? input.changeLog.filter((c: unknown): c is { change: string; reason: string; evidenceId: string | null } => {
        if (!isRecord(c)) return false;
        return typeof c.change === "string" && typeof c.reason === "string";
      }).map((c) => ({
        change: c.change,
        reason: c.reason,
        evidenceId: c.evidenceId ?? null,
      })) : [],
      missingRequirements: expectStringArray(input.missingRequirements, "missingRequirements") ?? [],
      excludedKeywords: expectStringArray(input.excludedKeywords, "excludedKeywords") ?? [],
      truthRisks,
    };
  },
};

// ── ReviewScoreV1 ──

export interface ReviewScoreV1 {
  atsScore: number;
  recruiterScore: number;
  roleFitScore: number;
  truthfulnessRisk: number;
  naturalLanguageCheck?: number;
  formattingIssues: string[];
  requiredEdits: { issueId: string; description: string; severity: "minor" | "major" | "critical" }[];
  optionalEdits: { issueId: string; description: string }[];
  passFail: "pass" | "fail" | "review";
  overallComment: string;
}

export const ReviewScoreSchema: Schema<ReviewScoreV1> = {
  parse(input: unknown): ReviewScoreV1 | { error: string } {
    if (!isRecord(input)) return { error: "ReviewScoreV1 must be an object" };
    const atsScore = expectNumber(input.atsScore, "atsScore");
    const recruiterScore = expectNumber(input.recruiterScore, "recruiterScore");
    const roleFitScore = expectNumber(input.roleFitScore, "roleFitScore");
    const truthfulnessRisk = expectNumber(input.truthfulnessRisk, "truthfulnessRisk");
    const passFail = expectString(input.passFail, "passFail");
    if (atsScore === null) return { error: "atsScore is required" };
    if (recruiterScore === null) return { error: "recruiterScore is required" };
    if (roleFitScore === null) return { error: "roleFitScore is required" };
    if (atsScore < 0 || atsScore > 10) return { error: `atsScore must be 0-10, got ${atsScore}` };
    if (recruiterScore < 0 || recruiterScore > 10) return { error: `recruiterScore must be 0-10, got ${recruiterScore}` };
    if (roleFitScore < 0 || roleFitScore > 10) return { error: `roleFitScore must be 0-10, got ${roleFitScore}` };
    if (truthfulnessRisk !== null && (truthfulnessRisk < 0 || truthfulnessRisk > 10)) return { error: `truthfulnessRisk must be 0-10, got ${truthfulnessRisk}` };
    const requiredEdits: { issueId: string; description: string; severity: "minor" | "major" | "critical" }[] = [];
    if (Array.isArray(input.requiredEdits)) {
      for (const e of input.requiredEdits) {
        if (!isRecord(e) || typeof e.issueId !== "string" || typeof e.description !== "string" || !["minor", "major", "critical"].includes(e.severity as string)) {
          return { error: `Invalid requiredEdit: ${JSON.stringify(e)}` };
        }
        requiredEdits.push(e as any);
      }
    }
    return {
      atsScore,
      recruiterScore,
      roleFitScore,
      truthfulnessRisk: truthfulnessRisk ?? 0,
      naturalLanguageCheck: expectNumber(input.naturalLanguageCheck, "naturalLanguageCheck") ?? undefined,
      formattingIssues: expectStringArray(input.formattingIssues, "formattingIssues") ?? [],
      requiredEdits,
      optionalEdits: Array.isArray(input.optionalEdits) ? input.optionalEdits.filter((e: unknown): e is { issueId: string; description: string } => {
        if (!isRecord(e)) return false;
        return typeof e.issueId === "string" && typeof e.description === "string";
      }) : [],
      passFail: passFail === "pass" || passFail === "fail" || passFail === "review" ? passFail : "review",
      overallComment: expectString(input.overallComment, "overallComment") ?? "",
    };
  },
};

// ── FinalResumeV1 ──

export interface FinalResumeV1 {
  summary: string | null;
  skills: SkillGroup[];
  experience: ExperienceEntry[];
  education: { degree: string; school: string; field: string | null; graduationDate: string | null }[];
  certifications: string[];
  projects: { name: string; description: string; technologies: string[] }[];
  appliedIssueIds: string[];
  rejectedIssueIds: { issueId: string; reason: string }[];
  unresolvedWarnings: string[];
  finalQaScore: number;
  exportReady: boolean;
}

export const FinalResumeSchema: Schema<FinalResumeV1> = {
  parse(input: unknown): FinalResumeV1 | { error: string } {
    if (!isRecord(input)) return { error: "FinalResumeV1 must be an object" };
    return {
      summary: expectString(input.summary, "summary"),
      skills: parseSkillGroups(input.skills),
      experience: Array.isArray(input.experience) ? input.experience.map(parseExperienceEntry).filter((e): e is ExperienceEntry => e !== null) : [],
      education: Array.isArray(input.education) ? input.education.filter((e: unknown): e is { degree: string; school: string; field: string | null; graduationDate: string | null } => {
        if (!isRecord(e)) return false;
        return typeof e.degree === "string" && typeof e.school === "string";
      }).map((e) => ({ degree: e.degree, school: e.school, field: e.field ?? null, graduationDate: e.graduationDate ?? null })) : [],
      certifications: expectStringArray(input.certifications, "certifications") ?? [],
      projects: Array.isArray(input.projects) ? input.projects.filter((p: unknown): p is { name: string; description: string; technologies: string[] } => {
        if (!isRecord(p)) return false;
        return typeof p.name === "string";
      }).map((p) => ({ name: p.name, description: p.description ?? "", technologies: Array.isArray(p.technologies) ? p.technologies.filter((t: unknown): t is string => typeof t === "string") : [] })) : [],
      appliedIssueIds: expectStringArray(input.appliedIssueIds, "appliedIssueIds") ?? [],
      rejectedIssueIds: Array.isArray(input.rejectedIssueIds) ? input.rejectedIssueIds.filter((r: unknown): r is { issueId: string; reason: string } => {
        if (!isRecord(r)) return false;
        return typeof r.issueId === "string" && typeof r.reason === "string";
      }) : [],
      unresolvedWarnings: expectStringArray(input.unresolvedWarnings, "unresolvedWarnings") ?? [],
      finalQaScore: expectNumber(input.finalQaScore, "finalQaScore") ?? 0,
      exportReady: input.exportReady === true,
    };
  },
};

// ── CopilotFillPlanV1 ──

export interface FillInstruction {
  selector: string;
  fieldType: "text" | "select" | "radio" | "checkbox" | "date" | "file" | "skip" | "ai_answer";
  value: string | boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface CopilotFillPlanV1 {
  instructions: FillInstruction[];
}

export const CopilotFillPlanSchema: Schema<CopilotFillPlanV1> = {
  parse(input: unknown): CopilotFillPlanV1 | { error: string } {
    if (!isRecord(input)) return { error: "CopilotFillPlanV1 must be an object" };
    
    const instructions: FillInstruction[] = [];
    if (Array.isArray(input.instructions)) {
      for (const inst of input.instructions) {
        if (!isRecord(inst) || typeof inst.selector !== "string" || typeof inst.reasoning !== "string") {
          return { error: `Invalid FillInstruction: missing selector or reasoning` };
        }
        if (!["text", "select", "radio", "checkbox", "date", "file", "skip", "ai_answer"].includes(inst.fieldType as string)) {
          return { error: `Invalid fieldType: ${inst.fieldType}` };
        }
        if (!["high", "medium", "low"].includes(inst.confidence as string)) {
          return { error: `Invalid confidence: ${inst.confidence}` };
        }
        instructions.push({
          selector: inst.selector,
          fieldType: inst.fieldType as any,
          value: typeof inst.value === "boolean" ? inst.value : String(inst.value ?? ""),
          confidence: inst.confidence as any,
          reasoning: inst.reasoning
        });
      }
    }
    return { instructions };
  }
};

// ── CopilotAnswerV1 ──

export interface CopilotAnswerV1 {
  answer: string;
  confidence: "high" | "medium" | "low";
}

export const CopilotAnswerSchema: Schema<CopilotAnswerV1> = {
  parse(input: unknown): CopilotAnswerV1 | { error: string } {
    if (!isRecord(input)) return { error: "CopilotAnswerV1 must be an object" };
    
    const answer = expectString(input.answer, "answer");
    const confidence = expectString(input.confidence, "confidence");
    
    if (answer === null) return { error: "answer is required" };
    if (!["high", "medium", "low"].includes(confidence as string)) return { error: "confidence must be high, medium, or low" };
    
    return { answer, confidence: confidence as any };
  }
};
