// READ-ONLY diagnostic. Decompresses EVERY stream in the failing real PDF
// (found via raw 'stream'/'endstream' keyword scan, not the production
// regex) and checks each for actual Tj/TJ text-show operators, to determine
// whether extractable text exists in this file at all, and whether the
// production regex is under-matching real content streams.
// npx tsx --env-file=.env.local scratch/diagnose_pdf_all_streams.ts
import { query } from "../src/server/db/neon";
import { downloadFromSharePoint } from "../src/lib/integrations/sharepoint";

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function main() {
  const rows = await query<{ file_url: string; filename: string }>(
    `SELECT r.file_url, r.filename FROM resumes r WHERE r.filename ILIKE '%resume 3%' LIMIT 1`
  );
  const target = rows[0];
  const { buffer } = await downloadFromSharePoint(target.file_url);
  const latin1 = new TextDecoder("latin1").decode(buffer);

  // Find every literal "N G obj ... stream\r?\n ... endstream" block by
  // scanning for "stream" keywords directly (ground truth, not the
  // production regex), and grab the dict immediately preceding each.
  const streamRe = /(<<[\s\S]*?>>)\s*stream\r?\n/g;
  // Note: [\s\S]*? (not [^>]*?) so nested <<...>> pairs don't truncate the match.
  let m: RegExpExecArray | null;
  let idx = 0;
  let totalDecompressedChars = 0;
  let streamsWithTextOps = 0;
  let streamsChecked = 0;

  while ((m = streamRe.exec(latin1))) {
    idx++;
    const dict = m[1];
    const streamStart = m.index + m[0].length;
    const endIdx = latin1.indexOf("endstream", streamStart);
    if (endIdx === -1) continue;
    let streamEnd = endIdx;
    while (streamEnd > streamStart && (latin1[streamEnd - 1] === "\n" || latin1[streamEnd - 1] === "\r")) streamEnd--;
    const rawBytes = buffer.subarray(streamStart, streamEnd);

    const lengthMatch = dict.match(/\/Length\s+(\d+)/);
    const declaredLength = lengthMatch ? parseInt(lengthMatch[1], 10) : null;
    const isFlate = dict.includes("/FlateDecode");
    const isImage = dict.includes("/Subtype /Image") || dict.includes("/Subtype/Image");

    let decompressedPreview = "";
    let hasTextOps = false;
    let decompressedLen = -1;
    if (isFlate) {
      try {
        const inflated = await inflate(new Uint8Array(rawBytes));
        decompressedLen = inflated.length;
        const text = new TextDecoder("latin1").decode(inflated);
        hasTextOps = /\bTj\b|\bTJ\b|\bBT\b/.test(text);
        decompressedPreview = text.slice(0, 80).replace(/\s+/g, " ");
        totalDecompressedChars += text.length;
        if (hasTextOps) streamsWithTextOps++;
        streamsChecked++;
      } catch (err: any) {
        decompressedPreview = `INFLATE FAILED: ${err.message}`;
      }
    }

    console.log(
      `[${idx}] rawLen=${rawBytes.length} declaredLength=${declaredLength} isFlate=${isFlate} isImage=${isImage} ` +
      `decompressedLen=${decompressedLen} hasTextOps=${hasTextOps}`
    );
    console.log(`     dict: ${dict.replace(/\s+/g, " ").slice(0, 150)}`);
    if (decompressedPreview) console.log(`     preview: ${JSON.stringify(decompressedPreview)}`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total stream objects found (nested-dict-safe regex): ${idx}`);
  console.log(`FlateDecode streams successfully decompressed: ${streamsChecked}`);
  console.log(`Streams containing Tj/TJ/BT text operators: ${streamsWithTextOps}`);
  console.log(`Total decompressed chars across all streams: ${totalDecompressedChars}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
