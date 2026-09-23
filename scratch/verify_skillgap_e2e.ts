import { chromium } from "playwright";
import { query } from "../src/server/db/neon";
const BASE_URL = "http://localhost:3000";

async function main() {
  const arv = await query<{ id: string; skill_count: number }>(
    `SELECT arv.id, jsonb_array_length(COALESCE(arv.content->'skills'->'categorized', '[]'::jsonb)) as skill_count
     FROM application_resume_versions arv
     JOIN applications a ON a.id = arv.application_id
     JOIN jobs j ON j.id = a.job_id
     WHERE j.description_text IS NOT NULL AND length(j.description_text) > 500
       AND jsonb_array_length(COALESCE(arv.content->'skills'->'categorized', '[]'::jsonb)) > 0
     ORDER BY arv.created_at DESC LIMIT 1`
  );
  const testId = arv[0]?.id;
  console.log("Testing with application_resume_version id:", testId, "categories:", arv[0]?.skill_count);
  if (!testId) { console.log("No suitable test candidate found."); return; }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") console.log("[console error]", msg.text().slice(0, 200)); });

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  const bridgeRes = await context.request.post(`${BASE_URL}/api/falood/applications/from-source`, {
    data: { source: "application_resume_version", id: testId },
    timeout: 60000,
  });
  const bridgeData = await bridgeRes.json();
  console.log("Bridge:", bridgeRes.status(), bridgeData.id, bridgeData.jobTitle);

  await page.goto(`${BASE_URL}/falood/studio/tailor/${bridgeData.id}?jobTitle=${encodeURIComponent(bridgeData.jobTitle || "")}&company=${encodeURIComponent(bridgeData.companyName || "")}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for the skill-gap suggestion to appear (needs the extract-skills AI call to finish).
  let found = false;
  for (let i = 0; i < 30; i++) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (text.includes("Add missing skill:") || text.includes("skill(s) worth considering") || text.includes("skills worth considering") || text.includes("skill worth considering")) {
      found = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  console.log("\nSkill-gap suggestion appeared in UI:", found);
  await page.screenshot({ path: "scratch/skillgap_e2e_result.png", fullPage: false });

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
