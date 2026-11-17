import { getBrowserQueueArtifact } from "@/server/services/browserWorkerQueueService";
import { queueResponse } from "../../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, { params }: { params: { id: string } }) {
  return queueResponse(async () => {
    const bytes = await getBrowserQueueArtifact(request, params.id);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": 'attachment; filename="pinned-resume.pdf"',
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
