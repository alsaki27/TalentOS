import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { sendEmail, renderTemplate } from "@/lib/emailService";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MAX_FILES = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const candidate_id = formData.get("candidate_id")?.toString();
    
    if (!candidate_id) {
      return NextResponse.json({ error: "candidate_id is required" }, { status: 400 });
    }

    const files = formData.getAll("files") as File[];
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_FILES} files allowed` }, { status: 400 });
    }

    const attachmentUrls: string[] = [];
    
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File ${file.name} exceeds 10MB limit` }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = `${Date.now()}_${file.name}`;
      const path = `${candidate_id}/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from("email-attachments")
        .upload(path, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return NextResponse.json({ error: "Failed to upload attachment" }, { status: 500 });
      }

      const { data } = supabase.storage.from("email-attachments").getPublicUrl(path);
      attachmentUrls.push(data.publicUrl);
    }

    return NextResponse.json({ success: true, attachment_urls: attachmentUrls });
  }

  // Handle existing JSON body (sending system emails)
  const body = await req.json();
  if (!body.candidate_id) return NextResponse.json({ error: "candidate_id is required" }, { status: 400 });
  if (!body.template_id) return NextResponse.json({ error: "template_id is required" }, { status: 400 });

  let candidate: any;
  let template: any;

  candidate = await queryOne<any>(`SELECT id, name, email FROM candidates WHERE id = $1`, [body.candidate_id]);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (!candidate.email) return NextResponse.json({ error: "Candidate has no email" }, { status: 400 });

  template = await queryOne<any>(`SELECT id, name, subject, body FROM email_templates WHERE id = $1`, [body.template_id]);
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
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "email",
    description: `Sent email to candidate ${candidate.name} using template ${template.name}`,
    entityType: "candidate",
    entityId: body.candidate_id,
    entityName: candidate.name,
  });

  return NextResponse.json({ success: true, logId: result.logId });
}
