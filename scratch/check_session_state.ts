import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(
    `SELECT chat_history, resume_data FROM falood_saved_applications WHERE id = $1`,
    ["d52b3d65-2ef6-47d9-b597-f8796869d069"]
  );
  const row = rows[0];
  if (!row) { console.log("Session not found."); return; }
  const chatHistory = typeof row.chat_history === "string" ? JSON.parse(row.chat_history) : row.chat_history;
  const marker = chatHistory.find((m: any) => m.id === "skill-gap-intro");
  console.log("Marker exists:", Boolean(marker));
  if (marker) {
    console.log("Suggestions count:", marker.suggestions?.length);
    marker.suggestions?.forEach((s: any) => console.log(" -", s.suggested, "| status:", s.status));
    console.log("Remaining queue:", marker.remainingSkillQueue);
  }
  const resumeData = typeof row.resume_data === "string" ? JSON.parse(row.resume_data) : row.resume_data;
  const categorized = resumeData?.skills?.categorized ?? [];
  const allSkills = categorized.flatMap((c: any) => c.skills);
  console.log("\nCurrent resume skills include 'Sheet Metal Design':", allSkills.includes("Sheet Metal Design"));
}
main().catch((e) => { console.error(e); process.exit(1); });
