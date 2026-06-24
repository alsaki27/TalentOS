# Falood AI Full Implementation Plan

## Objective
Complete all 6 phases of the Falood AI resume/application studio on TalentOS.

## Current State
- Phase 1: ✅ Candidate profile extension, resume parsing, evidence bank
- Phase 2 partial: ✅ Types, base-resumes CRUD API, Falood command route, faloodBaseResume.ts AI handler, studio page skeleton
- Phases 3-6: ❌ Not built yet (tables exist in migration, no code)

## Architecture Decision
Build on existing Supabase stack. Evaluate backend migration as a post-completion improvement.

## Phase 2: Complete Base Resume Studio
### Backend
- `GET /api/base-resumes/[id]` — get single base resume with full content
- `PATCH /api/base-resumes/[id]` — update content, name, status, etc.
- `POST /api/base-resumes/[id]/apply-draft` — apply a Falood action to the base resume content
- `POST /api/falood/command` — already exists for base_resume_creation, extend with more commands

### Frontend
- `/falood/studio/base/[baseResumeId]` — 3-pane layout:
  - Left: Candidate context (profile, evidence bank, original resume parsed data)
  - Center: Base resume draft (structured editor for ResumeDocument JSON)
  - Right: Falood CLI panel (command buttons + chat input, command history)
- Base resume editor: sections for header, summary, skills (categorized), experience, projects, education, certifications
- Each section: add/edit/delete blocks, drag to reorder
- Skills: category-based groups (OSP/telecom or software categories)
- Experience: job entries with bullet editor
- Bullets: action-oriented, show evidence reference, confidence score, risk level
- "Save as Draft" / "Submit for Review" / "Approve" status buttons

## Phase 3: JD Analyzer + Keyword Approval
### Backend
- `POST /api/jobs/analyze` — paste JD, create target_job + job_keywords via AI
- `GET /api/target-jobs?candidateId=` — list target jobs for a candidate
- `GET /api/target-jobs/[id]` — get target job with keywords
- `POST /api/keywords/approve` — bulk approve/reject keywords
- `GET /api/keyword-approvals?candidateId=` — list keyword approvals

### Frontend
- `/candidates/[id]/applications/new` — application wizard
- Step 1: Select base resume
- Step 2: Paste JD (raw text input or import from existing job)
- Step 3: JD Analysis results panel (job title, company, required skills, preferred skills, tools, red flags, fit score, recommendation)
- Step 4: Keyword Approval Board (table with: keyword, category, importance, evidence, recommendation, action: approve/reject/needs-review/cover-letter-only/already-present)
- Evidence linking: each keyword shows which evidence bank items support it

## Phase 4: Application Resume Studio
### Backend
- `POST /api/application-resume-versions` — create from base resume + target job
- `GET /api/application-resume-versions/[id]` — get version with content
- `PATCH /api/application-resume-versions/[id]` — update content
- `POST /api/falood/command` — extend with `application_resume_tailoring` mode
- `POST /api/resume-suggestions` — create suggestions (from AI)
- `PATCH /api/resume-suggestions/[id]` — accept/reject/customize
- `POST /api/resume-suggestions/[id]/apply` — apply accepted suggestion to resume content

### Frontend
- `/falood/studio/application/[applicationResumeId]` — 3-pane layout:
  - Left: Job + Keyword Panel (job details, approved keywords, rejected keywords, fit score, evidence warnings)
  - Center: Resume Editor / Preview (word-like editor with inline suggestions, accept/reject/customize buttons per suggestion, page boundary visualization)
  - Right: Falood CLI / Chat (suggestion commands, formatting commands)
- Inline suggestion cards: show original → suggested, reason, confidence, truth risk, ATS impact, buttons
- Customize flow: user types custom instruction, AI generates revised suggestion
- Track suggestion history (accepted, rejected, customized)

## Phase 5: PDF Preview + Export
### Backend
- `POST /api/export/pdf` — generate PDF from application_resume_versions.content
- Use @react-pdf/renderer or puppeteer
- Auto-fit engine: ordered rules (section spacing → bullet spacing → margins → font size → compress bullets → merge bullets → remove low-priority → ask user)
- One-page detection: calculate page count, show overflow warning

### Frontend
- PDF Preview Panel: PDF-like preview with page boundary
- One-page status indicator (green/yellow/red)
- Overflow warning with specific overflow location
- Formatting controls: font size, margins, section spacing, bullet spacing
- AI chat for formatting: "make margins smaller", "shorten this bullet", "remove last project"
- Export buttons: PDF, DOCX, ATS plain text, JSON
- After export: save to existing resumes table (kind='resume', label='OSP Application Resume — JobName')

## Phase 6: Application Packet + Ticket Closure
### Backend
- `POST /api/application-packets` — save final application packet
- `GET /api/application-packets/[id]` — get packet
- `POST /api/applications/[id]/proof` — upload proof screenshot
- `PATCH /api/applications/[id]/close` — close ticket with notes, submission URL
- `POST /api/applications/[id]/reopen` — reopen ticket
- `POST /api/falood/command` — extend with `application_packet` mode

### Frontend
- Application Packet creation after PDF export
- Cover letter generator (optional, from AI)
- Recruiter message generator
- Interview prep notes generator
- Submission tracking: submission URL, portal used, login/account notes
- Proof upload: drag-and-drop screenshot (PNG/JPG)
- Close ticket modal: confirm submission, add notes, upload proof
- Manager review: view closed tickets with proof, reopen if needed
- Application ticket board: assigned → in_progress → resume_ready → submitted → closed

## Navigation Changes
- Add "Falood AI" top-level nav item
- Inside candidate profile: Overview | Evidence Bank | Base Resumes | Applications | Notes
- Base Resumes tab: list of base resumes, "Create Base Resume" button
- Applications tab: list of applications with "New Application" button (starts wizard)
- New routes:
  - `/falood/studio/base/[baseResumeId]`
  - `/falood/studio/application/[applicationResumeId]`
  - `/review` (QC review queue)

## Implementation Order (stage-gated)
Stage 1: Phase 2 completion (base resume studio UI)
Stage 2: Phase 3 (JD analyzer + keyword approval) + Phase 4 (application resume studio) — APIs in parallel, then UIs
Stage 3: Phase 5 (PDF export) — somewhat independent
Stage 4: Phase 6 (application packet + tickets) — depends on Phase 4
Stage 5: Integration, testing, polish

## New Dependencies
- `@react-pdf/renderer` or `puppeteer` for PDF generation (Phase 5)
- `html-to-docx` or `docx` for DOCX export (Phase 5, optional)

## Verification
- Scenario 1: Create candidate → upload resume → parse → review → evidence bank
- Scenario 2: Create base resume → Falood CLI commands → edit → save → approve
- Scenario 3: Paste JD → analyze → approve keywords → generate suggestions → accept/reject → preview → one-page fit → export PDF
- Scenario 4: Submit application → upload proof → close ticket → manager review
