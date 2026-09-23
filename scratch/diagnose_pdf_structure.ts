// READ-ONLY diagnostic. Downloads the exact real PDF that returned 0 chars
// from extractTextFromPdfBuffer() and inspects its raw byte structure to find
// the precise reason the current regex-based parser fails on it.
// npx tsx --env-file=.env.local scratch/diagnose_pdf_structure.ts
import { query } from "../src/server/db/neon";
import { downloadFromSharePoint } from "../src/lib/integrations/sharepoint";

async function main() {
  const rows = await query<{ id: string; name: string; file_url: string; filename: string }>(
    `SELECT c.id, c.name, r.file_url, r.filename
     FROM candidates c
     JOIN resumes r ON r.candidate_id = c.id AND r.kind = 'resume'
     WHERE r.filename ILIKE '%resume 3%' LIMIT 1`
  );
  if (rows.length === 0) {
    console.log("Could not find 'resume 3.pdf' by filename, aborting.");
    return;
  }
  const target = rows[0];
  console.log(`Testing: ${target.name} — ${target.filename}`);

  const { buffer } = await downloadFromSharePoint(target.file_url);
  console.log(`Downloaded ${buffer.length} bytes\n`);

  const latin1 = new TextDecoder("latin1").decode(buffer);

  // 1. PDF version header
  console.log("Header:", latin1.slice(0, 20).replace(/\n/g, "\\n"));

  // 2. Count raw "stream" / "endstream" keyword occurrences (ground truth)
  const streamKeywordCount = (latin1.match(/\bstream\b/g) ?? []).length;
  const endstreamKeywordCount = (latin1.match(/\bendstream\b/g) ?? []).length;
  console.log(`Raw 'stream' keyword occurrences: ${streamKeywordCount}`);
  console.log(`Raw 'endstream' keyword occurrences: ${endstreamKeywordCount}`);

  // 3. What the CURRENT production regex actually matches
  const currentRegex = /(<<[^>]*?>>)\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  let currentMatches = 0;
  while ((m = currentRegex.exec(latin1))) currentMatches++;
  console.log(`Current production regex (<<[^>]*?>>)\\s*stream matches: ${currentMatches}`);

  // 4. Look for object streams (compressed object containers) - a common
  //    modern-PDF-producer pattern the current parser has no concept of.
  const objStmCount = (latin1.match(/\/Type\s*\/ObjStm/g) ?? []).length;
  console.log(`/Type /ObjStm (compressed object streams) occurrences: ${objStmCount}`);

  // 5. Look at every dict-like header immediately preceding a literal
  //    "stream" keyword, using a wider capture window (up to 400 chars back),
  //    and report what filter (if any) it declares.
  const streamRe = /stream\r?\n/g;
  const dictSamples: string[] = [];
  let count = 0;
  while ((m = streamRe.exec(latin1)) && count < 8) {
    const windowStart = Math.max(0, m.index - 400);
    const before = latin1.slice(windowStart, m.index);
    const dictStart = before.lastIndexOf("obj");
    const dictText = dictStart !== -1 ? before.slice(dictStart) : before.slice(-200);
    dictSamples.push(dictText.replace(/\s+/g, " ").trim());
    count++;
  }
  console.log(`\nFirst ${dictSamples.length} dict headers found before a literal 'stream' keyword:`);
  dictSamples.forEach((s, i) => console.log(`  [${i}] ${s.slice(0, 250)}`));

  // 6. Cross-reference stream type (xref table vs xref stream - PDF 1.5+)
  const hasXrefTable = /\bxref\r?\n/.test(latin1);
  const hasXrefStream = /\/Type\s*\/XRef\b/.test(latin1);
  console.log(`\nHas classic 'xref' table: ${hasXrefTable}`);
  console.log(`Has /Type /XRef (cross-reference stream, PDF 1.5+): ${hasXrefStream}`);

  // 7. Filter types actually declared anywhere in the file
  const filterMatches = latin1.match(/\/Filter\s*\/?\[?[A-Za-z0-9\/ ]{0,40}/g) ?? [];
  const uniqueFilters = Array.from(new Set(filterMatches.map((f) => f.replace(/\s+/g, " ").trim())));
  console.log(`\nDistinct /Filter declarations found (sample up to 15):`);
  uniqueFilters.slice(0, 15).forEach((f) => console.log(`  ${f}`));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
