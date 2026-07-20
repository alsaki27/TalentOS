import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { getProviderForAutomation } from "@/lib/ai/routing";
import { runCopilotFiller } from "@/lib/ai/application-agents/copilotFiller";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";

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

      if (applicationId) {
        // 1. Fetch Application, Job, and Candidate
        appData = await queryOne<any>(
          `SELECT a.id as application_id, a.candidate_id, a.job_id,
                  j.title, j.company, j.description, j.raw_description,
                  c.name, c.email, c.phone, c.location_preference AS location,
                  c.work_authorization, c.linkedin_url, c.portfolio_url,
                  c.verified_skills, c.target_roles,
                  c.eeo_gender, c.eeo_race, c.eeo_veteran, c.eeo_disability
           FROM applications a
           JOIN jobs j ON a.job_id = j.id
           JOIN candidates c ON a.candidate_id = c.id
           WHERE a.id = $1`,
          [applicationId]
        );
      } else {
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

      // 2. Fetch Resume Text
      let resumeText = "";
      if (selectedResumeId) {
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

      // 3. Resolve AI Provider for Copilot Filler
      const routeResult = await getProviderForAutomation("copilot_fill_planner");
      if (!routeResult) {
        return extensionError("internal_error", "No AI provider configured for copilot_fill_planner.", 500);
      }

      // 4. Build Context and Run Agent
      const config = AGENT_CONFIG_DEFAULTS.copilot_fill_planner;
      const ctx: any = {
        applicationId: appData.application_id,
        candidateId: appData.candidate_id,
        formFields: formSnapshot,
        candidateProfile: {
          name: appData.name,
          email: appData.email,
          phone: appData.phone,
          location: appData.location,
          linkedin: appData.linkedin_url,
          portfolio: appData.portfolio_url,
          workAuthorization: appData.work_authorization,
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

      const plan = await runCopilotFiller(
        {
          temperature: config.temperature,
          max_output_tokens: config.maxOutputTokens,
          timeout_ms: config.timeoutMs,
        },
        routeResult.provider,
        ctx
      );

      return NextResponse.json({
        fillPlan: plan.instructions,
        applicationId: appData.application_id,
        candidateProfile: ctx.candidateProfile,
        resumeName: selectedResumeId ? "Selected Resume" : "No Resume Selected"
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
