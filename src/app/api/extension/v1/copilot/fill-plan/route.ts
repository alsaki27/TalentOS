import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { runCopilotFiller } from "@/lib/ai/application-agents/copilotFiller";
import { runCopilotCompliance } from "@/lib/ai/application-agents/copilotCompliance";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { getRecentCorrections } from "@/server/repositories/copilotLearningRepository";
import { getDomainProfile } from "@/server/repositories/copilotDomainProfileRepository";

// Finds an existing real application for this candidate that corresponds to
// the job the AE currently has open, so the extension can auto-use the ONE
// resume TalentOS already tailored for it instead of making the AE pick from
// a dropdown of every tailored resume the candidate has. Matching can't rely
// on URL equality — jobs.apply_url records where the posting was originally
// sourced (e.g. Indeed), while the AE fills out the application on the
// employer's own ATS domain (e.g. a Zoho Recruit portal) reached by clicking
// through, so URLs routinely differ for the same real-world job. Company +
// job title both appearing in the open tab's title is a much more reliable
// signal and is confirmed live against a real case (RMSI "GIS Technician").
// Require BOTH signals (score >= 3, only reachable with both since each is
// worth 2) — either alone is too weak (many companies reuse generic titles
// like "GIS Technician"; many job titles reuse generic company-name words).
async function findMatchingApplication(candidateId: string, pageTitle: string) {
  const title = (pageTitle || "").toLowerCase();
  if (!title) return null;

  const rows = await query<any>(
    `SELECT a.id AS application_id, j.title, j.company
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     WHERE a.candidate_id = $1 AND j.title IS NOT NULL
     ORDER BY a.created_at DESC
     LIMIT 200`,
    [candidateId]
  );

  let best: any = null;
  let bestScore = 0;
  for (const r of rows) {
    const jobTitle = String(r.title || "").toLowerCase().trim();
    const company = String(r.company || "").toLowerCase().trim();
    let score = 0;
    if (company.length > 2 && title.includes(company)) score += 2;
    if (jobTitle.length > 2 && title.includes(jobTitle)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 3 ? best : null;
}

async function agentOptionsFor(automationId: "copilot_fill_planner" | "copilot_compliance" | "copilot_form_analyst") {
  const [agentConfig, defaults] = await Promise.all([
    findAgentConfigByAutomationId(automationId),
    Promise.resolve(AGENT_CONFIG_DEFAULTS[automationId]),
  ]);
  return {
    system_prompt: agentConfig?.system_prompt ?? undefined,
    temperature: agentConfig?.temperature ?? defaults.temperature,
    max_output_tokens: agentConfig?.max_output_tokens ?? defaults.maxOutputTokens,
    timeout_ms: agentConfig?.timeout_ms ?? defaults.timeoutMs,
  };
}

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    // Use queueRead scope since the extension uses the master key which has queueRead
    // Alternatively, adaptersRead or resumeRead. We'll use queueRead as it's the core flow.
    const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { applicationId, candidateId, formSnapshot, selectedResumeId, pageContext } = body;

      // A key may be bound to one candidate. Never let a generic extension
      // key accidentally bypass that binding when the AE is running Copilot
      // from a page that is not linked to an application.
      if (auth.key.candidate_id && candidateId && String(auth.key.candidate_id) !== String(candidateId)) {
        return extensionError("forbidden", "This extension key is bound to a different candidate.", 403);
      }

      if (!Array.isArray(formSnapshot) || formSnapshot.length === 0 || formSnapshot.length > 300) {
        return extensionError("validation_error", "formSnapshot is required.", 400);
      }
      if (!applicationId && !candidateId) {
        return extensionError("validation_error", "Either applicationId or candidateId is required.", 400);
      }

      let appData: any = null;
      let matchedApplication: { applicationId: string; title: string; company: string } | null = null;

      if (applicationId) {
        // 1. Fetch Application, Job, and Candidate
        appData = await queryOne<any>(
          `SELECT a.id as application_id, a.candidate_id, a.job_id,
                  j.title, j.company, j.description_text AS description, j.raw_description,
                  c.name, c.email, c.phone, c.location_preference AS location,
                  c.work_authorization, c.linkedin_url, c.portfolio_url,
                  c.verified_skills, c.target_roles, c.salary_expectation,
                  c.eeo_gender, c.eeo_race, c.eeo_veteran, c.eeo_disability
           FROM applications a
           JOIN jobs j ON a.job_id = j.id
           JOIN candidates c ON a.candidate_id = c.id
           WHERE a.id = $1`,
          [applicationId]
        );
        if (appData && auth.key.candidate_id && String(appData.candidate_id) !== String(auth.key.candidate_id)) {
          return extensionError("forbidden", "This extension key is bound to a different candidate.", 403);
        }
        if (appData && candidateId && String(appData.candidate_id) !== String(candidateId)) {
          return extensionError("validation_error", "applicationId does not belong to candidateId.", 400);
        }
      } else {
        // TalentOS may already have a real application (and a resume tailored
        // specifically for it) for the job on the currently-open page — check
        // before falling back to an in-memory candidate context + manual resume pick.
        const match = await findMatchingApplication(candidateId, pageContext?.title || "");
        if (match) {
          appData = await queryOne<any>(
            `SELECT a.id as application_id, a.candidate_id, a.job_id,
                    j.title, j.company, j.description_text AS description, j.raw_description,
                    c.name, c.email, c.phone, c.location_preference AS location,
                    c.work_authorization, c.linkedin_url, c.portfolio_url,
                    c.verified_skills, c.target_roles, c.salary_expectation,
                    c.eeo_gender, c.eeo_race, c.eeo_veteran, c.eeo_disability
             FROM applications a
             JOIN jobs j ON a.job_id = j.id
             JOIN candidates c ON a.candidate_id = c.id
             WHERE a.id = $1`,
            [match.application_id]
          );
          if (appData) {
            matchedApplication = { applicationId: match.application_id, title: match.title, company: match.company };
          }
        }
      }

      if (!appData && !applicationId) {
        // Copilot is a form assistant. A page without a TalentOS application
        // is intentionally an in-memory capture context, not an application
        // queue write. The old implementation inserted a `copilot_adhoc`
        // application here and set applied_at=NOW(), which made merely
        // opening/analyzing a page look like an application had been sent.
        // Job capture belongs to /api/extension/v1/capture-job and queue
        // creation must happen through an explicit TalentOS workflow.
        const cand = await queryOne<any>(
          `SELECT * FROM candidates
            WHERE id = $1 AND status = 'active'
              AND COALESCE(pipeline_stage, 'not_started') <> 'paused'`,
          [candidateId]
        );
        if (cand) {
          appData = {
            application_id: null,
            candidate_id: candidateId,
            job_id: null,
            title: pageContext?.title || "Unknown Job",
            company: pageContext?.company || "Unknown Company",
            description: "",
            raw_description: "",
            name: cand.name,
            email: cand.email,
            phone: cand.phone,
            location: cand.location_preference,
            work_authorization: cand.work_authorization,
            linkedin_url: cand.linkedin_url,
            portfolio_url: cand.portfolio_url,
            verified_skills: cand.verified_skills,
            target_roles: cand.target_roles,
            salary_expectation: cand.salary_expectation,
            eeo_gender: cand.eeo_gender,
            eeo_race: cand.eeo_race,
            eeo_veteran: cand.eeo_veteran,
            eeo_disability: cand.eeo_disability,
          };
        }
      }

      if (!appData) {
        return extensionError("not_found", "Application not found.", 404);
      }

      // 2. Fetch Resume Text — if the page matched a real application,
      // TalentOS already tailored a specific resume for this exact job;
      // that overrides whatever the AE has picked in the manual dropdown.
      let resumeText = "";
      let resumeVersionId: string | null = null;
      if (matchedApplication) {
        const version = await queryOne<any>(
          `SELECT id, content, generated_text FROM application_resume_versions
           WHERE application_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [matchedApplication.applicationId]
        );
        if (version) {
          resumeVersionId = version.id;
          resumeText = version.generated_text
            ? String(version.generated_text)
            : version.content
              ? (typeof version.content === "string" ? version.content : JSON.stringify(version.content))
              : "";
        }
      }
      if (!resumeText && selectedResumeId) {
        // Try resumes (uploaded) or base_resumes
        let resume = await queryOne<any>(
          `SELECT parsed_json FROM resumes WHERE id = $1 AND candidate_id = $2`,
          [selectedResumeId, appData.candidate_id]
        );
        if (!resume) {
          // Check base resumes
          const baseResume = await queryOne<any>(
            `SELECT content FROM base_resumes WHERE id = $1 AND candidate_id = $2`,
            [selectedResumeId, appData.candidate_id]
          );
          if (baseResume && baseResume.content) {
             resumeText = typeof baseResume.content === "string" ? baseResume.content : JSON.stringify(baseResume.content);
          }
        } else if (resume && resume.parsed_json) {
          resumeText = typeof resume.parsed_json === "string" ? resume.parsed_json : JSON.stringify(resume.parsed_json);
        }
      }

      // 3. Pull past corrections for this domain (form-structure variance) and
      // this candidate (personal-data variance) so the prompt can self-correct.
      // These are used both as prompt few-shot examples AND as hard post-plan overrides.
      const domain: string = pageContext?.domain || "unknown";
      const corrections = await getRecentCorrections(domain, appData.candidate_id ?? null);
      const priorCorrections = corrections.map((c) => ({
        domain: c.domain,
        fieldLabel: c.field_label,
        aiValue: c.ai_value,
        finalValue: c.final_value,
      }));
      // Build label→{value,fieldType} and selector→{value,fieldType} maps for
      // deterministic override after the AI runs. Selector wins over label when both exist.
      // The most-recent correction for each label/selector wins (corrections ordered DESC).
      const correctionOverrideByLabel = new Map<string, { value: string; fieldType: string }>();
      const correctionOverrideBySelector = new Map<string, { value: string; fieldType: string; fieldLabel: string | null }>();
      for (const c of corrections) {
        const lbl = (c.field_label ?? "").trim().toLowerCase();
        const sel = (c.field_selector ?? "").trim();
        const ft = c.field_type ?? "text";
        if (sel && c.final_value != null && !correctionOverrideBySelector.has(sel)) {
          correctionOverrideBySelector.set(sel, { value: c.final_value, fieldType: ft, fieldLabel: c.field_label });
        }
        if (lbl && c.final_value != null && !correctionOverrideByLabel.has(lbl)) {
          correctionOverrideByLabel.set(lbl, { value: c.final_value, fieldType: ft });
        }
      }

      // 4. Copilot Form Analyst — cached per domain, only actually runs the
      // first time this domain is seen.
      let formAnalystNotes = "";
      const cachedProfile = await getDomainProfile(domain);
      if (cachedProfile) {
        formAnalystNotes = cachedProfile.structural_notes ?? "";
      }

      // 5. Copilot Compliance — resolves standing-default policy fields
      // first; Fill Planner never sees the fields Compliance already handled.
      let complianceInstructions: any[] = [];
      try {
        const complianceOptions = await agentOptionsFor("copilot_compliance");
        const { result: complianceResult } = await callWithUsageTracking("copilot_compliance", undefined, async (provider) =>
          runCopilotCompliance(complianceOptions, provider, {
            formFields: formSnapshot,
            candidatePolicy: {
              workAuthorization: appData.work_authorization,
              veteran: appData.eeo_veteran,
              disability: appData.eeo_disability,
              salaryExpectation: appData.salary_expectation,
            },
          })
        );
        complianceInstructions = complianceResult.instructions;
      } catch (err) {
        console.error("[fill-plan] Compliance agent failed, continuing without it:", err);
      }
      const resolvedSelectors = new Set(complianceInstructions.map((i) => i.selector));
      const remainingFields = formSnapshot.filter((f: any) => !resolvedSelectors.has(f.selector));

      // 6. Copilot Fill Planner — everything Compliance didn't already resolve.
      const fillPlannerOptions = await agentOptionsFor("copilot_fill_planner");
      const ctx: any = {
        priorCorrections,
        formAnalystNotes,
        applicationId: appData.application_id,
        candidateId: appData.candidate_id,
        formFields: remainingFields,
        candidateProfile: {
          name: appData.name,
          email: appData.email,
          phone: appData.phone,
          location: appData.location,
          linkedin: appData.linkedin_url,
          portfolio: appData.portfolio_url,
          workAuthorization: appData.work_authorization,
          salaryExpectation: appData.salary_expectation,
          verifiedSkills: appData.verified_skills || [],
          targetRoles: appData.target_roles || [],
          eeo_gender: appData.eeo_gender || "Decline to self-identify",
          eeo_race: appData.eeo_race || "Decline to self-identify",
          eeo_veteran: appData.eeo_veteran || "Not a Veteran",
          eeo_disability: appData.eeo_disability || "No",
        },
        baseResume: {
          content: resumeText
        },
        job: {
          title: appData.title,
          company: appData.company,
          description: appData.description,
          rawDescription: appData.raw_description
        },
        verifiedSkills: appData.verified_skills || []
      };

      const { result: plan } = await callWithUsageTracking("copilot_fill_planner", undefined, async (provider) =>
        runCopilotFiller(fillPlannerOptions, provider, ctx)
      );

      // Hard-apply learned corrections on top of the AI plan.
      // The AI sees corrections as few-shot hints, but may still guess wrong —
      // especially for short factual fields (name, country, phone). If we have a
      // human-confirmed correction for a label that matches a field in this plan,
      // override the AI's value deterministically so the mistake cannot repeat.
      if (correctionOverrideByLabel.size > 0) {
        // Build a selector→label map from the full form snapshot for matching.
        const selectorToLabel = new Map<string, string>(formSnapshot.map((f: any) => [f.selector, (f.label || f.ariaLabel || f.name || "").trim().toLowerCase()]));

        // Helper: apply a correction override to a single instruction object.
        function applyOverride(instr: any, correction: { value: string; fieldType: string }, fuzzy = false) {
          // Use the stored fieldType from the correction. Only keep the AI's fieldType
          // if the correction fieldType would break the field (e.g. don't overwrite a
          // working radio/select with "text" just because we have a text correction stored).
          // Checkbox values must be boolean, not a string.
          let finalFieldType = correction.fieldType;
          let finalValue: any = correction.value;

          if (finalFieldType === "checkbox" || instr.fieldType === "checkbox") {
            finalFieldType = "checkbox";
            finalValue = correction.value === "true" || correction.value === "1" || correction.value === "yes";
          } else if (finalFieldType === "skip" || finalFieldType === "ai_answer") {
            // Shouldn't happen (we wouldn't store a skip correction), but guard anyway.
            finalFieldType = "text";
          } else if (instr.fieldType === "radio" || instr.fieldType === "select" || instr.fieldType === "combobox") {
            // If the live field is radio/select/combobox but the stored correction says "text",
            // trust the live field type — the stored value (the chosen option label) is correct.
            finalFieldType = instr.fieldType;
          }

          instr.value = finalValue;
          instr.fieldType = finalFieldType;
          instr.confidence = "high";
          instr.reasoning = fuzzy
            ? "Learned from past human correction (fuzzy match)"
            : "Learned from past human correction";
        }

        // Helper: apply override to an instruction using selector-first, then label.
        function matchAndOverride(instr: any) {
          // 1. Exact selector match — most reliable.
          if (correctionOverrideBySelector.has(instr.selector)) {
            const stored = correctionOverrideBySelector.get(instr.selector)!;
            applyOverride(instr, stored);
            return;
          }
          // 2. Exact label match.
          const fieldLabel = selectorToLabel.get(instr.selector) ?? "";
          if (fieldLabel && correctionOverrideByLabel.has(fieldLabel)) {
            applyOverride(instr, correctionOverrideByLabel.get(fieldLabel)!);
            return;
          }
          // 3. Fuzzy label match — stored label is substring of live label or vice versa.
          if (fieldLabel) {
            for (const [storedLabel, stored] of correctionOverrideByLabel) {
              if (storedLabel.length > 3 && (fieldLabel.includes(storedLabel) || storedLabel.includes(fieldLabel))) {
                applyOverride(instr, stored, true);
                return;
              }
            }
          }
        }

        for (const instr of plan.instructions) {
          matchAndOverride(instr);
        }

        // Also handle fields the AI completely omitted: if a correction's selector
        // exists in formSnapshot but has no corresponding instruction, add one.
        const plannedSelectors = new Set([
          ...plan.instructions.map((i: any) => i.selector),
          ...complianceInstructions.map((i: any) => i.selector),
        ]);
        const snapshotBySelector = new Map<string, any>(formSnapshot.map((f: any) => [f.selector, f]));
        for (const [sel, correction] of correctionOverrideBySelector) {
          if (plannedSelectors.has(sel)) continue;              // already in plan
          const snapField = snapshotBySelector.get(sel);
          if (!snapField) continue;                              // field not on this page
          const liveFieldType = snapField.inputType || snapField.type || "text";
          const newInstr: any = {
            selector: sel,
            value: correction.value,
            fieldType: liveFieldType,
            confidence: "high",
            reasoning: "Learned from past human correction (field was previously omitted by AI)",
          };
          applyOverride(newInstr, correction);
          plan.instructions.push(newInstr);
        }

        // Also apply to compliance instructions
        for (const instr of complianceInstructions) {
          matchAndOverride(instr);
        }
      }

      // Cover letter / resume file detection — simple label matching is
      // enough here; these just tell the extension which buttons/actions to
      // surface, the actual generation and file handling happens client-side.
      const coverLetterFile = formSnapshot.find((f: any) =>
        f.inputType === "file" && /cover.?letter/i.test(`${f.label} ${f.name}`));
      const coverLetterText = formSnapshot.find((f: any) =>
        (f.type === "textarea" || f.inputType === "text") && /cover.?letter|letter of interest/i.test(`${f.label} ${f.name}`));
      const resumeFile = formSnapshot.find((f: any) =>
        f.inputType === "file" && /resume|\bcv\b/i.test(`${f.label} ${f.name}`));

      return NextResponse.json({
        fillPlan: [...complianceInstructions, ...plan.instructions],
        applicationId: appData.application_id,
        candidateId: appData.candidate_id,
        candidateProfile: ctx.candidateProfile,
        coverLetterFileSelector: coverLetterFile?.selector ?? null,
        coverLetterTextSelector: coverLetterText?.selector ?? null,
        resumeFileSelector: resumeFile?.selector ?? null,
        matchedApplication,
        resumeVersionId,
        resumeName: matchedApplication
          ? `Tailored resume for ${matchedApplication.title} @ ${matchedApplication.company}`
          : selectedResumeId ? "Selected Resume" : "No Resume Selected",
        captureOnly: !matchedApplication && !applicationId,
        // Raw corrections for the extension to apply as its absolute final override step.
        // The extension renders the plan preview AFTER applying these, so nothing
        // in the client-side pipeline (profile baseline, mandatory-field rules, etc.)
        // can re-skip a field the user has explicitly taught the system.
        learnedCorrections: corrections.map((c) => ({
          fieldLabel:    c.field_label,
          fieldSelector: c.field_selector,
          fieldType:     c.field_type,
          finalValue:    c.final_value,
        })),
      });
    } catch (err) {
      console.error("[Copilot Fill Plan Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
