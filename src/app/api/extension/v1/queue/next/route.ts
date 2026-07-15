// GET /api/extension/v1/queue/next?candidateId=<uuid>
// Scope: extension:queue:read
// Returns the next approved application ticket for the given candidate.

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const candidateId = req.nextUrl.searchParams.get("candidateId");
      if (!candidateId) {
        return extensionError("validation_error", "candidateId query parameter is required.", 400);
      }

      const application = await queryOne<any>(
        `SELECT a.id AS application_id, j.title AS job_title, j.company,
                j.apply_url, c.name, c.email, c.phone,
                COALESCE(NULLIF(TRIM(COALESCE(c.city,'') || ', ' || COALESCE(c.country,'')), ''), c.location_preference) AS location,
                c.work_authorization, c.linkedin_url, c.portfolio_url,
                c.resume_url
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
         JOIN candidates c ON a.candidate_id = c.id
         WHERE a.candidate_id = $1
           AND a.status = 'assigned'
           AND a.review_status = 'approved'
         ORDER BY a.priority DESC, a.created_at ASC
         LIMIT 1`,
        [candidateId]
      );

      if (!application) {
        return extensionError("queue_empty", "No approved application tickets for this candidate.", 404);
      }

      return NextResponse.json({
        ticket: {
          applicationId: application.application_id,
          jobTitle: application.job_title,
          company: application.company,
          applyUrl: application.apply_url,
          profile: {
            name: application.name,
            email: application.email,
            phone: application.phone,
            location: application.location,
            workAuthorization: application.work_authorization,
            linkedin: application.linkedin_url,
            portfolio: application.portfolio_url,
            resumeUrl: application.resume_url,
          },
        },
      });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}
