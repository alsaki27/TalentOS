import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { revokePrepareEnrollment, BrowserWorkerPrepareError } from "@/server/services/browserWorkerPrepareService";
import { prepareResponse } from "../../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return prepareResponse(async () => {
    const { context, response } = await requireCurrentUser(["admin", "manager"]);
    if (response) return response;
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new BrowserWorkerPrepareError(403, "Same-origin operator request required");
    return NextResponse.json(await revokePrepareEnrollment(params.id, context.user.id));
  });
}
