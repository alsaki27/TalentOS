// READ-ONLY verification. Calls the REAL, now-patched extractText() (the
// exact production function, not a re-implementation) against every real
// PDF resume file currently in the system, to confirm the previously-failing
// file now extracts real text and no previously-working file regresses.
// npx tsx --env-file=.env.local scratch/verify_pdf_extraction_fix.ts
import { query } from "../src/server/db/neon";
import { downloadFromSharePoint } from "../src/lib/integrations/sharepoint";
import { extractText } from "../src/lib/resumeParsing";

async function main() {
  const rows = await query<{ id: string; name: string; file_url: string; filename: string }>(
    `SELECT DISTINCT ON (r.file_url) c.id, c.name, r.file_url, r.filename
     FROM candidates c
     JOIN resumes r ON r.candidate_id = c.id AND r.kind = 'resume'
     WHERE r.file_url IS NOT NULL AND r.filename ILIKE '%.pdf'
     ORDER BY r.file_url, r.created_at DESC`
  );
  console.log(`Found ${rows.length} distinct real PDF resume files to test.\n`);

  for (const row of rows) {
    console.log(`=== ${row.name} — ${row.filename} ===`);
    try {
      let buffer: Uint8Array;
      if (row.file_url.includes("sharepoint.com")) {
        const result = await downloadFromSharePoint(row.file_url);
        buffer = result.buffer;
      } else {
        const fileRes = await fetch(row.file_url);
        if (!fileRes.ok) throw new Error(`download failed (${fileRes.status})`);
        buffer = new Uint8Array(await fileRes.arrayBuffer());
      }

      const t0 = Date.now();
      const text = (await extractText(buffer, "application/pdf")).trim();
      const ms = Date.now() - t0;
      console.log(`  extractText(): ${text.length} chars in ${ms}ms`);
      console.log(`  preview: ${JSON.stringify(text.slice(0, 200))}`);
    } catch (err: any) {
      console.log(`  ERROR: ${err?.message || err}`);
    }
    console.log("");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
