import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { computeContentIdentityKey, computeTitleLocationKey } from "@/lib/jobContentIdentity";
import { queryOne } from "@/server/db/neon";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { scrapeJobLocationFromPosting } from "@/lib/jobLocationScraper";

export const runtime = "nodejs";

interface LinkedJobRow {
  job_id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  source_url: string | null;
  apply_url: string | null;
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  try {
    const session = await queryOne<{ name: string | null }>(
      "SELECT name FROM falood_saved_applications WHERE id = $1",
      [params.id]
    );
    if (!session) return NextResponse.json({ success: false, error: "Resume Studio session not found." }, { status: 404 });

    const sourceMatch = /^application_resume_version:([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(session.name?.trim() ?? "");
    if (!sourceMatch) {
      return NextResponse.json({ success: false, error: "This resume is not linked to a TalentOS job, so no job location can be loaded." }, { status: 422 });
    }

    const job = await queryOne<LinkedJobRow>(
      `SELECT COALESCE(arv.job_id, a.job_id, tj.job_id) AS job_id,
              j.title, j.company, j.location, j.source_url, j.apply_url
         FROM application_resume_versions arv
         LEFT JOIN applications a ON a.id = arv.application_id
         LEFT JOIN target_jobs tj ON tj.id = arv.target_job_id
         LEFT JOIN jobs j ON j.id = COALESCE(arv.job_id, a.job_id, tj.job_id)
        WHERE arv.id = $1`,
      [sourceMatch[1]]
    );
    if (!job) return NextResponse.json({ success: false, error: "The job linked to this resume could not be found." }, { status: 404 });
    if (!job.job_id) {
      return NextResponse.json({ success: false, error: "This resume is not linked to a TalentOS job record." }, { status: 422 });
    }
    if (!job.title) return NextResponse.json({ success: false, error: "The linked TalentOS job has no title to verify against its posting." }, { status: 422 });

    const existingLocation = job.location?.trim();
    if (existingLocation) {
      return NextResponse.json({ success: true, data: { location: existingLocation, alreadySaved: true } });
    }

    const scraped = await scrapeJobLocationFromPosting({
      title: job.title,
      company: job.company,
      sourceUrl: job.source_url,
      applyUrl: job.apply_url,
    });
    if (!scraped.ok) {
      return NextResponse.json({ success: false, error: scraped.message, reason: scraped.reason }, { status: 422 });
    }

    const contentIdentityKey = computeContentIdentityKey({
      title: job.title,
      company: job.company,
      location: scraped.location,
      url: job.apply_url ?? job.source_url,
    });
    const titleLocationKey = computeTitleLocationKey({ title: job.title, location: scraped.location });
    const updated = await queryOne<{ id: string; title: string; location: string }>(
      `UPDATE jobs
          SET location = $1,
              content_identity_key = $2,
              title_location_key = $3
        WHERE id = $4 AND NULLIF(BTRIM(location), '') IS NULL
        RETURNING id, title, location`,
      [scraped.location, contentIdentityKey, titleLocationKey, job.job_id]
    );

    if (!updated) {
      const latest = await queryOne<{ location: string | null }>("SELECT location FROM jobs WHERE id = $1", [job.job_id]);
      if (latest?.location?.trim()) {
        return NextResponse.json({ success: true, data: { location: latest.location.trim(), alreadySaved: true } });
      }
      return NextResponse.json({ success: false, error: "The job changed while its location was being checked. Reload Resume Studio and retry." }, { status: 409 });
    }

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Added verified location to job ${updated.title}`,
      entityType: "job",
      entityId: updated.id,
      entityName: updated.title,
      metadata: { fields: ["location"], sourceHost: scraped.sourceHost, extractionMethod: scraped.method },
    }).catch((error) => console.error("[Resume Studio job location] Activity log write failed:", error));

    void triggerWebhooks("job.updated", {
      job_id: updated.id,
      updates: ["location"],
      updated_by: context.profile.user_id,
    }).catch((error) => console.error("[Resume Studio job location] Webhook dispatch failed:", error));

    return NextResponse.json({
      success: true,
      data: { location: updated.location, alreadySaved: false, sourceHost: scraped.sourceHost, extractionMethod: scraped.method },
    });
  } catch (error) {
    console.error("[Resume Studio job location] Resolve failed:", error);
    return NextResponse.json({ success: false, error: "TalentOS could not check the posting links right now. No job location was changed." }, { status: 500 });
  }
}
