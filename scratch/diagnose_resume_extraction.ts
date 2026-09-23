// READ-ONLY (reads a real resume file for diagnostic purposes only, no DB writes).
// npx tsx --env-file=.env.local scratch/diagnose_resume_extraction.ts
import { query } from "../src/server/db/neon";
import { downloadFromSharePoint } from "../src/lib/integrations/sharepoint";
import { extractText } from "../src/lib/resumeParsing";
import { convertPdfToMarkdown } from "../src/lib/markitdown";

async function main() {
  console.log("MARKITDOWN_SERVICE_URL configured:", Boolean(process.env.MARKITDOWN_SERVICE_URL));
  console.log("NODE_ENV:", process.env.NODE_ENV);

  const candidates = await query<{ id: string; name: string; file_url: string; filename: string; kind: string }>(
    `SELECT c.id, c.name, r.file_url, r.filename, r.kind
     FROM candidates c
     JOIN resumes r ON r.candidate_id = c.id AND r.kind = 'resume'
     WHERE r.file_url IS NOT NULL
     ORDER BY r.created_at DESC LIMIT 5`
  );
  console.log(`\nFound ${candidates.length} candidates with an uploaded resume file to test:\n`);

  for (const cand of candidates) {
    console.log(`\n=== ${cand.name} (${cand.id}) — ${cand.filename} ===`);
    console.log(`  file_url: ${cand.file_url.slice(0, 90)}...`);
    try {
      let buffer: Uint8Array;
      let contentType: string | null = null;
      if (cand.file_url.includes("sharepoint.com")) {
        const result = await downloadFromSharePoint(cand.file_url);
        buffer = result.buffer;
        contentType = result.contentType;
        console.log(`  SharePoint download: OK, ${buffer.length} bytes, contentType=${contentType}`);
      } else {
        const fileRes = await fetch(cand.file_url);
        if (!fileRes.ok) throw new Error(`Failed to download (${fileRes.status})`);
        buffer = new Uint8Array(await fileRes.arrayBuffer());
        contentType = fileRes.headers.get("content-type");
        console.log(`  Direct download: OK, ${buffer.length} bytes, contentType=${contentType}`);
      }

      const mimeType = cand.filename.toLowerCase().endsWith(".pdf") ? "application/pdf"
        : cand.filename.toLowerCase().endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : contentType || "application/octet-stream";

      const rawText = (await extractText(buffer, mimeType)).trim();
      console.log(`  extractText() (hand-rolled/mammoth) result: ${rawText.length} chars`);
      console.log(`  first 150 chars: ${JSON.stringify(rawText.slice(0, 150))}`);

      if (mimeType.includes("pdf")) {
        const mdResult = await convertPdfToMarkdown(buffer, cand.filename);
        if (mdResult.success) {
          console.log(`  markitdown conversion: SUCCESS, ${mdResult.markdown?.length ?? 0} chars`);
          console.log(`  markitdown first 150 chars: ${JSON.stringify((mdResult.markdown ?? "").slice(0, 150))}`);
        } else {
          console.log(`  markitdown conversion: FAILED - ${mdResult.error}`);
        }
      }
    } catch (err: any) {
      console.log(`  ERROR: ${err?.message || err}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
