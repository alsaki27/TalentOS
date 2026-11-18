# Candidate-wide application answers

Updated 19 November 2026. This is the main TalentOS application's contract with the separate browser worker. This release adds candidate-wide answers and the simplified answer editor. Migration 146 was applied separately to the main database after a scoped backup. Ordinary code deployments do not execute that migration.

## Staff workflow

Open **Candidate Profile → Overview → Application Readiness and Answers → Questions and answers**. Add a **Question**, select its **Value type**, and enter the **Answer**. Every answer applies across that candidate's applications. The form has no job Scope selector. **Save draft** keeps it unavailable to the worker. Authorized staff use **Save and approve** or **Approve** after verifying the information. Editing creates a draft revision and requires approval again. Remove revokes an answer; restoring creates a draft. Staff context belongs in **Profile notes**, which the worker never treats as approved form answers.

TalentOS generates `document` provenance with `staff-entry:<authenticated actor UUID>` for ordinary staff entries without an explicit source reference. The UI labels this **Staff entry in TalentOS**. Existing explicit source metadata is preserved. Profile-derived facts still require a supported profile field, matching current value, and explicit approval. A profile email or name alone never grants approval.

## Worker contract and missing questions

Approved evidence may now include optional `expiresAt` in strict UTC ISO format. Nonexpiring facts omit that property for compatibility. Identical usable approvals carry the earliest applicable expiry. The worker rejects expired or malformed expiry evidence and rechecks it after asynchronous Claude resolution. A superseded static answer remains unavailable. The hosted API supplies expiry metadata once this release is deployed. This addition needs no further database migration.

New and revised facts store `job_id = NULL`. Reads include that candidate's current revisions across legacy job scopes. Candidate IDs remain strict boundaries. Reuse requires known typed values, recorded approval, valid source evidence, and any expiry to remain current. A newer draft, expired record, or contradictory active typed answer blocks reuse. Identical usable approvals may collapse safely. No older revision is used as a fallback.

Narrow aliases cover Name/Full name, Email/E-mail/Email address, and Phone number/Mobile phone number. **LinkedIn profile name** stays separate from legal/full name. Work and home numbers remain distinct. Other question qualifiers, such as country or skill, are preserved. The API returns canonical worker labels and original fact ID/revision evidence.

Required unanswered questions from persisted worker results appear once per candidate under **Questions needing an approved answer**. Observed job names describe where the question arose. They do not restrict answer applicability. Approval of a valid candidate answer clears matching pending observations across jobs. Future unknown questions stop the worker and follow this same staff handoff.

**Prepare LinkedIn** remains the queue action that creates a request for a registered PC. The dedicated worker polls, downloads the pinned approved tailored PDF, verifies answers and browser identity, and stops at Review or the first blocker. This update does not change Application Queue stage rules, submit applications, or mark tickets applied.

## Migration and verification

[Migration 146](../sql/neon_fixes/146_candidate_wide_application_facts.sql) preserves historical job-scoped rows and appends candidate-wide revisions. An authenticated migration actor and matching source fingerprint guard conversion. A database trigger normalizes future inserts and explicit job-scope updates to candidate scope, including older clients.

A scoped backup of `public.candidate_application_facts` was restored and dry-run tested before the authorized live migration. All 288 original rows remained unchanged. Nine global revisions were appended, leaving 297 historical rows and 288 current facts across 25 candidates. Approval states remained eight approved and 280 draft. Current job-scoped facts are zero. Wrong actor/role and fingerprint checks, repeat execution, revision approval reset, legacy revision conversion, revoke, aliases, and candidate isolation passed. The backup stem is `D:/Shohan/Skarion/talent-os-ai/var/worker-db-backups/talentos-candidate-facts-before-146-20261118T125809496Z`; the `.restore-and-dryrun.json` records the isolated PGlite PostgreSQL restore and its native Windows initialization limitation.

All 37 focused library, API, and service tests passed across four suites, covering global reads/writes, approvals, aliases, conflicting values, expiry and pending-question reuse. A further 140 worker prepare, queue, artifact, route and workflow stage tests passed during release review. The separate fixture integration uses actual application SQL and facts API, the worker's facts parser, and the LinkedIn adapter in installed Chrome. It reached `final_review_ready`, uploaded one synthetic PDF, made zero external requests or submissions, and preserved application stages. This verifies the controlled fixture workflow. Evidence is `D:/Shohan/Skarion/talent-os-ai/var/candidate-wide-worker-verification.json`.

The latest live worker tests on 19 November used the original registered Chrome profile. A#37631 downloaded its approved PDF and stopped at `apply_open_failed` while opening Easy Apply. A#37632 uploaded and verified its approved PDF, advanced to screening and recorded two required questions without matching approved facts. Neither reached Review or submitted. Both retained their Ready for AE Application stages and unapplied state. These live tests used the previously deployed TalentOS API. Verification of the candidate-wide hosted editor and resolver follows deployment of this release.
