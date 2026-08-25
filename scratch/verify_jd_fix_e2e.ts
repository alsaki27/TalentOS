import { chromium } from "playwright";
import { query } from "../src/server/db/neon";
const BASE_URL = "http://localhost:3000";
async function main() {
  const arv = await query<{ id: string }>(
    `SELECT arv.id FROM application_resume_versions arv
     JOIN applications a ON a.id = arv.application_id
     JOIN jobs j ON j.id = a.job_id
     WHERE j.description_text IS NOT NULL AND length(j.description_text) > 200
     ORDER BY arv.created_at DESC LIMIT 1`
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

  const res = await context.request.post(`${BASE_URL}/api/falood/applications/from-source`, {
    data: { source: "application_resume_version", id: testId },
    timeout: 90000,
  });
  const data = await res.json();
  console.log("Bridge status:", res.status(), "| id:", data.id);

  const stored = await query<{ job_description: string | null }>(
    `SELECT job_description FROM falood_saved_applications WHERE id = $1`, [data.id]
  );
  console.log("Stored job_description length:", stored[0]?.job_description?.length ?? 0);
  console.log("First 200 chars:", JSON.stringify(stored[0]?.job_description?.slice(0, 200)));

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
