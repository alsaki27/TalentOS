import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { getProviderForAutomation } from "@/lib/ai/routing";
import { runCopilotAnswerQuestion } from "@/lib/ai/application-agents/copilotAnswerQuestion";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { applicationId, question, fieldContext, maxLength, selectedResumeId } = body;

      if (!applicationId || !question) {
        return extensionError("validation_error", "applicationId and question are required.", 400);
      }

      // 1. Fetch Application, Job, and Candidate
      const appData = await queryOne<any>(
        `SELECT a.id, a.candidate_id, a.job_id,
                j.title, j.company,
                c.name, c.verified_skills
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
         JOIN candidates c ON a.candidate_id = c.id
         WHERE a.id = $1`,
        [applicationId]
      );

      if (!appData) {
        return extensionError("not_found", "Application not found.", 404);
      }

      // 2. Fetch Resume Text
      let resumeText = "";
      if (selectedResumeId) {
        const resume = await queryOne<any>(
          `SELECT parsed_json FROM candidate_resumes WHERE id = $1 AND candidate_id = $2`,
          [selectedResumeId, appData.candidate_id]
        );
        if (resume && resume.parsed_json) {
          resumeText = typeof resume.parsed_json === "string" ? resume.parsed_json : JSON.stringify(resume.parsed_json);
        }
      }

      // 3. Fetch Evidence (first 10 items to avoid token bloat)
      const evidence = await query<any>(
        `SELECT title, description FROM candidate_evidence 
         WHERE candidate_id = $1
         ORDER BY confidence_score DESC LIMIT 10`,
        [appData.candidate_id]
      );

      // 4. Resolve AI Provider
      const routeResult = await getProviderForAutomation("copilot_question_answerer");
      if (!routeResult) {
        return extensionError("internal_error", "No AI provider configured for copilot_question_answerer.", 500);
      }

      // 5. Build Context and Run Agent
      const config = AGENT_CONFIG_DEFAULTS.copilot_question_answerer;
      const ctx: any = {
        applicationId,
        candidateId: appData.candidate_id,
        question,
        fieldContext: fieldContext || "custom_question",
        maxLength: maxLength || 500,
        candidateProfile: {
          name: appData.name,
          verifiedSkills: appData.verified_skills || []
        },
        baseResume: {
          content: resumeText
        },
        evidence: evidence,
        job: {
          title: appData.title,
          company: appData.company
        },
        verifiedSkills: appData.verified_skills || []
      };

      const result = await runCopilotAnswerQuestion(
        {
          temperature: config.temperature,
          max_output_tokens: config.maxOutputTokens,
          timeout_ms: config.timeoutMs,
        },
        routeResult.provider,
        ctx
      );

      return NextResponse.json({
        answer: result.answer,
        confidence: result.confidence
      });
    } catch (err) {
      console.error("[Copilot Answer Question Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
