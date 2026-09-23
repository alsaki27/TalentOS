import { chromium } from "playwright";
import { query } from "../src/server/db/neon";
const BASE_URL = "http://localhost:3000";

async function main() {
  const arv = await query<{ id: string }>(
    `SELECT arv.id
     FROM application_resume_versions arv
     JOIN applications a ON a.id = arv.application_id
     JOIN jobs j ON j.id = a.job_id
     WHERE j.description_text IS NOT NULL AND length(j.description_text) > 500
       AND jsonb_array_length(COALESCE(arv.content->'skills'->'categorized', '[]'::jsonb)) > 0
     ORDER BY arv.created_at DESC OFFSET 1 LIMIT 1`
  );
  const testId = arv[0]?.id;
  console.log("Testing with application_resume_version id:", testId);
  if (!testId) return;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

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
  console.log("Bridge:", bridgeRes.status(), bridgeData.id);

  await page.goto(`${BASE_URL}/falood/studio/tailor/${bridgeData.id}?jobTitle=${encodeURIComponent(bridgeData.jobTitle || "")}&company=${encodeURIComponent(bridgeData.companyName || "")}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  let text = "";
  for (let i = 0; i < 40; i++) {
    text = await page.locator("body").innerText().catch(() => "");
    if (/Add missing skill|pending/i.test(text)) break;
    await page.waitForTimeout(2000);
  }

  const pendingMatch = text.match(/(\d+)\s*pending/i);
  console.log("Pending count shown:", pendingMatch ? pendingMatch[1] : "not found");
  console.log("Has 'Accept all' button:", /Accept all/i.test(text));
  console.log("Has 'Consolidate' (experience-type suggestion):", /Consolidate/i.test(text));
  console.log("Has 'EXPERIENCE' badge:", /\bEXPERIENCE\b/.test(text));
  console.log("Has 'Add missing skill':", /Add missing skill/i.test(text));

  await page.screenshot({ path: "scratch/no_bulk_verify.png" });
  await browser.close();

  console.log("\nSession id for cleanup:", bridgeData.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
