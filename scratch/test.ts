export function readResumeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "object" || value === null) return "";

  for (const key of ["text", "value", "name", "label", "title"]) {
    const nested = (value as any)[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "";
}

export function readYear(value: unknown): number | null {
  const text = readResumeText(value);
  const match = text.match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

function sanitizeEndDate(rawStartDate: string | null, rawEndDate: string | null, label: string, isCurrentJob: boolean = false): string | null {
  if (!rawStartDate || !rawEndDate) return rawEndDate;
  const startYear = readYear(rawStartDate);
  const endYear = readYear(rawEndDate);
  if (startYear !== null && endYear !== null && endYear < startYear) {
    console.warn(
      `[resumeIntegrity] Dropping impossible end date for "${label}": "${rawEndDate}" is before start date "${rawStartDate}". Changing to "Present".`
    );
    return "Present";
  }
  return rawEndDate;
}

console.log(sanitizeEndDate("May 2025", "Jan 2001", "Financial Analyst", true));
