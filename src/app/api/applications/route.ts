// src/app/api/applications/route.ts
// POST -> log that a candidate applied to a job (with which resume + status)
// PATCH is handled in [id]/route.ts for status updates

import { NextRequest, NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import {
  listApplications,
  findExistingCandidateIdsForJob,
  createApplications,
} from "@/server/repositories/applicationsRepository";

export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  try {
    const result = await listApplications({ page, pageSize, search });
    return NextResponse.json({ items: result.items, total: result.total, page, pageSize });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const candidateIds: string[] = Array.isArray(body.candidate_ids)
    ? body.candidate_ids.filter(Boolean)
    : body.candidate_id
      ? [body.candidate_id]
      : [];

  const hasJobId = !!body.job_id;
  const hasAdhocJobData = !!body.adhoc_job_data || !!body.adhoc_job_raw_text;

  if (candidateIds.length === 0 || (!hasJobId && !hasAdhocJobData)) {
    return NextResponse.json({ error: "candidate_id/candidate_ids and either job_id or adhoc_job_data/adhoc_job_raw_text are required" }, { status: 400 });
  }

  const status = body.status ?? "applied";
  const automated = applicationAutomation({
    status,
    explicitFollowUp: "follow_up_at" in body,
    explicitNextAction: "next_action" in body,
    explicitAssignmentDue: "assignment_due_at" in body,
  });
  const followUpAt = "follow_up_at" in body ? body.follow_up_at : automated.follow_up_at ?? null;
  const nextAction = "next_action" in body ? body.next_action : automated.next_action ?? null;
  const assignmentDueAt = "assignment_due_at" in body ? body.assignment_due_at : automated.assignment_due_at ?? null;
  const followUpSource = "follow_up_at" in body
    ? (body.follow_up_at ? "manual" : null)
    : automated.follow_up_source ?? null;
  const isAssignmentTicket = ["assigned", "stacked"].includes(status) || Boolean(body.assigned_to_user_id);
  if (isAssignmentTicket && !hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins, managers, and recruiters can assign application tickets." }, { status: 403 });
  }

  let newCandidateIds = candidateIds;
  if (hasJobId) {
    const existingCandidateIds = await findExistingCandidateIdsForJob(body.job_id, candidateIds);
    newCandidateIds = candidateIds.filter((id) => !existingCandidateIds.has(id));

    if (newCandidateIds.length === 0) {
      return NextResponse.json({ error: "All selected candidates already have applications for this job." }, { status: 409 });
    }
  }

  try {
    const data = await createApplications(newCandidateIds.map((candidateId) => ({
      candidate_id: candidateId,
      job_id: body.job_id ?? null,
      status,
      resume_url: body.resume_url ?? null,
      resume_filename: body.resume_filename ?? null,
      resume_id: body.resume_id ?? null,
      follow_up_at: followUpAt,
      next_action: nextAction,
      follow_up_source: followUpSource,
      follow_up_created_at: followUpAt ? (automated.follow_up_created_at ?? new Date().toISOString()) : null,
      notes: body.notes ?? null,
      assigned_by: body.assigned_by ?? null,
      assigned_to: body.assigned_to ?? null,
      assigned_by_user_id: body.assigned_by_user_id ?? currentUser?.profile.user_id ?? null,
      assigned_to_user_id: body.assigned_to_user_id ?? null,
      assignment_note: body.assignment_note ?? null,
      assignment_due_at: assignmentDueAt,
      priority: body.priority ?? "normal",
      review_status: body.review_status ?? "not_required",
      adhoc_job_data: body.adhoc_job_data ?? null,
      adhoc_job_raw_text: body.adhoc_job_raw_text ?? null,
      source_type: body.source_type ?? "base_resume",
    })));

    if (isNeon()) {
      for (const application of data) {
        await execute(
          'INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)',
          [application.id, null, status, body.event_note ?? body.assignment_note ?? null]
        );
      }
    } else {
      const { supabase } = await import("@/lib/supabase");
      await supabase.from("application_events").insert((data ?? []).map((application: any) => ({
        application_id: application.id,
        from_status: null,
        to_status: status,
        note: body.event_note ?? body.assignment_note ?? null,
      })));
    }

    if (currentUser && data?.length) {
      if (isNeon()) {
        for (const application of data) {
          await execute(
            'INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              currentUser.profile.user_id,
              currentUser.profile.email,
              'application.created',
              'application',
              application.id,
              JSON.stringify({ job_id: body.job_id, candidate_id: application.candidate_id, status }),
            ]
          );
        }
      } else {
        const { supabase } = await import("@/lib/supabase");
        await supabase.from("audit_logs").insert(data.map((application: any) => ({
          actor_user_id: currentUser.profile.user_id,
          actor_email: currentUser.profile.email,
          action: "application.created",
          entity_type: "application",
          entity_id: application.id,
          metadata: {
            job_id: body.job_id,
            candidate_id: application.candidate_id,
            status,
          },
        })));
      }

      for (const application of data) {
        await logActivity({
          userId: currentUser.profile.user_id,
          actorName: currentUser.profile.display_name || currentUser.profile.email || undefined,
          type: "create",
          description: `Created application for candidate ${application.candidate_id}`,
          entityType: "application",
          entityId: application.id,
          entityName: `Job ${body.job_id}`,
          metadata: { job_id: body.job_id, candidate_id: application.candidate_id, status },
        });
      }

      for (const application of data) {
        void triggerWebhooks("application.created", {
          application_id: application.id,
          job_id: body.job_id,
          candidate_id: application.candidate_id,
          status,
          created_by: currentUser.profile.user_id,
        });
      }
    }

    return NextResponse.json({
      created: data ?? [],
      imported: data?.length ?? 0,
      skipped: candidateIds.length - newCandidateIds.length,
    }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "23505" || error?.message?.includes("unique constraint") || error?.message?.includes("23505")) {
      return NextResponse.json({ error: "Candidate already has an application for this job." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
