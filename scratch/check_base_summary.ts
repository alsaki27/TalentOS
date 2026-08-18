import { query } from "../src/server/db/neon";

const ID = "0d394536-e089-40b1-b23c-acefc7321854";

async function main() {
  const r = (await query(`SELECT * FROM falood_saved_applications WHERE id = $1`, [ID]))[0] as any;
  console.log("name:", r?.name, "| candidate_id:", r?.candidate_id);
  console.log("job_description (first 200):", JSON.stringify(r?.job_description)?.slice(0, 200));
  console.log("resume_data type:", r?.resume_data ? (typeof r.resume_data === "object" ? "object" : typeof r.resume_data) : "null");
  console.log("resume_data keys:", r?.resume_data ? Object.keys(r.resume_data).join(", ") : "-");
  console.log("resume_data.summary:", JSON.stringify(r?.resume_data?.summary)?.slice(0, 300));
  console.log("resume_data.personalInfo keys:", r?.resume_data?.personalInfo ? Object.keys(r.resume_data.personalInfo).join(", ") : "-");
  console.log("resume_data.personalInfo.summary:", JSON.stringify(r?.resume_data?.personalInfo?.summary)?.slice(0, 300));
  console.log("versions type:", Array.isArray(r?.versions) ? "array(" + r.versions.length + ")" : typeof r?.versions);
  if (Array.isArray(r?.versions)) {
    r.versions.slice(0, 5).forEach((v: any, i: number) => {
      console.log(`version[${i}] keys:`, v && typeof v === "object" ? Object.keys(v).join(", ") : String(v));
      console.log(`version[${i}] content summary:`, JSON.stringify(v?.content?.summary ?? v?.summary ?? v?.resume_data?.summary)?.slice(0, 200));
    });
  }

  const br = await query(
    `SELECT id, name, content FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at ASC LIMIT 5`,
    [r?.candidate_id]
  );
  for (const b of br as any[]) {
    const c = typeof b.content === "object" ? b.content : {};
    console.log("base_resume", b.id, b.name, "keys:", Object.keys(c).join(", "));
    console.log("  summary:", JSON.stringify(c.summary ?? c.profile ?? c.objective ?? c.professionalSummary)?.slice(0, 300));
    const pi = c.personalInfo;
    if (pi && typeof pi === "object") console.log("  personalInfo.summary:", JSON.stringify(pi.summary ?? pi.objective ?? pi.profile)?.slice(0, 300));
  }
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
