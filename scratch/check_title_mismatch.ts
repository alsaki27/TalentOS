import { query } from "../src/server/db/neon";

async function main() {
  const rows = await query(
    `SELECT v.id, v.candidate_id, v.base_resume_id, v.title AS version_title,
            v.content->'experience' AS tailored_exp,
            b.content->'experience' AS base_exp,
            v.content->'header'->>'fullName' AS header_name,
            b.content->'header'->>'fullName' AS base_header_name
     FROM application_resume_versions v
     LEFT JOIN base_resumes b ON b.id = v.base_resume_id
     WHERE v.source_type = 'ai_agent'
     ORDER BY v.created_at DESC
     LIMIT 40`
  );
  let mismatchCount = 0;
  for (const r of rows as any[]) {
    const tailored = Array.isArray(r.tailored_exp) ? r.tailored_exp : [];
    const base = Array.isArray(r.base_exp) ? r.base_exp : [];
    const tTitles = tailored.map((e: any) => String(e?.title ?? e?.role ?? ""));
    const bTitles = base.map((e: any) => String(e?.title ?? e?.role ?? ""));
    const tNames = tailored.map((e: any) => String(e?.company ?? ""));
    const bNames = base.map((e: any) => String(e?.company ?? ""));
    const sameTitles = JSON.stringify(tTitles) === JSON.stringify(bTitles);
    const sameCompanies = JSON.stringify(tNames) === JSON.stringify(bNames);
    if (!sameTitles || !sameCompanies) {
      mismatchCount++;
      console.log("MISMATCH version=", String(r.id).slice(0, 8), "candidate=", String(r.candidate_id).slice(0, 8));
      console.log("  version_title:", r.version_title);
      console.log("  tailored titles:", JSON.stringify(tTitles));
      console.log("  base titles    :", JSON.stringify(bTitles));
      console.log("  tailored comps :", JSON.stringify(tNames));
      console.log("  base comps     :", JSON.stringify(bNames));
    } else {
      console.log("OK  version=", String(r.id).slice(0, 8), "| version_title:", r.version_title, "| titles:", JSON.stringify(tTitles));
    }
  }
  console.log("total checked:", (rows as any[]).length, "mismatches:", mismatchCount);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
