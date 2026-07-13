// src/app/api/applications/[id]/proof/route.ts
// POST -> upload proof screenshot. FormData with file.
// GET  -> list proofs for an application.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { query, queryOne, execute } from "@/server/db/neon";
import { uploadFile, getPublicUrl } from "@/server/storage/storageApi";

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
  const buffer = new Uint8Array(await file.arrayBuffer());

  const { url: proofUrl } = await uploadFile(path, buffer, file.type || "application/octet-stream");

  const data = await queryOne<Record<string, any>>(
    `INSERT INTO application_proofs (application_id, file_url, file_type, uploaded_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.id, proofUrl, file.type || "application/octet-stream", context!.profile.user_id]
  );
  if (!data) return NextResponse.json({ error: "Failed to record proof upload." }, { status: 500 });

  await execute(
    `UPDATE applications SET proof_url = $1, proof_filename = $2, proof_uploaded_at = $3, proof_uploaded_by_user_id = $4 WHERE id = $5`,
    [proofUrl, file.name, new Date().toISOString(), context!.profile.user_id, params.id]
  );

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

  const data = await query<Record<string, any>>(
    'SELECT * FROM application_proofs WHERE application_id = $1 ORDER BY uploaded_at DESC',
    [params.id]
  );
  return NextResponse.json(data ?? []);
}