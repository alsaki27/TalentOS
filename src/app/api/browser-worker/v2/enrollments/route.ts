import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { enrollPrepareApplication, readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { assertStaffOperatorOrigin, prepareResponse } from "../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return prepareResponse(async () => {
    const { context, response } = await requireCurrentUser(["admin", "manager"]);
    if (response) return response;
    assertStaffOperatorOrigin(request);
    return NextResponse.json(await enrollPrepareApplication(await readPrepareJson(request), context.user.id), { status: 201 });
  });
}
