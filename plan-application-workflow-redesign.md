# TalentOS Application Workflow Redesign + In-House AI Architecture Plan

## Date: 2026-06-19
## Status: Planning Only — Do Not Execute Yet

---

## 1. Current Workflow Problems

### 1.1 Job Masterlist Bottleneck
**Current state:** Applications must reference a job from the master list (`jobs` table). This creates friction:
- AE finds a job on LinkedIn/Indeed/company portal → must copy-paste JD → create job in master list → then create application
- The job masterlist is often stale (jobs posted weeks ago, already filled, links dead)
- No auto-categorization from pasted JD → manual data entry for title, company, location, type

**Impact:** AE wastes 2-3 minutes per application just on job entry. With 50 applications/day, that's 2+ hours of data entry.

### 1.2 Base Resume as Gate
**Current state:** Creating an application requires selecting a base resume first. This creates:
- A hard dependency: no base resume → no application
- Pressure to create base resumes before knowing if a candidate is a good fit
- Redundant work: a candidate might have 5 base resumes for 5 different industries, but only 1 is ever used

**Impact:** Slows down the "apply first, refine later" workflow that many AEs prefer.

### 1.3 Pasted JD Is Wasted
**Current state:** When AE pastes a JD during application creation, it goes into `target_jobs.raw_description` but:
- The `jobs` masterlist remains untouched
- No auto-extraction of structured data (title, company, location, salary, requirements)
- The same JD may be pasted 10 times by different AEs for different candidates

**Impact:** Zero knowledge reuse. No job database enrichment. No deduplication.

---

## 2. Proposed Workflow Changes

### 2.1 Ad-Hoc Application Creation (No Job Masterlist Required)

**New flow:**
```
AE clicks "New Application" → chooses candidate → pastes JD → AI analyzes JD →
Application is created with an embedded/ad-hoc job record → AE proceeds to keyword approval
```

**Key changes:**
- `applications` table no longer requires `job_id` (FK becomes nullable)
- New field: `applications.adhoc_job_data JSONB` — stores the AI-parsed job data inline
- If AE later wants to link to a masterlist job, they can "promote" the ad-hoc job to the masterlist
- The masterlist job gets auto-created from the parsed data with a single click

**Data model change:**
```sql
alter table applications
  drop constraint if exists applications_job_id_fkey,
  alter column job_id drop not null,  -- if it was not null
  add column adhoc_job_data jsonb,    -- inline parsed job data
  add column adhoc_job_raw_text text;  -- raw JD text for reference
```

### 2.2 Auto-Create Job from Pasted JD

**New flow when pasting JD:**
1. AE pastes JD into application creation (or a standalone "Paste JD" tool)
2. AI extracts structured data: title, company, location, salary, requirements, skills, seniority, etc.
3. System checks: does this job already exist in the masterlist? (deduplication by company + title + location fuzzy match)
4. If not found → auto-create a `jobs` record with AI-extracted data + `source: 'pasted_jd'` + `status: 'draft'`
5. The application now links to this newly created job
6. AE can review/edit the extracted data before confirming

**Deduplication logic:**
- Hash: normalize(company_name + job_title + location) → compare against existing jobs
- Fuzzy match: use Levenshtein distance on title + company
- If similarity > 85%, show "This job already exists: [link]" and offer to use existing or create new

**Data model change:**
```sql
alter table jobs
  add column source text default 'manual',  -- 'manual' | 'pasted_jd' | 'imported' | 'scraped'
  add column raw_description text,          -- original pasted text
  add column parsed_description jsonb,      -- AI-extracted structured data
  add column ai_extracted_at timestamptz,   -- when AI parsed it
  add column ai_confidence_score numeric;   -- 0-1, how confident AI is
```

### 2.3 Bypass Base Resume Option

**New flow:**
```
AE creates application → selects candidate → system shows:
  [Use Base Resume]  [Use Original Resume]  [Start Blank]
```

**Option A: Use Base Resume** (existing flow)
- Select from candidate's base resumes
- Proceed to JD analysis → keyword approval → tailoring

**Option B: Use Original Resume** (new)
- System uses the candidate's uploaded/parsed resume directly
- No base resume creation required
- AI tailors the original resume content against the JD
- Faster for one-off applications where quality of base resume isn't critical

**Option C: Start Blank** (new)
- Minimal resume structure from candidate profile data
- AE builds the resume from scratch in the studio
- Useful for candidates with no uploaded resume

**Data model change:**
```sql
-- application_resume_versions already has base_resume_id as nullable
-- No schema change needed! Just allow null base_resume_id and add a flag:
alter table application_resume_versions
  add column source_type text default 'base_resume';  -- 'base_resume' | 'original_resume' | 'blank' | 'manual'
```

---

## 3. AI Layer Architecture (In-House)

### 3.1 AI Provider Abstraction (Already Exists)

Current: `src/lib/ai/` with provider pattern
- `anthropicProvider.ts` → Claude
- `nvidiaProvider.ts` → Llama
- `getActiveProvider()` → selects based on env/config

**This is good. Keep it.**

### 3.2 AI Capabilities by Workflow Stage

#### Stage A: Candidate Profile Setup
| Capability | Description | AI Action |
|---|---|---|
| Resume Parsing | Extract structured data from PDF/DOCX | `POST /api/candidates/{id}/resumes` with `is_original_upload=true` → AI parses → stores in `parsed_json` |
| Profile Auto-Fill | Suggest candidate profile fields from parsed resume | `suggestProfileFields(parsedResume)` → returns { name, email, phone, skills, education, experience } |
| Evidence Bank Generation | Convert parsed resume into evidence entries | `parsedResumeToEvidence()` → inserts into `candidate_evidence` |
| Gap Analysis | Identify missing information from candidate profile | `analyzeGaps(candidate)` → returns list of missing fields + suggested questions to ask candidate |
| Skill Categorization | Auto-group skills into industry categories (OSP, software, embedded, etc.) | `categorizeSkills(skills[], industry)` → returns { category: string, skills: string[] }[] |

#### Stage B: Base Resume Creation
| Capability | Description | AI Action |
|---|---|---|
| Base Resume Draft | Generate initial base resume from candidate profile + evidence | `POST /api/falood/command` with mode='base_resume_creation', command='/create-base' |
| Skarion Formatting | Convert any resume into Skarion format | `makeSkarionStyle(resumeContent)` → returns structured ResumeDocument |
| Bullet Improvement | Rewrite experience bullets to be action-oriented, quantified, technical | `improveBullets(bullets[], evidence[])` → returns improved bullets with evidence links |
| Truth Check | Flag claims in resume that lack evidence | `truthCheck(resumeContent, evidenceBank)` → returns { claim, riskLevel, evidenceStatus, suggestion }[] |
| Skill Organization | Group skills into industry-specific categories | `organizeSkills(skills[], targetIndustry)` → returns SkillSection[] |
| AI Slop Removal | Detect and remove generic AI-sounding language | `removeAiSlop(text)` → returns cleaned text + flagged phrases |
| Section Expansion/Shortening | Adjust length of a section while keeping key points | `adjustSection(section, targetLength, keepKeywords[])` → returns revised section |

#### Stage C: Job Description Analysis (JD Analyzer)
| Capability | Description | AI Action |
|---|---|---|
| JD Parsing | Extract structured data from raw JD text | `parseJD(rawText)` → returns JDAnalysis JSON |
| Job Deduplication | Check if parsed job already exists in masterlist | `findDuplicateJob(parsedJob)` → returns existing job ID or null |
| Auto-Create Job | Create a `jobs` record from parsed JD data | `createJobFromParsed(parsedJD)` → inserts into `jobs` table |
| Fit Scoring | Score candidate-job fit based on evidence + resume | `calculateFit(candidate, job)` → returns { score, matchedSkills, missingSkills, recommendation } |
| Keyword Extraction | Extract keywords from JD with category and importance | `extractKeywords(jdAnalysis)` → returns JobKeyword[] |
| Red Flag Detection | Identify problematic JD signals | `detectRedFlags(jdText)` → returns { flag, severity, reason }[] |

#### Stage D: Keyword Approval + Resume Tailoring
| Capability | Description | AI Action |
|---|---|---|
| Evidence Mapping | Map each keyword to evidence bank items | `mapEvidenceToKeyword(keyword, evidenceBank)` → returns { evidenceId, strength }[] |
| Keyword Recommendation | Recommend action per keyword (inject, reject, cover letter, etc.) | `recommendKeywordAction(keyword, evidence)` → returns { decision, reason, confidence } |
| Suggestion Generation | Generate Grammarly-style resume edit suggestions | `generateSuggestions(resume, approvedKeywords, rejectedKeywords)` → returns ResumeSuggestion[] |
| ATS Optimization | Check resume against ATS requirements | `atsCheck(resume, jobKeywords)` → returns { score, missingKeywords, formattingIssues }[] |
| One-Page Fit | Calculate if resume fits one page and suggest adjustments | `onePageFit(resume, formatting)` → returns { pageCount, suggestions, overflowSections } |
| Custom Instruction Processing | Handle natural language editing requests | `processCustomInstruction(resume, instruction, context)` → returns { action, revisedContent, reason } |

#### Stage E: PDF Export + Finalization
| Capability | Description | AI Action |
|---|---|---|
| PDF Generation | Generate PDF from ResumeDocument JSON | `generatePDF(resumeDocument, formatting)` → returns PDF bytes |
| Auto-Fit Engine | Apply ordered rules to fit resume to one page | `autoFit(resume, formatting)` → returns { resume, formatting, changes } |
| Formatting Optimization | Suggest formatting changes (margins, spacing, font size) | `optimizeFormatting(resume, targetPages)` → returns FormattingPatch |
| DOCX Generation | Generate DOCX from ResumeDocument | `generateDOCX(resumeDocument, formatting)` → returns DOCX bytes |
| ATS Plain Text | Generate plain text version for ATS | `generatePlainText(resume)` → returns string |

#### Stage F: Application Packet + Cover Letter
| Capability | Description | AI Action |
|---|---|---|
| Cover Letter Generation | Generate cover letter from resume + JD | `generateCoverLetter(candidate, job, tone)` → returns cover letter text |
| Recruiter Message | Generate LinkedIn/message for recruiter outreach | `generateRecruiterMessage(candidate, job)` → returns message text |
| Interview Prep | Generate interview questions and talking points | `generateInterviewPrep(candidate, job)` → returns { questions, talkingPoints, weaknesses } |
| Follow-Up Messages | Generate follow-up emails (3-day, 7-day) | `generateFollowUp(candidate, job, days)` → returns message text |
| "Why This Role" | Generate candidate's answer to "Why this role?" | `generateWhyThisRole(candidate, job)` → returns answer text |

#### Stage G: Quality Control (Reviewer)
| Capability | Description | AI Action |
|---|---|---|
| Claim Verification | Cross-reference resume claims against evidence bank | `verifyClaims(resume, evidenceBank)` → returns { claim, status, evidence }[] |
| Plagiarism/AI Slop Detection | Detect non-original or AI-sounding content | `detectAiSlop(resume)` → returns { section, phrase, confidence }[] |
| Compliance Check | Ensure resume meets Skarion standards | `complianceCheck(resume)` → returns { issue, severity, suggestion }[] |
| Reviewer Summary | Generate a summary for reviewer review | `generateReviewerSummary(resume, packet, history)` → returns structured review notes |

---

## 4. New AI Service Architecture

### 4.1 Service Layer
```
src/lib/ai/
├── index.ts                    # getActiveProvider(), registerProvider()
├── provider.ts                 # Base provider interface (AiProvider, AiMessage, etc.)
├── anthropicProvider.ts        # Claude integration
├── nvidiaProvider.ts           # Llama/DeepSeek integration
├── falood/                     # Falood-specific AI services
│   ├── index.ts                # Export all Falood AI functions
│   ├── resumeParser.ts         # extractText + parseResumeFields (already exists)
│   ├── jdAnalyzer.ts           # parseJD + extractKeywords + fitScore
│   ├── baseResumeBuilder.ts    # createBase + makeSkarionStyle + improveBullets (already exists as faloodBaseResume.ts)
│   ├── resumeTailor.ts         # generateSuggestions + atsCheck + onePageFit
│   ├── evidenceMapper.ts       # mapEvidenceToKeyword + recommendKeywordAction
│   ├── truthChecker.ts         # truthCheck + claimVerification
│   ├── aiSlopDetector.ts       # removeAiSlop + detectAiSlop
│   ├── formatter.ts            # autoFit + optimizeFormatting
│   ├── packetGenerator.ts      # coverLetter + recruiterMessage + interviewPrep
│   └── reviewer.ts             # complianceCheck + reviewerSummary
```

### 4.2 AI Function Interface Pattern
```typescript
// Each AI function is a pure async function with structured input/output
// No direct database mutations — the caller handles persistence

export interface JdAnalysisInput {
  rawText: string;
  candidateId?: string;  // optional, for fit scoring
}

export interface JdAnalysisOutput {
  title: string | null;
  company: string | null;
  location: string | null;
  workplaceType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  responsibilities: string[];
  seniorityLevel: string | null;
  yearsExperience: string | null;
  domainKeywords: string[];
  softSkills: string[];
  atsKeywords: string[];
  visaSignals: string[];
  redFlags: string[];
  fitSummary: string;
  confidenceScore: number;  // 0-1, AI confidence in extraction
}

export async function analyzeJD(input: JdAnalysisInput): Promise<JdAnalysisOutput> {
  const active = getActiveProvider();
  if (!active) return createEmptyJdAnalysis();
  // Build prompt, call AI, parse JSON, validate output, return
}
```

### 4.3 AI Command Router Extension
The existing `/api/falood/command` route needs to handle all modes:
```typescript
type FaloodMode =
  | 'candidate_profile_setup'
  | 'base_resume_creation'
  | 'application_resume_tailoring'
  | 'pdf_preview_adjustment'
  | 'application_packet'
  | 'ticket_closure'
  | 'job_description_analysis';  // NEW
```

Each mode maps to a handler function:
```typescript
const handlers: Record<FaloodMode, (ctx: FaloodContext, input: FaloodInput) => Promise<FaloodResponse>> = {
  'candidate_profile_setup': handleCandidateProfileSetup,
  'base_resume_creation': handleBaseResumeCreation,      // already exists
  'application_resume_tailoring': handleApplicationTailoring, // needs build
  'pdf_preview_adjustment': handlePdfAdjustment,           // needs build
  'application_packet': handleApplicationPacket,            // needs build
  'ticket_closure': handleTicketClosure,                  // needs build
  'job_description_analysis': handleJobDescriptionAnalysis, // NEW
};
```

### 4.4 AI Prompt Engineering Standards
All AI prompts must enforce:
1. **Do not fabricate** — if evidence is missing, mark as missing, don't invent
2. **Do not hallucinate skills** — only claim skills that appear in evidence or resume
3. **Skarion format** — all output must follow Skarion resume formatting rules
4. **Concise bullets** — action-oriented, quantified, technical
5. **Explain edits** — every suggestion must include a reason
6. **Separate content from formatting** — content suggestions and formatting suggestions are different
7. **Respect rejected keywords** — never suggest injecting a rejected keyword
8. **One-page only in final export** — base resumes can be longer, application resumes must be one page

---

## 5. Data Model Changes Summary

### 5.1 Applications Table (Ad-Hoc Job Support)
```sql
alter table applications
  alter column job_id drop not null,
  add column adhoc_job_data jsonb,
  add column adhoc_job_raw_text text,
  add column source_type text default 'base_resume';  -- 'base_resume' | 'original_resume' | 'blank' | 'manual'
```

### 5.2 Jobs Table (Auto-Create from JD)
```sql
alter table jobs
  add column source text default 'manual',
  add column raw_description text,
  add column parsed_description jsonb,
  add column ai_extracted_at timestamptz,
  add column ai_confidence_score numeric;

-- Index for deduplication queries
create index jobs_company_title_idx on jobs (company_id, title);
create index jobs_ai_extracted_at_idx on jobs (ai_extracted_at) where ai_extracted_at is not null;
```

### 5.3 Application Resume Versions (Source Tracking)
```sql
alter table application_resume_versions
  add column source_type text default 'base_resume';  -- 'base_resume' | 'original_resume' | 'blank' | 'manual'
```

### 5.4 New Table: Job Duplicates (Optional, for Deduplication Tracking)
```sql
create table job_duplicates (
  id uuid primary key default gen_random_uuid(),
  canonical_job_id uuid references jobs(id) on delete cascade,
  duplicate_job_id uuid references jobs(id) on delete cascade,
  similarity_score numeric not null,
  resolved boolean default false,
  created_at timestamptz default now(),
  unique (canonical_job_id, duplicate_job_id)
);
```

---

## 6. UI/UX Changes

### 6.1 New Application Button (Global)
Add a **"+ New Application"** button in the top nav bar (next to notifications).
- Dropdown: "Quick Application" | "Full Application"
- Quick: pick candidate → paste JD → AI analyzes → auto-creates application → redirects to studio
- Full: opens the existing 6-step wizard

### 6.2 Application Creation Modal (Simplified)
```
┌────────────────────────────────────────────┐
│  New Application                            │
├────────────────────────────────────────────┤
│  Candidate: [Search dropdown]              │
│  ┌────────────────────────────────────┐   │
│  │ Paste Job Description (or link)   │   │
│  │                                    │   │
│  │ [Paste text area]                  │   │
│  │                                    │   │
│  │ [Auto-Analyze]                     │   │
│  └────────────────────────────────────┘   │
│                                             │
│  -- OR --                                   │
│                                             │
│  Select from masterlist: [dropdown]         │
│                                             │
│  Resume Source:                             │
│  ○ Use base resume      [dropdown]       │
│  ○ Use original resume   (auto-parsed)    │
│  ○ Start blank                            │
│                                             │
│  [Create Application]  [Cancel]            │
└────────────────────────────────────────────┘
```

### 6.3 AI-Extracted Job Preview (After Paste)
After AE pastes JD and clicks "Auto-Analyze", show a card:
```
┌────────────────────────────────────────────┐
│  📋 AI-Extracted Job Details                │
│  Title: Software Engineer                   │
│  Company: TechCorp (auto-detected)          │
│  Location: Remote (US)                      │
│  Salary: $120k-$150k (detected)             │
│  Type: Full-time | Remote                   │
│  Seniority: Mid-level                       │
│  Confidence: 92%                            │
│  [✏ Edit]  [✅ Use This]  [❌ Re-paste]     │
│                                             │
│  Keywords found: React, Node.js, AWS...     │
│  ⚠️ Red flag: "5+ years" (candidate has 3) │
└────────────────────────────────────────────┘
```

### 6.4 Job Masterlist Auto-Enrichment
When a job is auto-created from a pasted JD, show it in the masterlist with a special badge:
- 🟡 "AI-Extracted — needs review"
- After a manager reviews and edits: 🟢 "Verified"
- After 30 days: 🟠 "Stale — check if still active"

### 6.5 Resume Source Selector in Studio
In the Application Resume Studio, add a dropdown at the top:
```
Resume Source: [Base Resume: OSP Telecom ▼] [Switch to Original] [Switch to Blank]
```
- Switching sources preserves the current work but warns about losing unsaved changes
- "Original" uses the candidate's parsed resume JSON as the starting content
- "Blank" starts with just the candidate's name, contact, and education from profile

---

## 7. Implementation Order (Recommended)

### Phase 1: Foundation (Week 1-2)
1. Schema changes (applications, jobs, application_resume_versions)
2. AI service layer: `jdAnalyzer.ts` (JD parsing + job creation)
3. API route: `POST /api/jobs/analyze` (already partially exists)
4. API route: `POST /api/jobs/from-jd` (auto-create job from parsed JD)
5. Frontend: Simplified application creation modal

### Phase 2: Ad-Hoc Applications (Week 2-3)
1. Make `applications.job_id` nullable
2. Add `adhoc_job_data` and `source_type` fields
3. Update application creation flow to support "no masterlist job"
4. Update application wizard to show "Paste JD" as primary option
5. Add "Use Original Resume" and "Start Blank" options

### Phase 3: AI Layer Expansion (Week 3-4)
1. Build `resumeTailor.ts` (suggestion generation, ATS check, one-page fit)
2. Build `evidenceMapper.ts` (keyword-to-evidence mapping)
3. Build `truthChecker.ts` (claim verification)
4. Build `aiSlopDetector.ts` (AI slop detection + removal)
5. Extend `/api/falood/command` with `application_resume_tailoring` mode

### Phase 4: PDF Export + Finalization (Week 4-5)
1. Integrate `@react-pdf/renderer` for real PDF generation
2. Build `autoFit` engine (ordered rules for one-page fit)
3. Build `formatter.ts` (margin/spacing optimization)
4. Add PDF preview in Application Studio

### Phase 5: Application Packet + Cover Letter (Week 5-6)
1. Build `packetGenerator.ts` (cover letter, recruiter message, interview prep)
2. Add cover letter generation to studio
3. Add "Generate Application Packet" button
4. Add ticket closure with proof upload

### Phase 6: Quality Control (Week 6-7)
1. Build `reviewer.ts` (compliance check, reviewer summary)
2. Enhance `/review` page with AI-generated reviewer notes
3. Add claim verification badges to resume preview
4. Add AI slop detection warnings

### Phase 7: Polish (Week 7-8)
1. Job deduplication engine
2. Stale job detection (auto-archive jobs > 60 days old)
3. Performance optimization (AI caching, response streaming)
4. Full integration testing (4 scenarios from brief)

---

## 8. Success Metrics

| Metric | Before | After |
|---|---|---|
| Time to create application | 3-5 min | 1-2 min |
| Job data entry per application | 2-3 min | 0 min (auto) |
| Base resume required | Yes | Optional |
| JD reuse rate | 0% | >50% (via auto-created jobs) |
| AI suggestions per application | 0 | 15-25 |
| One-page fit success rate | N/A | >90% |
| Reviewer approval time | N/A | <5 min per resume |
| AE satisfaction (subjective) | 6/10 | 9/10 |

---

## 9. Risk Mitigation

| Risk | Mitigation |
|---|---|
| AI extracts wrong job data | Show confidence score, allow edit, require confirmation |
| Auto-created job is a duplicate | Deduplication engine, fuzzy matching, manual review queue |
| Original resume is low quality | Warn AE, suggest creating base resume instead |
| AI suggestions are bad | "Reject All" button, customizable threshold, human must approve |
| PDF generation is slow | Cache rendered PDFs, async generation with notification |
| One-page fit removes important content | Ordered rules, never remove without asking, preserve keywords |
| Supabase limits (AI rate) | Cache AI responses, use cheaper models for simple tasks, batch requests |
| Cost of AI at scale | Use local models (Ollama) for simple tasks, reserve Claude for complex tasks |

---

## 10. Conclusion

This plan transforms TalentOS from a **rigid job-list-dependent system** into a **flexible, AI-first application workflow** where:
- AEs can create applications in **under 2 minutes** (paste JD → AI analyzes → auto-creates job → proceeds to tailoring)
- Job masterlist **auto-enriches** from every pasted JD
- Base resumes are **optional**, not mandatory
- AI is a **co-pilot** at every stage, not a replacement for human judgment
- The system **learns** from every application (deduplication, keyword tracking, fit scoring)

**Next step:** Approve this plan, then I'll implement Phase 1 (foundation) first.
