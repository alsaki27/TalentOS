// src/app/api/applications/[id]/proof/route.ts
// POST -> upload proof screenshot. FormData with file.
// GET  -> list proofs for an application.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_PROOF_BYTES) {
    return NextResponse.json({ error: "Proof file must be 10 MB or smaller." }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `application-proofs/${params.id}/${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: file.type || "application/octet-stream", upsert: true });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: urlData } = supabase.storage.from("resumes").getPublicUrl(path);
  const proofUrl = urlData.publicUrl;

  const { data, error } = await supabase
    .from("application_proofs")
    .insert({
      application_id: params.id,
      file_url: proofUrl,
      file_type: file.type || "application/octet-stream",
      uploaded_by: context!.profile.user_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase
    .from("applications")
    .update({
      proof_url: proofUrl,
      proof_filename: file.name,
      proof_uploaded_at: new Date().toISOString(),
      proof_uploaded_by_user_id: context!.profile.user_id,
    })
    .eq("id", params.id);

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Uploaded proof for application ${params.id}`,
    entityType: "application_proof",
    entityId: data.id,
    metadata: { application_id: params.id, file_url: proofUrl, filename: file.name, size: file.size },
  });

  return NextResponse.json(data, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const { data, error } = await supabase
    .from("application_proofs")
    .select("*")
    .eq("application_id", params.id)
    .order("uploaded_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
