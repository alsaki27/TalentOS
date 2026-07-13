import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { runAndRecord } from "@/lib/importSourceRunner";
import { queryOne } from "@/server/db/neon";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let source: any;
  let error: any;

  try {
    source = await queryOne(`SELECT * FROM import_sources WHERE id = $1`, [params.id]);
    error = source ? null : { message: "Not found" };
  } catch (err: any) {
    error = { message: err.message };
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const result = await runAndRecord(source);
  return "error" in result
    ? NextResponse.json(result, { status: 502 })
    : NextResponse.json(result);
}
