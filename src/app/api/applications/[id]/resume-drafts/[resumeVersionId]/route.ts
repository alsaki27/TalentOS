// src/app/api/applications/[id]/resume-drafts/[resumeVersionId]/route.ts
// PATCH -> update a draft (content, title, status, etc.)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { updateApplicationResumeVersion, findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { queryOne } from "@/server/db/neon";
import { recordExtensionActivity } from "@/server/services/extensionActivityService";

export const dynamic = "force-dynamic";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null) ?? "null";
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; resumeVersionId: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const resumeVersionId = params.resumeVersionId;
  const body = await req.json();

  // Verify the version exists
  const existing = await findResumeVersionById(resumeVersionId);
  if (!existing) {
    return NextResponse.json({ error: "Resume version not found" }, { status: 404 });
  }

  const application = await findApplicationById(applicationId);
  if (!application || existing.candidate_id !== application.candidate_id ||
      (existing.application_id && existing.application_id !== applicationId)) {
    return NextResponse.json({ error: "Resume version not found for this application" }, { status: 404 });
  }

  const allowedFields: Record<string, unknown> = {};
  const permittedKeys = ["content", "formatting", "status", "ats_score", "truth_score", "one_page_fit_score", "page_fit_metrics", "title", "version_label", "generated_text"];
  for (const key of permittedKeys) {
    if (key in body) allowedFields[key] = body[key];
  }

  if (Object.keys(allowedFields).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await updateApplicationResumeVersion(resumeVersionId, allowedFields);

  const resumeContentFields = ["content", "formatting", "generated_text", "title"] as const;
  const changedResumeFields = resumeContentFields.filter((field) => {
    if (!(field in allowedFields)) return false;
    const before = existing[field as keyof typeof existing];
    const after = allowedFields[field];
    return stableJson(before) !== stableJson(after);
  });
  if (changedResumeFields.length > 0) {
    // Legacy resume versions can lack application_id. Attribute edits only
    // when the version is explicitly linked or its target-job row confirms
    // the same candidate/job pair.
    let belongsToApplication = existing.application_id === applicationId;
    if (!belongsToApplication && existing.target_job_id && application.job_id) {
      const target = await queryOne<{ candidate_id: string; job_id: string }>(
        "SELECT candidate_id, job_id FROM target_jobs WHERE id = $1",
        [existing.target_job_id],
      );
      belongsToApplication = target?.candidate_id === application.candidate_id && target?.job_id === application.job_id;
    }
    if (belongsToApplication) {
      try {
        await recordExtensionActivity({
          actorUserId: context!.profile.user_id,
          eventType: "resume_edited",
          applicationId,
          jobId: application.job_id,
          candidateId: application.candidate_id,
          baseResumeId: existing.base_resume_id,
          resumeVersionId,
          metadata: { fields: changedResumeFields },
        });
      } catch (error) {
        console.error("[extension-activity] Could not record team resume edit", error);
      }
    }
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `Updated resume draft ${resumeVersionId}`,
    entityType: "application_resume_version",
    entityId: resumeVersionId,
    metadata: { application_id: applicationId, fields: Object.keys(allowedFields) },
  });

  return NextResponse.json({ resumeVersion: updated });
}
