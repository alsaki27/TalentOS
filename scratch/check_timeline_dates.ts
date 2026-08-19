import { query } from "../src/server/db/neon";

function yearOf(s: any): number | null {
  if (s == null) return null;
  if (typeof s === "object") s = s?.text ?? s?.value ?? "";
  const m = String(s).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

async function main() {
  const rows = await query(`SELECT id, name, content FROM base_resumes ORDER BY updated_at DESC LIMIT 400`);
  let currentWithBadEnd = 0;
  let totalCurrent = 0;
  const samples: string[] = [];
  for (const r of rows as any[]) {
    const c = r.content;
    if (!c || typeof c !== "object") continue;
    const exp = Array.isArray(c.experience) ? c.experience : [];
    for (const e of exp) {
      if (!e || typeof e !== "object") continue;
      const endText = typeof e.endDate === "string" ? e.endDate : e?.endDate?.text ?? e?.endDate?.value ?? null;
      const endNorm = endText ? String(endText).toLowerCase() : "";
      const isCurrent = /present|current|ongoing|now/i.test(endNorm) || !endText;
      if (!isCurrent) continue;
      totalCurrent++;
      const startYear = yearOf(e.startDate);
      const endYear = yearOf(endText);
      if (endText && endYear !== null && startYear !== null && endYear < startYear) {
        currentWithBadEnd++;
        if (samples.length < 8) {
          samples.push(`${String(r.id).slice(0, 8)} "${e.title ?? "?"}" start=${JSON.stringify(e.startDate)} end=${JSON.stringify(endText)}`);
        }
      }
    }
  }
  console.log("scanned base resumes:", (rows as any[]).length);
  console.log("current/present roles:", totalCurrent);
  console.log("current roles with end year BEFORE start year (impossible date):", currentWithBadEnd);
  console.log("samples:");
  samples.forEach((s) => console.log(" -", s));

  const tail = await query(
    `SELECT COUNT(*)::int AS n FROM application_resume_versions v
     WHERE v.source_type = 'ai_agent' AND v.content::text LIKE '%2001%'`
  );
  console.log("ai_agent tailored versions containing '2001' anywhere:", (tail as any[])[0]?.n);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
