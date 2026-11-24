import { NextResponse } from "next/server";
import { extensionError, withExtensionCors } from "@/lib/extensionAuth";
import { parseSubmissionRecord, type SubmissionRecordInput } from "@/lib/submissionRecords";
import { authenticateRecorder } from "./_auth";
import { listRecordingCandidates, saveSubmissionRecords } from "@/server/services/submissionRecordService";

export const dynamic = "force-dynamic";
export const POST = withExtensionCors(async request => {
  try {
    const auth = await authenticateRecorder(request);
    if (auth instanceof NextResponse) return auth;
    const reader = request.body?.getReader();
    if (!reader) return extensionError("validation_error", "A JSON body is required.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1500000) { await reader.cancel(); return extensionError("payload_too_large", "Batch exceeds 1.5 MB.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body: { records?: unknown[] };
    try { body = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return extensionError("validation_error", "Provide valid JSON.", 400); }
    if (!body || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > 100) return extensionError("validation_error", "Send 1–100 records.", 400);
    const records: SubmissionRecordInput[] = [], excluded: string[] = [];
    try {
      for (const raw of body.records) {
        const record = parseSubmissionRecord(raw);
        if (record) records.push(record); else excluded.push((raw as { id: string }).id);
      }
    } catch (e) { return extensionError("validation_error", e instanceof Error ? e.message : "Invalid record.", 400); }
    const ids = body.records.map(raw => (raw as { id: string }).id.toLowerCase());
    if (new Set(ids).size !== ids.length) return extensionError("validation_error", "Duplicate event IDs in this batch.", 400);
    // Check candidate scope even for filtered sensitive records; no cross-candidate acceptance.
    if (auth.key.candidate_id && body.records.some(raw => (raw as { candidate_id: string }).candidate_id.toLowerCase() !== auth.key.candidate_id)) return extensionError("candidate_scope_mismatch", "This key is restricted to another candidate.", 403);
    const candidates = new Set((await listRecordingCandidates(auth.key.candidate_id)).map(c => c.id));
    if (records.some(record => !candidates.has(record.candidate_id))) return extensionError("candidate_unavailable", "A candidate is inactive or unavailable. Queued records have not been reassigned.", 409);
    const result = await saveSubmissionRecords(records, auth.ownerId, auth.key.id);
    return NextResponse.json({ ...result, excluded }, { headers: { "Cache-Control": "no-store" } });
  } catch { return extensionError("internal_error", "Could not save form entries. They should remain queued for retry.", 500); }
});
export const OPTIONS = withExtensionCors(async () => new NextResponse(null, { status: 204 }));
