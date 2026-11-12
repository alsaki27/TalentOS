import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { revokePrepareEnrollment } from "@/server/services/browserWorkerPrepareService";
import { assertStaffOperatorOrigin, prepareResponse } from "../../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return prepareResponse(async () => {
    const { context, response } = await requireCurrentUser(["admin", "manager"]);
    if (response) return response;
    assertStaffOperatorOrigin(request);
    return NextResponse.json(await revokePrepareEnrollment(params.id, context.user.id));
  });
}
