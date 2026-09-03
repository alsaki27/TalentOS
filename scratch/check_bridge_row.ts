import { query } from "../src/server/db/neon";
async function main() {
  const ids = ["8737c7bc-5a5d-4ada-b139-9720dbb70e15","ce49430a-e764-428f-b529-0b7a676bb7ed","a7891336-3d62-4715-9816-da85de6ca0c7"];
  for (const brId of ids) {
    const rows = await query<any>(`SELECT id, name, resume_data, updated_at, created_at FROM falood_saved_applications WHERE name = $1`, [`base_resume:${brId}`]);
    console.log(`\n=== bridge rows for base_resume:${brId} ===`, rows.length);
    for (const r of rows) {
      const rd = typeof r.resume_data === "string" ? JSON.parse(r.resume_data) : r.resume_data;
      console.log(`  id=${r.id} created=${r.created_at} updated=${r.updated_at}`);
      console.log(`  customSections in bridge row:`, JSON.stringify(rd?.customSections)?.slice(0, 300));
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
