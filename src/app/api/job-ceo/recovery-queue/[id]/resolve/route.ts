import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { findStagedById, updateStaged } from "@/server/repositories/jobCeoStagingRepository";
import { createRun, updateRunStatus } from "@/server/repositories/jobCeoRunRepository";
import { getDescriptionMinimumForStagedRow } from "@/server/services/jobCeoService";
import { isSafeExternalUrl } from "@/lib/ai/job-agents/fetchJobPage";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

/**
 * Attaches a staff-recovered description (and, optionally, a better source
 * URL) to a job stuck in the recovery queue (stage='no_description'), then
 * re-enters it through the ordinary QA -> Matchmaker -> log flow — it never
 * writes directly to the live jobs table. See "Adzuna Job CEO Coverage and
 * Description Recovery Plan" (2026-10-25), Phase 2.
 *
 * The row may have run_id=NULL (its original run was deleted — see
 * jobCeoRunRepository.ts's deleteRun(), which detaches rather than destroys
 * these rows), so this creates a small, fresh run for it and lets the
 * existing dispatcher take over from there, rather than trying to resume
 * whatever run it originally belonged to.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: { descriptionText?: string; sourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const descriptionText = String(body.descriptionText ?? "").trim();
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl).trim() : undefined;

  if (sourceUrl && !isSafeExternalUrl(sourceUrl)) {
    return NextResponse.json({ error: "sourceUrl is not a safe external URL" }, { status: 400 });
  }

  try {
    const row = await findStagedById(params.id);
    if (!row) {
      return NextResponse.json({ error: "Staging row not found" }, { status: 404 });
    }
    if (row.stage !== "no_description") {
      return NextResponse.json(
        { error: `This row is at stage "${row.stage}", not "no_description" — only recovery-queue rows can be resolved here.` },
        { status: 409 }
      );
    }

    const minimumLength = getDescriptionMinimumForStagedRow(row);
    if (descriptionText.length < minimumLength) {
      return NextResponse.json(
        { error: `Description is too short (${descriptionText.length} chars; need ${minimumLength}) for this source.` },
        { status: 400 }
      );
    }

    const rawSource =
      row.raw && typeof row.raw === "object" ? String((row.raw as Record<string, unknown>).source ?? "") : "";

    const newRun = await createRun({
      source: rawSource || undefined,
      triggerType: "manual_recovery",
      startedBy: context?.profile.user_id,
    });

    await updateStaged(row.id, {
      run_id: newRun.id,
      description_text: descriptionText,
      source_url: sourceUrl ?? row.source_url,
      stage: "researched",
      last_error: null,
    });
    // The row already has a real, staff-verified description — it skips
    // straight to the stage right after Deep Fetch would have produced one,
    // so QA Bouncer is the next thing to touch it.
    await updateRunStatus(newRun.id, "qa");

    const baseUrl =
      process.env.TALENTOS_BASE_URL ||
      (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://talent.skarion.com");
    const cronSecret = process.env.CRON_SECRET;
    const dispatchUrl = new URL(`${baseUrl}/api/job-ceo/dispatch`);
    dispatchUrl.searchParams.set("runId", newRun.id);
    await backgroundDispatch(
      fetch(dispatchUrl.toString(), {
        method: "POST",
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined,
      }).catch((err) => {
        console.error("[Job CEO] Recovery-queue resolve dispatch self-fetch failed:", err);
      })
    );

    return NextResponse.json({ success: true, runId: newRun.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
