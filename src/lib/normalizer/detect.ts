// src/lib/normalizer/detect.ts
// Sniff a file's format from its name + content. Excel is explicitly out of scope (README).

export type DetectedFormat = "csv" | "tsv" | "json";

export function detectFormat(filename: string, content: string): DetectedFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "json") return "json";
  if (ext === "tsv") return "tsv";
  if (ext === "csv") return "csv";

  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? "tsv" : "csv";
}
