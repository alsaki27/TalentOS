import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  const res = await context.request.get(`${BASE_URL}/api/gmail-communications/68fb5c52-ad86-4f90-a663-44720b81b729`, { timeout: 30000 });
  const data = await res.json();
  console.log("Status:", res.status());
  console.log("job_id:", data.message?.job_id);
  console.log("job_title/company:", data.message?.job_title, "/", data.message?.company_name);
  console.log("resume_version_id:", data.message?.resume_version_id);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
