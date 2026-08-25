// Logs in as the QA account, then calls /api/candidates directly via
// Playwright's request context (shares the session cookie) to see the raw
// response - bypassing whatever the React page does with it.
// npx tsx scratch/probe_candidates_api.ts
import { chromium } from "playwright";

const BASE_URL = "https://talent.skarion.com";
const EMAIL = "qa-test-claude@talentos.local";
const PASSWORD = "QaTest_Claude_2026_TempPW!";

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1000);

  const cookies = await context.cookies();
  console.log("Cookies after login:", cookies.map((c) => c.name));

  const res = await context.request.get(`${BASE_URL}/api/candidates?compact=1&pageSize=500`);
  console.log("\n/api/candidates status:", res.status());
  const bodyText = await res.text();
  console.log("body (first 2000 chars):", bodyText.slice(0, 2000));

  const meRes = await context.request.get(`${BASE_URL}/api/auth/me`);
  console.log("\n/api/auth/me status:", meRes.status());
  console.log("body:", await meRes.text());

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
