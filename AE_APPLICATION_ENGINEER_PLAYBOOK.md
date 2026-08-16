# TalentOS AE Application Engineer Playbook

Version: 1.0  
Audience: Application Engineers, managers, and reviewers  
Purpose: turn a large daily job queue into a small number of defensible, high-ROI applications while preserving candidate truth, resume-to-job alignment, and complete TalentOS records.

## 1. The daily mission

Every AE is expected to make deliberate progress on the strongest opportunities, not simply process the largest number of tickets.

The daily priority is:

1. Find the strongest fresh jobs for the candidates you own.
2. Select the correct candidate and the correct base resume before reviewing the job.
3. Confirm the job is genuinely defensible from the resume and evidence bank.
4. Review the AI-tailored resume for truth, completeness, and fit.
5. Apply only when the application packet is ready and the job has not already been applied to for that candidate.
6. Leave a clear TalentOS record so another AE can understand what happened without asking you.

High volume is useful only when quality survives. A smaller set of strong, recent, well-documented applications is preferable to a large set of weak or duplicate applications.

## 2. Non-negotiable rules

- Never invent experience, dates, employers, certifications, tools, clearance, authorization, salary, location, or education.
- Never use one candidate's experience to justify another candidate's application.
- Treat each base resume as a separate search contract. A candidate with CAD, GIS, and OSP resumes has three distinct matching lanes.
- Use `application_stage` as the lifecycle truth. Do not infer the current state from an old status label, a color, or an email alone.
- Do not mark an application `applied` until the AE has actually submitted it or has verified the submission evidence.
- Do not apply to the same candidate/job twice. Search by candidate, company, normalized title, job URL, and job ID before creating a ticket.
- Prefer jobs posted within seven days. A job older than seven days needs a clear reason to remain a priority; a stale posting is not automatically a good opportunity.
- Do not treat “you look like a great fit,” job alerts, marketing mail, or generic recruiter campaigns as an application or interview event.
- Keep personal email private. Ignore shopping, food delivery, banking, medical, family, travel, social, and unrelated promotional messages.
- Do not download candidate resumes from the candidate portal. Candidates may view allowed materials; internal users manage records and exports.
- Never use raw SQL, secrets, API keys, or direct database credentials in Codex or an external prompt. Use TalentOS pages, the MCP Command Center, and authenticated application APIs.
- A destructive action requires a second look and explicit confirmation. Deletion is manager/admin work, not routine AE work.

## 3. What the TalentOS workflow means

The application queue is a work queue, not merely a historical spreadsheet.

| Stage | Meaning | AE action |
|---|---|---|
| `in_ai_pipeline` | AI is still generating or validating the application packet | Wait, inspect errors, or retry only when appropriate |
| `ready_for_review` | AI packet exists and needs human quality review | Read the job, score, findings, and tailored resume |
| `ready_for_application` | Human review passed; AE may apply | Confirm final packet and submit on the employer site |
| `applied` | Submission was actually completed or verified | Record applied time, evidence, and next follow-up |
| `screening` | Employer screening activity is known | Add interview/screening details and due dates |
| `interview` | Interview is scheduled or confirmed | Capture date, time zone, interviewer, and preparation notes |
| `offer` | Offer activity is confirmed | Preserve exact terms and escalate to manager |
| `rejected` | Employer rejection is confirmed | Record source/date; do not infer rejection from silence |
| `withdrawn` | Candidate or team intentionally withdrew | Record the reason |
| `on_hold` | Deliberately paused with a reason | Add the next review date |
| `closed` | No further action is expected | Preserve the final reason |

Stage changes should show who changed them, when, why, and whether the source was a human, AI pipeline, email workflow, extension, or Codex/MCP action.

## 4. The daily AE routine

### Start of shift: 15-minute triage

1. Open `/mcp` and the Application Queue.
2. Run: “Show me the freshest high-confidence applications assigned to me, grouped by candidate and base resume. Exclude duplicates, stale jobs, rejected/withdrawn jobs, and roles with unresolved truth risks.”
3. Filter the queue by your owner, `ready_for_review`, `ready_for_application`, and the time windows for the last 12 hours, 24 hours, three days, and seven days.
4. Select at least one high-ROI application per active candidate you are responsible for when a defensible match exists.
5. Escalate missing resumes, ambiguous candidate identity, duplicate jobs, broken tailoring, and questionable AI claims before applying.

### Review order

Review in this order:

1. Interview or recruiter response requiring a same-day action.
2. Fresh job with a strong score and a closing/rolling deadline.
3. Fresh job whose employer or role is unusually valuable for the candidate.
4. Fresh job with a complete tailored resume and clear evidence.
5. Older or lower-confidence jobs only after the high-ROI queue is cleared.

### End of shift

For every application touched:

- The stage is correct.
- The owner is correct.
- The selected base resume is visible.
- The tailored resume was reviewed or the reason it was not is recorded.
- The applied date is real, not the ticket creation date.
- Follow-up date and next action are present when applicable.
- Any rejection, interview, offer, or recruiter communication is attached to the correct candidate/application.

## 5. How to read a candidate in TalentOS

Open the candidate record and inspect these surfaces in order:

1. **Profile Overview** — location, email, work authorization, target roles, constraints, and candidate-entered facts.
2. **Source of Truth** — verified employment, education, dates, credentials, tools, and evidence. This overrides guesses from an old resume.
3. **Evidence Bank** — concrete projects, metrics, responsibilities, and examples that may support tailoring.
4. **Base Resumes** — each is a distinct target lane. Read the full content, not only the filename.
5. **Job Search Profiles** — approved keywords and additional rules. Dismissed keywords are intentional exclusions; do not restore them casually.
6. **Tailored Resumes** — confirm the tailored version links to the right application and base resume.
7. **Applications** — inspect the stage, owner, applied date, source, job ID, notes, interview activity, and export/archive information.
8. **Notes & Caveats** — read before making a judgment. A manager rule can be more important than an attractive keyword match.

If the candidate has no base resume for a job family, do not improvise a new lane in the queue. Flag the candidate for base-resume creation or manager review.

## 6. How to choose the correct base resume

Use the resume whose professional identity best matches the job's core work, not the one with the most keywords.

- CAD/Drafting: drafting production, AutoCAD/Civil 3D, design packages, redlines, BOQ/BOM, technical documentation, standards, and drawing QA.
- OSP/Telecom: outside plant, fiber, route/design packages, HLD/LLD, pole/duct/conduit, permitting, utility coordination, and field-to-design workflows.
- GIS: ArcGIS/QGIS, spatial analysis, data collection, mapping, geodatabases, field data, parcel/utility layers, and cartographic deliverables.
- Mechanical Engineering: mechanical design, controls, project engineering, manufacturing, GD&T, BOMs, tolerancing, quality, and product lifecycle support.
- Data center/NOC/network: NOC operations, ISP/service provider, BGP/MPLS/OSPF, data center support, incident/SLA work, cabling, monitoring, and network troubleshooting.
- Solar/PV: PV design, electrical layouts, BESS, permitting, site analysis, production modeling, and solar project delivery.
- Finance/accounting: financial analysis, forecasting, reconciliations, close, audit support, reporting, and accounting controls.

If two resumes could support the same job, choose the one with the strongest direct evidence and most honest title alignment. Do not create duplicate applications for the same candidate/job merely because two base resumes match.

## 7. ROI scoring for daily priorities

Use this practical score before applying. It is a prioritization aid, not a substitute for judgment.

| Factor | Points |
|---|---:|
| Posted within 3 days | +20 |
| Posted within 7 days | +12 |
| Direct role-family match | +25 |
| Strong evidence for most must-have requirements | +20 |
| Correct location/remote/authorization fit | +10 |
| Tailored resume complete and truthful | +10 |
| Employer/recruiter signal or realistic conversion path | +10 |
| Clear application route and no duplicate | +5 |
| Requires an unsupported certification/clearance | -30 |
| Experience threshold clearly exceeds candidate rule | -30 |
| Role is materially outside the base resume | -25 |
| Generic alert/marketing/great-fit language without a real role | -25 |
| Duplicate application or stale posting | -40 |

Suggested handling:

- 80–100: top priority; review/apply today.
- 65–79: good candidate; apply if no truth or logistics blocker.
- 50–64: manager/AE judgment; do not mass-apply.
- Below 50: usually ignore unless there is a specific employer/recruiter reason.

Never use a high numeric score to override a hard exclusion.

## 8. Candidate-specific master prompts

Paste one block into the MCP Command Center, then replace the bracketed values. The model must use live TalentOS records and return application IDs, job IDs, base-resume IDs, posting dates, score rationale, and exclusions.

### Avirup Bhattacharjee

Active lanes: `Resume_Avirup(CAD)`, `Resume_Avirup(GIS)`, `Resume_Avirup(OSP)`.

```text
You are the Avirup high-ROI application reviewer for TalentOS.
Read Avirup Bhattacharjee's Source of Truth, Evidence Bank, the selected base resume, approved search keywords, additional rules, and the live job record. Evaluate only jobs posted in the last 7 days unless a recruiter/employer signal makes an older job unusually valuable.

CAD lane: prioritize CAD Drafter, CAD Designer, Civil CAD, AutoCAD, Civil 3D, technical documentation, design packages, BOQ/BOM, redlines, and drawing QA.
GIS lane: prioritize GIS Analyst/Technician, GIS data, ArcGIS/QGIS, mapping, spatial data, field data collection, utility/land/municipal GIS, and geospatial analysis.
OSP lane: prioritize OSP Designer/Engineer, fiber/telecom, HLD/LLD, route design, pole/duct/conduit, permitting, utility coordination, and outside-plant documentation.

Do not merge the three lanes blindly. Select one winning base resume for each candidate/job. Reject roles requiring unsupported seniority, licenses, security clearance, or experience. Respect the candidate's reviewed experience cap and location rules. Never invent engineering authority, surveying licensure, or years of experience.

Return the top distinct jobs only, ranked by conversion ROI. For each: application_id if present, job_id, company, title, posted_at, winning base_resume_id/name, score, direct evidence, missing requirements, hard exclusions, duplicate check, and recommended action. Report jobs that should be ignored separately.
``` 

### Bhaskar Roy

Active lanes: CAD Drafting, Mechanical Engineering, and OSP.

```text
You are the Bhaskar Roy high-ROI application reviewer for TalentOS.
Use only Bhaskar's verified profile, evidence, selected base resume, and reviewed job-search contract. Evaluate fresh jobs first and return only roles where a hiring team could plausibly see direct evidence.

CAD lane: CAD Technician, CAD Drafter, Civil/utility drafting, AutoCAD, Civil 3D, drawing production, redlines, technical packages, BOQ/BOM, and documentation QA.
Mechanical lane: Mechanical Designer/Engineer, Controls, Project Engineer, product/design support, manufacturing, GD&T, tolerancing, BOMs, quality, and engineering documentation. Do not overstate mechanical engineering authority or claim unsupported software/certifications.
OSP lane: OSP design/drafting, telecom/fiber, HLD/LLD, route maps, utility infrastructure, field documentation, and permitting support.

Use the strongest direct lane and avoid duplicate candidate/job applications. Reject roles whose experience threshold, degree, license, clearance, or location requirement is not defensible. Do not let a broad keyword list turn a weak match into a strong one.

Return the top ROI jobs with IDs, posting age, chosen base resume, evidence mapping, risks, and an explicit apply/hold/ignore recommendation. Flag any base resume that is stale, empty, duplicated, or not approved.
```

### MD Mahbubul Alam

Active lanes: Data Center Technician, ISP/Network Operations Engineer, and NOC.

```text
You are the Mahbubul Alam network/data-center high-ROI application reviewer for TalentOS.
Separate the Data Center Technician, ISP-NOE, and NOC lanes. Prioritize recent roles in data centers, service providers, NOC operations, network infrastructure, incident response, monitoring, cabling, and troubleshooting.

Use direct evidence for Cisco/Juniper, BGP, MPLS, OSPF, IS-IS, VXLAN/EVPN, ACI, NOC operations, incident/SLA work, data-center hardware, and monitoring tools only when the selected resume or evidence bank supports it. A certification may strengthen a match but does not prove every technology.

Reject or flag roles requiring unsupported security clearance, advanced architecture ownership, excessive years, or a specialization outside the selected lane. Ignore job-alert/generic great-fit emails. Return top fresh jobs, one winning base resume per candidate/job, exact evidence, gaps, and next action.
```

### Maahir Azmain Chowdhury

Active lanes: OSP, CAD Drafter, and GIS.

```text
You are the Maahir Azmain Chowdhury high-ROI reviewer. Evaluate OSP, CAD Drafter, and GIS opportunities as separate lanes. Prefer recent jobs with direct evidence in outside-plant design, telecom/fiber documentation, AutoCAD/CAD production, GIS mapping/data, field collection, and utility/municipal infrastructure.

Use the exact base resume that supports the job. Do not use an OSP resume to justify a pure GIS analyst role or a GIS resume to justify a senior engineering role without evidence. Check location, work authorization, experience, travel, and licensing requirements. Distinguish technician/designer roles from licensed engineer roles.

Return the strongest distinct opportunities only, with posting date, job ID, base resume, score, evidence, risks, duplicate status, and whether the AE should apply, hold, or ignore.
```

### Mir Najiur Rahman

Active lane: CAD Drafting.

```text
You are the Najiur CAD high-ROI reviewer. Prioritize CAD drafting, Civil 3D/AutoCAD, technical drawings, design support, survey/CADD, utility/land development, redlines, and documentation roles that match the actual base resume.

Favor junior-to-mid roles where the resume directly demonstrates the work. Do not convert a drafting resume into a licensed civil engineer profile. Verify dates, employers, education, software, location, and experience requirements. Exclude jobs that require unsupported licenses, clearance, or seniority.

Return only distinct recent jobs with exact job/application IDs, chosen resume, evidence mapping, risks, and an apply/hold/ignore decision.
```

### TAHSIN MUHTADY MAHI

Active lanes: Solar PV and FPGA/VLSI.

```text
You are the Mahi high-ROI reviewer. Keep Solar PV and FPGA/VLSI completely separate. Do not use semiconductor keywords to justify solar roles or solar design experience to justify ASIC/FPGA roles.

Solar lane: prioritize PV design, solar electrical design, BESS, permitting, site/layout work, production modeling, and solar project delivery supported by the selected resume.
FPGA/VLSI lane: prioritize FPGA implementation, RTL, ASIC/SoC, verification, digital design, PCIe, and related roles only where the base resume has direct evidence.

Reject roles whose degree, years, clearance, tools, or seniority are materially beyond the evidence. Prefer fresh postings. Return the chosen lane, job ID, base resume, evidence, gaps, fit score, duplicate check, and recommended action.
```

### Other active candidates with base resumes

The live inventory also contains base-resume records for MD Arif, Rayda Noor, Saddam H., Shaikh Raisa Afreen, Test Istiaque, and akash. Before matching them, confirm the candidate is genuinely active and not a test, dropped, or deprecated account. The prompt below is the safe onboarding template for any additional domain.

```text
You are the candidate-specific high-ROI reviewer for [CANDIDATE NAME].
Read the live candidate profile, Source of Truth, Evidence Bank, every approved base resume, keyword contract, additional rules, and the job record. Do not infer a domain from the filename alone.

For each base resume, define its professional lane in one sentence. Match only jobs whose core responsibilities are directly evidenced by that lane. Prefer postings from the last 7 days, use the candidate's location/authorization/experience rules, and reject unsupported licenses, clearance, degree, tools, or seniority.

Return distinct jobs only. For each result include: candidate_id, job_id, application_id if already logged, company, title, posted_at, selected base_resume_id/name, fit score, evidence mapping, hard gaps, duplicate status, and apply/hold/ignore recommendation. If no base resume is approved or the candidate is not active, stop and report the blocker.
```

## 9. Master prompt for a daily AE batch

```text
You are the TalentOS daily AE application prioritization agent.

Objective: help the AE select the highest-ROI applications for active candidates. Use live TalentOS tools and never fabricate data.

Scope:
- candidates with status active only;
- approved/current base resumes only;
- jobs posted within 7 days preferred, with 3 days highest priority;
- exclude candidate/job duplicates, rejected/withdrawn/closed records, generic alerts, and unsupported requirements;
- preserve one winning base resume per candidate/job;
- do not submit employer applications; produce recommendations unless the AE explicitly confirms a queue write.

For each candidate, return up to [N] strong opportunities, but fewer is correct when the evidence is weak. Rank by direct fit, freshness, logistics, completeness, employer signal, and conversion likelihood. Every recommendation must include IDs and an evidence-based rationale.

Before any queue write, verify candidate status, job freshness, duplicate state, selected base resume, application_stage, owner, and tailored-resume workflow readiness. A successful queue record must retain candidate_id, job_id, base_resume_id, selected base resume, application_stage=in_ai_pipeline, and the AI workflow linkage. Never mark applied merely because a ticket was created.

At the end, produce:
1. top applications by candidate;
2. jobs excluded and why;
3. duplicates prevented;
4. missing base resumes or missing evidence;
5. AE workload recommendation;
6. exact actions requiring human confirmation.
```

## 10. Master prompt for reviewing a queued application

```text
Review application [APPLICATION_ID] as an AE.

Load the candidate, job, application_stage, selected base_resume_id, tailored resume, AI findings, source, posting date, and prior application history. Compare the job's must-have requirements to verified evidence only.

Answer in this order:
1. Is this a genuine, recent job?
2. Is the candidate/job pair a duplicate or already applied?
3. Is the selected base resume the correct lane?
4. Which requirements are directly evidenced?
5. Which claims in the tailored resume are unsupported, missing, or overstated?
6. What must the AE edit or verify?
7. Should the stage remain ready_for_review, move to ready_for_application, be placed on hold, or be rejected?

Do not recommend ready_for_application when a hard requirement is unsupported, the resume is incomplete, or the job is stale without a reason.
```

## 11. Master prompt for applied-job follow-up

```text
For application [APPLICATION_ID], read the current application_stage, applied_at, employer emails, interview/screening notes, follow-up date, and prior actions.

Ignore personal, promotional, job-alert, and generic “great fit” messages. Treat a real recruiter/hiring-manager message, assessment, interview invitation, rejection, offer, or explicit application confirmation as actionable. Summarize the evidence, update only the correct application, preserve the email ID and timestamp, and propose the next action.

Never move a stage solely because an email sounds positive. Never mark applied from a job alert. If the email cannot be confidently linked to an application, create an AE review task instead of guessing.
```

## 12. Common edge cases and the correct response

### Duplicate job

Search candidate + normalized company + normalized title + job URL/job ID. If a prior application exists, do not create another. Link the new evidence to the existing record and flag the duplicate.

### Same job matches multiple base resumes

Create one candidate/job application. Pick the strongest base resume and record why. Keep the other matching lane in the rationale, not as a duplicate application.

### Missing base resume

Do not tailor from a random resume. Flag “missing base resume,” route to a manager, and pause the application.

### AI pipeline failure

Read the pipeline error. Retry only if the input exists and the failure is transient. Do not repeatedly retry malformed output, missing source data, or a broken provider. Preserve the original error and tell the next AE what was attempted.

### Tailored resume loses experience, employer, dates, or education

Reject the output for revision. Compare against the base resume and Source of Truth. Never accept a polished PDF that silently removes material facts or changes dates/company names.

### Exported PDF has no SharePoint link

The PDF is not archived until `application_resume_exports` contains a successful record with `storage_provider=sharepoint`, `storage_url`, and `storage_item_id`. Re-export through Falood Studio; do not assume a browser download was stored.

### Candidate has personal email mixed with recruiting email

Ignore personal transactions and unrelated mail. Keep only messages that are clearly recruiting, hiring, application, screening, interview, assessment, rejection, offer, or employer communication.

### Application stage appears inconsistent

Use `application_stage` as truth. Inspect stage history and last actor. Do not repair by editing only the old `status` field.

### Candidate/job is stale

Prefer a job posted within seven days. If older, require a recruiter signal, explicit rolling acceptance, or another documented reason.

### Candidate is inactive, dropped, test, or ambiguous

Stop. Do not create or apply to anything until the candidate status is corrected by an authorized manager.

### Employer application asks a question not supported by the record

Leave it for AE/manager review. Never guess work authorization, sponsorship, salary, relocation, clearance, graduation date, or legal information.

## 13. Queue-write checklist

Before creating a TalentOS application ticket:

- [ ] Candidate is active and correct.
- [ ] Job is real, recent, and not a duplicate.
- [ ] Winning base resume is selected and approved.
- [ ] Application does not already exist for candidate/job.
- [ ] Job fit is strong enough to justify AE time.
- [ ] Hard exclusions are cleared.
- [ ] Owner is set to the intended AE/manager.
- [ ] Stage starts in `in_ai_pipeline` when AI tailoring is required.
- [ ] Base resume ID and target job context are retained.
- [ ] Queue write was explicitly confirmed.

Before marking `applied`:

- [ ] AE actually completed the employer submission.
- [ ] Correct candidate and job were used.
- [ ] Correct tailored resume was attached.
- [ ] Submission evidence or confirmation is captured.
- [ ] Falood Studio PDF export is archived to SharePoint when required.
- [ ] Applied timestamp is the real submission time.
- [ ] Next follow-up is set.

## 14. How managers should measure AE ROI

Review daily:

- strong applications per AE;
- fresh applications versus stale applications;
- duplicate applications prevented;
- ready-for-review backlog age;
- ready-for-application backlog age;
- completed applications with correct tailored-resume linkage;
- applications with SharePoint archive records;
- interviews, recruiter replies, assessments, offers, and rejections;
- corrections caused by unsupported AI claims;
- candidate coverage: whether every active candidate received attention without forcing weak applications.

Do not reward an AE solely for moving a high number of tickets to `applied`. The stronger KPI is defensible applications that produce interviews and preserve a complete audit trail.

## 15. Escalation rules

Escalate to a manager when:

- the job requires a license, clearance, degree, or experience threshold not clearly supported;
- the candidate has conflicting dates or employer names;
- two base resumes produce materially different recommendations;
- the job is a duplicate but the employer appears to have reposted a materially different role;
- a candidate asks for a change to a factual record;
- an email could change stage but cannot be confidently linked;
- an export/download exists without a SharePoint archive;
- a destructive deletion is requested;
- a candidate is marked active but appears dropped, test, or inactive.

## 16. Onboarding a new candidate domain

1. Confirm the candidate is active.
2. Upload and approve a base resume for one coherent role family.
3. Use `BaseResume_TO_JobSearchKeyword` to generate a focused search contract.
4. Human-review keywords and rules; dismiss overbroad or unsupported terms.
5. Run report-only matching against recent jobs.
6. Review top matches and false positives.
7. Create queue tickets only after approval.
8. Verify the AI pipeline retains candidate, job, base resume, and application IDs.
9. Train the assigned AE with the candidate-specific prompt.
10. Review interview/rejection outcomes and refine the resume/search contract.

## 17. Suggested Codex commands for AEs

```text
Show my top 10 fresh ready-for-review applications, grouped by candidate and winning base resume. Exclude duplicates and any job older than 7 days.

For candidate [name], compare the top three jobs against every approved base resume and choose one winning resume per job.

Review application [id] for unsupported claims, missing experience, wrong employer names, wrong dates, or lost education. Return exact corrections.

Give me today's Bangladesh-workday summary for my AE activity: reviewed, moved to ready_for_application, marked applied, interviews, offers, and corrections.

Find applications with tailored resumes but no SharePoint export. Return application IDs and tell me which ones require a Falood Studio re-export.
```

## 18. Source-of-truth implementation notes

The following are the operational anchors for developers and advanced AEs:

- Candidate and job matching: `src/lib/ai/tools.ts`, candidate/job repositories, and the MCP Command Center.
- Application lifecycle: `application_stage`; legacy status fields are compatibility data, not the preferred decision field.
- Stage history: `application_stage_history`.
- Audit events: `audit_logs`.
- AI workflow: `application_ai_workflows` and the selected `base_resume_id`/tailored version linkage.
- Resume exports: `application_resume_exports`; a successful SharePoint archive has `status=created`, `storage_provider=sharepoint`, `storage_url`, and `storage_item_id`.
- Falood Studio is the authoritative browser export path for the exact PDF/DOCX shown to the AE.
- Use report-only matching before a controlled queue write.
- Fewer than the target count is acceptable when evidence is weak. Quality and defensibility outrank filling a quota.

This document should be updated when the application-stage vocabulary, resume archive behavior, candidate base-resume inventory, or MCP tool contract changes.
