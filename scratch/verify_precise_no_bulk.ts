import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
const SESSION_ID = "d15868bd-99d1-4c48-b9d0-1eceb127b376";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  await page.goto(`${BASE_URL}/falood/studio/tailor/${SESSION_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for either the skill-gap suggestion or settle time to pass.
  for (let i = 0; i < 40; i++) {
    const badge = await page.locator("text=/\d+ pending/").first().textContent().catch(() => null);
    if (badge) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);

  const pendingBadge = await page.locator("text=/\d+ pending/").first().textContent().catch(() => "none");
  const rejectButtonCount = await page.getByRole("button", { name: "Reject" }).count();
  const acceptChangeButtonCount = await page.getByRole("button", { name: "Accept Change" }).count();
  const addMissingSkillCount = await page.locator("text=/Add missing skill:/").count();
  const consolidateCount = await page.locator("text=/Consolidate/").count();

  console.log("Pending badge:", pendingBadge);
  console.log("Reject buttons (= real suggestion cards):", rejectButtonCount);
  console.log("Accept Change buttons:", acceptChangeButtonCount);
  console.log("'Add missing skill:' suggestion cards:", addMissingSkillCount);
  console.log("'Consolidate' (bulk experience edit) cards:", consolidateCount);

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
