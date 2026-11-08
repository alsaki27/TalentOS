import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import {
  getApplicationResumeQcDetails,
  isResumeQcStatus,
  setApplicationResumeQcStatus,
  updateApplicationResumeQcNote,
} from "@/server/repositories/applicationResumeQcRepository";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 8000;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Invalid application ID." }, { status: 400 });

  try {
    const details = await getApplicationResumeQcDetails(params.id);
    if (!details) return NextResponse.json({ error: "Application not found." }, { status: 404 });
    return NextResponse.json({
      ...details,
      canEdit: context!.profile.role === "admin" && details.eligible,
    });
  } catch (error) {
    console.error("[application-resume-qc] Could not load QC history:", error);
    return NextResponse.json({ error: "Could not load resume QC history." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Invalid application ID." }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawNote = typeof body?.note === "string" ? body.note : undefined;
  if (rawNote !== undefined && rawNote.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `Notes must be ${MAX_NOTE_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });
  }

  const actor = {
    userId: context!.profile.user_id,
    name: context!.profile.display_name?.trim() || context!.profile.email || context!.user.id,
  };

  try {
    if (body?.action === "set_status") {
      if (!isResumeQcStatus(body.status)) {
        return NextResponse.json({ error: "Choose Qualified, Doubt, or Unqualified." }, { status: 400 });
      }
      const note = rawNote?.trim() || null;
      if ((body.status === "doubt" || body.status === "unqualified") && !note) {
        return NextResponse.json({ error: "A note is required for Doubt and Unqualified." }, { status: 400 });
      }
      const saved = await setApplicationResumeQcStatus({
        applicationId: params.id,
        status: body.status,
        note,
        actor,
      });
      if (!saved) {
        const existing = await getApplicationResumeQcDetails(params.id);
        if (!existing) return NextResponse.json({ error: "Application not found." }, { status: 404 });
        return NextResponse.json({ error: "QC can only be changed during In AI Pipeline or AE Review Pending." }, { status: 409 });
      }
    } else if (body?.action === "update_note") {
      if (!isResumeQcStatus(body.stage)) {
        return NextResponse.json({ error: "Choose a valid QC stage for this note." }, { status: 400 });
      }
      if (rawNote === undefined) {
        return NextResponse.json({ error: "Note text is required." }, { status: 400 });
      }
      const note = rawNote.trim();
      if (!note && body.stage !== "qualified") {
        return NextResponse.json({ error: "Doubt and Unqualified notes cannot be cleared." }, { status: 400 });
      }
      const saved = await updateApplicationResumeQcNote({
        applicationId: params.id,
        stage: body.stage,
        note,
        actor,
      });
      if (!saved) {
        const existing = await getApplicationResumeQcDetails(params.id);
        if (!existing) return NextResponse.json({ error: "Application not found." }, { status: 404 });
        return NextResponse.json({ error: "QC notes can only be changed during In AI Pipeline or AE Review Pending." }, { status: 409 });
      }
    } else {
      return NextResponse.json({ error: "Unknown QC action." }, { status: 400 });
    }

    const details = await getApplicationResumeQcDetails(params.id);
    return details
      ? NextResponse.json({ ...details, canEdit: true })
      : NextResponse.json({ error: "Application not found." }, { status: 404 });
  } catch (error) {
    console.error("[application-resume-qc] Could not save QC update:", error);
    return NextResponse.json({ error: "Could not save the resume QC update." }, { status: 500 });
  }
}
