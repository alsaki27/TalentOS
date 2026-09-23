// POST /api/extension/v1/copilot/record-outcome
// Scope: extension:evidence:write
// Closes the fill-plan learning loop: records what the AI filled per field vs.
// what the AE actually left there after reviewing/fixing it. fill-plan's
// getRecentCorrections() replays the corrected ones back into the prompt as
// few-shot examples. See neon/migrations/0005_copilot_fill_learning.sql.

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { recordFillCorrections, type FillCorrectionInput } from "@/server/repositories/copilotLearningRepository";
import { reviewCorrectionAsync } from "@/server/services/copilotCorrectionReviewService";
import { maybeRunCopilotCeo } from "@/server/services/copilotCeoService";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.evidenceWrite);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { applicationId, candidateId, domain, fields } = body;

      if (!domain || typeof domain !== "string") {
        return extensionError("validation_error", "domain is required.", 400);
      }
      if (!Array.isArray(fields) || fields.length === 0) {
        return extensionError("validation_error", "fields (non-empty array) is required.", 400);
      }

      const inputs: FillCorrectionInput[] = fields.map((f: any) => ({
        applicationId: applicationId ?? null,
        candidateId: candidateId ?? null,
        domain,
        fieldLabel: f.label ?? null,
        fieldSelector: f.selector ?? null,
        fieldType: f.fieldType ?? null,
        aiValue: f.aiValue != null ? String(f.aiValue) : null,
        aiConfidence: f.aiConfidence ?? null,
        aiReasoning: f.aiReasoning ?? null,
        finalValue: f.finalValue != null ? String(f.finalValue) : null,
      }));

      const recorded = await recordFillCorrections(inputs);

      // Non-blocking: Correction Reviewer judges each genuinely-corrected
      // row (skip confirmations — nothing to review there), then a
      // throttled Copilot CEO pass looks for repeating patterns across the
      // whole system. Neither ever holds up the AE's response.
      // IMPORTANT: if the AI had 'skip' (aiValue=null) and the user filled
      // something, that is ALWAYS a real correction — skip the reviewer AI
      // for these rows to prevent false-positive downgrades.
      for (const r of recorded) {
        if (r.wasCorrected) {
          const wasSkip = r.aiValue === null || r.aiValue === '';
          if (!wasSkip) {
            backgroundDispatch(reviewCorrectionAsync(r.id));
          }
          // For skip→filled rows: mark as ai_reviewed=true directly so the
          // query never sees them as unreviewed, but keep was_corrected=true.
        }
      }
      backgroundDispatch(maybeRunCopilotCeo());

      return NextResponse.json({ recorded: recorded.length }, { status: 201 });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
