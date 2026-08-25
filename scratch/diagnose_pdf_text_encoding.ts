// READ-ONLY diagnostic. Confirms whether the real text-bearing content
// streams use hex-string Tj/TJ operators (<...> instead of (...)) - which
// the current extractTextShowOperators() regex cannot see at all - and
// inspects the matching /ToUnicode CMap object to confirm its format.
// npx tsx --env-file=.env.local scratch/diagnose_pdf_text_encoding.ts
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
  const rows = await query<{ file_url: string }>(
    `SELECT r.file_url FROM resumes r WHERE r.filename ILIKE '%resume 3%' LIMIT 1`
  );
  const { buffer } = await downloadFromSharePoint(rows[0].file_url);
  const latin1 = new TextDecoder("latin1").decode(buffer);

  const streamRe = /(<<[\s\S]*?>>)\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = streamRe.exec(latin1))) {
    idx++;
    const dict = m[1];
    if (!dict.includes("/FlateDecode")) continue;
    const streamStart = m.index + m[0].length;
    const endIdx = latin1.indexOf("endstream", streamStart);
    if (endIdx === -1) continue;
    let streamEnd = endIdx;
    while (streamEnd > streamStart && (latin1[streamEnd - 1] === "\n" || latin1[streamEnd - 1] === "\r")) streamEnd--;
    const rawBytes = buffer.subarray(streamStart, streamEnd);
    let text = "";
    try {
      const inflated = await inflate(new Uint8Array(rawBytes));
      text = new TextDecoder("latin1").decode(inflated);
    } catch {
      continue;
    }
    if (!/\bTj\b|\bTJ\b/.test(text)) continue;

    console.log(`\n=== Stream [${idx}] — decompressed ${text.length} chars ===`);
    // Show first few Tj/TJ operator invocations verbatim, byte-exact.
    const opMatches = text.match(/[(<][^()<>]{0,60}[)>]\s*(?:Tj|TJ)/g) ?? [];
    console.log(`Sample Tj/TJ invocations found (first 6):`);
    opMatches.slice(0, 6).forEach((op) => console.log(`  ${JSON.stringify(op)}`));

    const hexStringTjCount = (text.match(/<[0-9A-Fa-f\s]+>\s*Tj/g) ?? []).length;
    const literalStringTjCount = (text.match(/\([^()]*\)\s*Tj/g) ?? []).length;
    const hexInArrayCount = (text.match(/<[0-9A-Fa-f\s]+>/g) ?? []).length;
    console.log(`hex-string 'Tj' count: ${hexStringTjCount}`);
    console.log(`literal-string 'Tj' count: ${literalStringTjCount}`);
    console.log(`hex-string tokens anywhere in stream: ${hexInArrayCount}`);

    // Also check which font resource this content stream selects via Tf.
    const tfMatches = text.match(/\/(\S+)\s+[\d.]+\s+Tf/g) ?? [];
    console.log(`Font selectors (Tf) used: ${Array.from(new Set(tfMatches)).join(", ")}`);
  }

  // Now inspect a /ToUnicode CMap object's raw structure.
  const toUnicodeObjMatch = latin1.match(/(\d+)\s+0\s+obj\s*<<\/Length\s+\d+>>\s*stream\r?\n/);
  // Find any object referenced as /ToUnicode N 0 R, then locate "N 0 obj" and dump it.
  const toUnicodeRefMatch = latin1.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
  if (toUnicodeRefMatch) {
    const objNum = toUnicodeRefMatch[1];
    const objRe = new RegExp(`\\b${objNum}\\s+0\\s+obj([\\s\\S]{0,80})`, "");
    const objMatch = latin1.match(objRe);
    console.log(`\n=== /ToUnicode object ${objNum} header ===`);
    console.log(objMatch ? objMatch[1].replace(/\s+/g, " ") : "not found");

    // Find and decompress it.
    const fullObjRe = new RegExp(`\\b${objNum}\\s+0\\s+obj\\s*(<<[\\s\\S]*?>>)\\s*stream\\r?\\n`, "");
    const fullMatch = latin1.match(fullObjRe);
    if (fullMatch && fullMatch.index !== undefined) {
      const dict = fullMatch[1];
      const streamStart = fullMatch.index + fullMatch[0].length;
      const endIdx = latin1.indexOf("endstream", streamStart);
      let streamEnd = endIdx;
      while (streamEnd > streamStart && (latin1[streamEnd - 1] === "\n" || latin1[streamEnd - 1] === "\r")) streamEnd--;
      const rawBytes = buffer.subarray(streamStart, streamEnd);
      if (dict.includes("/FlateDecode")) {
        const inflated = await inflate(new Uint8Array(rawBytes));
        const cmapText = new TextDecoder("latin1").decode(inflated);
        console.log(`\nDecompressed ToUnicode CMap (first 600 chars):`);
        console.log(cmapText.slice(0, 600));
      }
    }
  } else {
    console.log("\nNo /ToUnicode reference found via simple regex scan.");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
