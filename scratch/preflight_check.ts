import { query } from "../src/server/db/neon";
async function main() {
  const cols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='candidate_source_of_truth' ORDER BY 1`);
  console.log("candidate_source_of_truth cols:", cols.map((r: any) => r.column_name));
  const pktCols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='application_packets' ORDER BY 1`);
  console.log("application_packets cols:", pktCols.map((r: any) => r.column_name));
  const arvCols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='application_resume_versions' ORDER BY 1`);
  console.log("application_resume_versions cols:", arvCols.map((r: any) => r.column_name));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
