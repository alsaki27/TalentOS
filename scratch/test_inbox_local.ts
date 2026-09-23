// Live browser test against local dev server using provided admin creds.
// npx tsx scratch/test_inbox_local.ts
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const EMAIL = "admin@talentos.local";
const PASSWORD = "AdminPass123!";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 60000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  for (let i = 0; i < 40 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);
  console.log("Logged in, URL:", page.url());

  await page.goto(`${BASE_URL}/inbox`, { waitUntil: "load", timeout: 60000 });

  // Candidate selector should populate within ~10s now.
  const selector = page.locator("select").first();
  let optionCount = 0;
  for (let i = 0; i < 10; i++) {
    optionCount = await selector.locator("option").count();
    if (optionCount > 1) break;
    await page.waitForTimeout(1000);
  }
  console.log("Candidate selector option count:", optionCount);
  const optionTexts = await selector.locator("option").allTextContents();
  console.log("Options sample:", optionTexts.slice(0, 6));

  await page.screenshot({ path: "scratch/inbox_after_load.png", fullPage: false });

  // Try to open the first thread row's action modal, if any.
  const threadRow = page.locator('[class*="thread"], tr, .card').filter({ hasText: /./ }).first();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "scratch/inbox_list_state.png", fullPage: false });

  console.log("Page title:", await page.title());
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
