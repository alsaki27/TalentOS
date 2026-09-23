// READ-ONLY. Scans base_resumes for chronologically impossible experience
// entries (endDate before startDate, by parsed year) to see if Avirup's
// "Jan 2001" is an isolated data error or a wider pattern.
import { query } from "../src/server/db/neon";

function yearOf(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = s.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

async function main() {
  const rows = await query<any>(
    `SELECT id, candidate_id, content->'experience' AS experience FROM base_resumes WHERE content->'experience' IS NOT NULL`
  );
  console.log("TOTAL_BASE_RESUMES_SCANNED:", rows.length);
  const anomalies: any[] = [];
  for (const row of rows) {
    const exp = Array.isArray(row.experience) ? row.experience : [];
    for (const e of exp) {
      const start = yearOf(e?.startDate);
      const end = yearOf(e?.endDate);
      if (start !== null && end !== null && end < start) {
        anomalies.push({ base_resume_id: row.id, candidate_id: row.candidate_id, title: e.title, company: e.company, startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent });
      }
    }
  }
  console.log("ANOMALIES (endDate year < startDate year):", JSON.stringify(anomalies, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
