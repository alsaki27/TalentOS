// src/app/api/email/send/route.ts
// POST -> send email immediately using template + merge data

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { sendEmail, renderTemplate } from "@/lib/emailService";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.candidate_id) return NextResponse.json({ error: "candidate_id is required" }, { status: 400 });
  if (!body.template_id) return NextResponse.json({ error: "template_id is required" }, { status: 400 });

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, name, email")
    .eq("id", body.candidate_id)
    .maybeSingle();

  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (!candidate.email) return NextResponse.json({ error: "Candidate has no email" }, { status: 400 });

  const { data: template } = await supabase
    .from("email_templates")
    .select("id, name, subject, body")
    .eq("id", body.template_id)
    .maybeSingle();

  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const mergeData: Record<string, string> = {
    candidate_name: candidate.name || "Candidate",
    ...body.merge_data,
  };

  const renderedSubject = renderTemplate(template.subject, mergeData);
  const renderedBody = renderTemplate(template.body, mergeData);

  const result = await sendEmail({
    to: candidate.email,
    subject: renderedSubject,
    body: renderedBody,
    candidateId: body.candidate_id,
    templateId: body.template_id,
    sentBy: context.profile.user_id,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Failed to send email" }, { status: 500 });
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email,
    type: "email",
    description: `Sent email to candidate ${candidate.name} using template ${template.name}`,
    entityType: "candidate",
    entityId: body.candidate_id,
    entityName: candidate.name,
  });

  return NextResponse.json({ success: true, logId: result.logId });
}
