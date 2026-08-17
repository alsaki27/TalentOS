import { query } from "../src/server/db/neon";
import { listApplicationQueue } from "../src/server/repositories/applicationsRepository";

async function main() {
  const nums = await query(
    `SELECT a.app_number, c.candidate_number, j.job_number, a.status
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE a.app_number IS NOT NULL AND a.status IN ('assigned','stacked','in_progress')
     ORDER BY a.created_at DESC LIMIT 3`
  );
  const sample = (nums as any[])[0];
  console.log("sample (in queue):", JSON.stringify(sample));

  const searchParams = {
    page: 1, pageSize: 50, view: "all" as const,
    userId: "00000000-0000-0000-0000-000000000000",
    userEmail: null, userDisplayName: null, userRole: "admin",
    sort: "due" as const, sortDirection: "desc" as const,
  };

  if (sample?.candidate_number != null) {
    const r = await listApplicationQueue({ ...searchParams, search: `C#${sample.candidate_number}` });
    console.log(`C#${sample.candidate_number} -> total:`, r.total, "| rows:", r.items.map((i: any) => `${i.app_number}/${i.candidates?.candidate_number}/${i.jobs?.job_number} ${i.status}`));
  }
  if (sample?.app_number != null) {
    const r = await listApplicationQueue({ ...searchParams, search: `A#${sample.app_number}` });
    console.log(`A#${sample.app_number} -> total:`, r.total, "| rows:", r.items.map((i: any) => `${i.app_number}/${i.candidates?.candidate_number}/${i.jobs?.job_number} ${i.status}`));
  }
  if (sample?.job_number != null) {
    const r = await listApplicationQueue({ ...searchParams, search: `J#${sample.job_number}` });
    console.log(`J#${sample.job_number} -> total:`, r.total, "| rows:", r.items.map((i: any) => `${i.app_number}/${i.candidates?.candidate_number}/${i.jobs?.job_number} ${i.status}`));
  }
  if (sample?.app_number != null) {
    const r = await listApplicationQueue({ ...searchParams, search: String(sample.app_number) });
    console.log(`bare ${sample.app_number} -> total:`, r.total);
  }
  const rEmpty = await listApplicationQueue({ ...searchParams, search: "" });
  console.log("empty search total:", rEmpty.total);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
