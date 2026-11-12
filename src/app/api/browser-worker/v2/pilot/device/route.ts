import { NextResponse } from "next/server";
import { getPilotDevice, revokePilotDevice } from "@/server/services/browserWorkerPrepareService";
import { prepareResponse } from "../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return prepareResponse(async () => NextResponse.json(await getPilotDevice(request)));
}

export function DELETE(request: Request) {
  return prepareResponse(async () => NextResponse.json(await revokePilotDevice(request)));
}
