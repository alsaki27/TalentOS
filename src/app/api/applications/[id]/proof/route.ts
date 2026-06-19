// src/app/api/applications/[id]/proof/route.ts
// POST -> upload proof screenshot. FormData with file.
// GET  -> list proofs for an application

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  const timestamp = Date.now();
  const path = `applications/${params.id}/${timestamp}.png`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage
    .from("proofs")
    .upload(path, buffer, { contentType: file.type || "image/png", upsert: true });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from("proofs").getPublicUrl(path);

  const { data, error } = await supabase
    .from("application_proofs")
    .insert({
      application_id: params.id,
      file_url: urlData.publicUrl,
      file_type: file.type || "image/png",
      uploaded_by: context!.profile.user_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Uploaded proof for application ${params.id}`,
    entityType: "application_proof",
    entityId: data.id,
    metadata: { application_id: params.id, file_url: urlData.publicUrl },
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
