import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";
import { renderResumePdfWithMetrics } from "@/lib/falood/skarionPdfDocument";
import { sha256Hex } from "@/lib/sha256";

function canonicalContent(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalContent).join(",") + "]";
  if (value && typeof value === "object") {
    const fields = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return "{" + fields.map(([key, entry]) => JSON.stringify(key) + ":" + canonicalContent(entry)).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

export async function renderEvidenceReleasePdf(content: unknown, maxPages: number) {
  const fields = content as { education?: unknown[]; experience?: unknown[] } | null;
  const normalized = normalizeResumeContentForExport({ ...fields, education: fields?.education ?? [], experience: fields?.experience ?? [] });
  if (!normalized.header?.fullName?.trim()) throw new Error("Add the verified candidate name before releasing the resume");
  const { doc, metrics } = renderResumePdfWithMetrics(normalized);
  const contentHash = await sha256Hex(canonicalContent(content));
  // jsPDF otherwise puts a random file ID and the render time in the bytes.
  doc.setFileId(contentHash.slice(0, 32));
  doc.setCreationDate("D:19700101000000+00'00'");
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  const encoding = new TextDecoder("windows-1252");
  const commands = encoding.decode(bytes);
  const emitted = Array.from(commands.matchAll(/\(((?:\\[^\r\n]|[^\\()])*)\)\s*Tj/g), match =>
    match[1].replace(/\\([0-7]{1,3}|.)/g, (_, escaped: string) =>
      /^[0-7]/.test(escaped) ? encoding.decode(Uint8Array.of(Number.parseInt(escaped, 8))) : escaped,
    ),
  );
  const searchable = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const text = searchable(emitted.join(" "));
  const sections = [normalized.header.fullName, ...normalized.experience.map(role => `${role.title} ${role.company}`)];
  let cursor = 0;
  const textOrderVerified = sections.every(section => {
    const expected = searchable(section);
    const at = expected ? text.indexOf(expected, cursor) : -1;
    if (at < 0) return false;
    cursor = at + expected.length;
    return true;
  });
  return {
    bytes, contentHash, pdfHash: await sha256Hex(bytes), metrics,
    passed: metrics.readable && metrics.pageCount > 0 && metrics.pageCount <= maxPages
      && !metrics.horizontalOverflow && textOrderVerified,
    textOrderVerified,
  };
}
