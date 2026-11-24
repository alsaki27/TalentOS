import { NextResponse } from "next/server";
import { extensionError, withExtensionCors } from "@/lib/extensionAuth";
import { authenticateRecorder } from "../_auth";
import { listRecordingCandidates } from "@/server/services/submissionRecordService";

export const dynamic = "force-dynamic";
export const GET = withExtensionCors(async request => {
  try {
    const auth = await authenticateRecorder(request);
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json({ candidates: await listRecordingCandidates(auth.key.candidate_id), ownerUserId: auth.ownerId },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch { return extensionError("internal_error", "Could not load recording candidates.", 500); }
});
export const OPTIONS = withExtensionCors(async () => new NextResponse(null, { status: 204 }));
