import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { runCopilotFiller } from "@/lib/ai/application-agents/copilotFiller";
import { runCopilotCompliance } from "@/lib/ai/application-agents/copilotCompliance";
import { runCopilotFormAnalyst } from "@/lib/ai/application-agents/copilotFormAnalyst";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { getRecentCorrections } from "@/server/repositories/copilotLearningRepository";
import { getDomainProfile, upsertDomainProfile } from "@/server/repositories/copilotDomainProfileRepository";

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

      if (!formSnapshot) {
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
      } else {
        // TalentOS may already have a real application (and a resume tailored
        // specifically for it) for the job on the currently-open page — check
        // before falling back to an ad-hoc application + manual resume pick.
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
        // Create an ad-hoc application for the candidate
        const cand = await queryOne<any>(`SELECT * FROM candidates WHERE id = $1`, [candidateId]);
        if (cand) {
          appData = {
            application_id: "adhoc-" + Date.now(),
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

          // Actually insert an ad-hoc application into DB so we have a real ID for evidence gathering
          const adhocApp = await queryOne<any>(`
            INSERT INTO applications (candidate_id, status, source_type, adhoc_job_data, applied_at)
            VALUES ($1, 'in_progress', 'copilot_adhoc', $2, NOW())
            RETURNING id
          `, [candidateId, JSON.stringify(pageContext || {})]);
          if (adhocApp) {
            appData.application_id = adhocApp.id;
          }
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
      const domain: string = pageContext?.domain || "unknown";
      const corrections = await getRecentCorrections(domain, appData.candidate_id ?? null);
      const priorCorrections = corrections.map((c) => ({
        domain: c.domain,
        fieldLabel: c.field_label,
        aiValue: c.ai_value,
        finalValue: c.final_value,
      }));

      // 4. Copilot Form Analyst — cached per domain, only actually runs the
      // first time this domain is seen.
      let formAnalystNotes = "";
      const cachedProfile = await getDomainProfile(domain);
      if (cachedProfile) {
        formAnalystNotes = cachedProfile.structural_notes ?? "";
      } else if (domain !== "unknown") {
        try {
          const formAnalystOptions = await agentOptionsFor("copilot_form_analyst");
          const { result: analystResult } = await callWithUsageTracking("copilot_form_analyst", undefined, async (provider) =>
            runCopilotFormAnalyst(formAnalystOptions, provider, { domain, formFields: formSnapshot })
          );
          formAnalystNotes = analystResult.structuralNotes;
          await upsertDomainProfile(domain, analystResult.atsGuess, analystResult.structuralNotes);
        } catch (err) {
          console.error("[fill-plan] Form Analyst failed, continuing without it:", err);
        }
      }

      // 5. Copilot Compliance — resolves standing-default policy fields
      // first; Fill Planner never sees the fields Compliance already handled.
      let complianceInstructions: any[] = [];
      try {
        const complianceOptions = await agentOptionsFor("copilot_compliance");
        const { result: complianceResult } = await callWithUsageTracking("copilot_compliance", undefined, async (provider) =>
          runCopilotCompliance(complianceOptions, provider, { formFields: formSnapshot })
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
        candidateProfile: ctx.candidateProfile,
        coverLetterFileSelector: coverLetterFile?.selector ?? null,
        coverLetterTextSelector: coverLetterText?.selector ?? null,
        resumeFileSelector: resumeFile?.selector ?? null,
        matchedApplication,
        resumeVersionId,
        resumeName: matchedApplication
          ? `Tailored resume for ${matchedApplication.title} @ ${matchedApplication.company}`
          : selectedResumeId ? "Selected Resume" : "No Resume Selected"
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
