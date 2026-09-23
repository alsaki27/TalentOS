// POST /api/extension/v1/copilot/cover-letter
// Scope: extension:queue:read
// Generates (or returns the cached) 1-page cover letter for an application,
// using the tailored resume + job description + candidate info already in
// the database. Returns plain text — the extension renders it to an actual
// PDF client-side via jsPDF (same library Falood Studio's resume export
// already uses; @react-pdf/renderer's server-side path is disabled on this
// Cloudflare Worker deployment — see resumeExportService.ts).

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { runCopilotCoverLetter } from "@/lib/ai/application-agents/copilotCoverLetter";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { findCoverLetter, upsertCoverLetter } from "@/server/repositories/copilotCoverLetterRepository";

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { applicationId, resumeVersionId, forceRegenerate } = body;

      if (!applicationId) {
        return extensionError("validation_error", "applicationId is required.", 400);
      }

      if (!forceRegenerate) {
        const existing = await findCoverLetter(applicationId);
        if (existing) {
          return NextResponse.json({ letterText: existing.letter_text, cached: true });
        }
      }

      const appData = await queryOne<any>(
        `SELECT a.id, a.candidate_id,
                j.title AS job_title, j.company, j.description_text AS description, j.raw_description,
                c.name AS candidate_name, c.location_preference AS candidate_location
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
         JOIN candidates c ON a.candidate_id = c.id
         WHERE a.id = $1`,
        [applicationId]
      );
      if (!appData) {
        return extensionError("not_found", "Application not found.", 404);
      }

      // Prefer the specific resume version passed in; otherwise the most
      // recently updated tailored resume for this application.
      const resume = resumeVersionId
        ? await queryOne<any>(`SELECT content, generated_text FROM application_resume_versions WHERE id = $1 AND application_id = $2`, [resumeVersionId, applicationId])
        : await queryOne<any>(
            `SELECT content, generated_text FROM application_resume_versions WHERE application_id = $1 ORDER BY updated_at DESC LIMIT 1`,
            [applicationId]
          );

      const tailoredResumeText = resume?.generated_text
        ? String(resume.generated_text)
        : resume?.content
          ? JSON.stringify(resume.content)
          : "(no tailored resume available — write generally from the job description and candidate name only)";

      const agentConfig = await findAgentConfigByAutomationId("copilot_cover_letter");
      const defaults = AGENT_CONFIG_DEFAULTS.copilot_cover_letter;
      const options = {
        system_prompt: agentConfig?.system_prompt ?? undefined,
        temperature: agentConfig?.temperature ?? defaults.temperature,
        max_output_tokens: agentConfig?.max_output_tokens ?? defaults.maxOutputTokens,
        timeout_ms: agentConfig?.timeout_ms ?? defaults.timeoutMs,
      };

      const { result } = await callWithUsageTracking("copilot_cover_letter", undefined, async (provider) =>
        runCopilotCoverLetter(options, provider, {
          candidateName: appData.candidate_name,
          candidateLocation: appData.candidate_location || "",
          jobTitle: appData.job_title,
          company: appData.company || "the company",
          jdText: appData.description || appData.raw_description || "",
          tailoredResumeText,
        })
      );

      await upsertCoverLetter(applicationId, appData.candidate_id, result.letterText);

      return NextResponse.json({ letterText: result.letterText, cached: false });
    } catch (err) {
      console.error("[Copilot Cover Letter Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
