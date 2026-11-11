import { getPrepareArtifact } from "@/server/services/browserWorkerPrepareService";
import { prepareResponse } from "../../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return prepareResponse(async () => {
    const bytes = await getPrepareArtifact(request, params.id);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength),
      "Content-Disposition": 'attachment; filename="pinned-resume.pdf"', "X-Content-Type-Options": "nosniff",
    } });
  });
}
