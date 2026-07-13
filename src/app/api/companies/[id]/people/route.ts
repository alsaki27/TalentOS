import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { queryOne } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const fullName = String(body.full_name ?? "").trim();
  if (!fullName) return NextResponse.json({ error: "full_name is required" }, { status: 400 });

  let data: any;
  let error: any;

  try {
    data = await queryOne(
      `INSERT INTO company_people (company_id, full_name, normalized_name, title, linkedin_url, photo_url, email, phone, influence_level, relationship_status, notes, source, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        params.id,
        fullName,
        normalizeCompanyName(fullName),
        body.title || null,
        body.linkedin_url || null,
        body.photo_url || null,
        body.email || null,
        body.phone || null,
        body.influence_level || "unknown",
        body.relationship_status || "new",
        body.notes || null,
        body.source || "manual",
        new Date().toISOString(),
      ]
    );
    error = data ? null : { message: "Insert failed" };
  } catch (err: any) {
    error = { message: err.message };
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
