import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
const SESSION_ID = "d52b3d65-2ef6-47d9-b597-f8796869d069";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  await page.goto(`${BASE_URL}/falood/studio/tailor/${SESSION_ID}?jobTitle=CAD&company=ACT`, { waitUntil: "domcontentloaded", timeout: 60000 });

  for (let i = 0; i < 40; i++) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (/Add missing skill/i.test(text)) break;
    await page.waitForTimeout(2000);
  }

  const pendingBadgeBefore = await page.locator("text=/\d+ pending/").first().textContent().catch(() => "?");
  console.log("Pending badge before accept:", pendingBadgeBefore);

  await page.getByRole("button", { name: "Accept" }).first().click();
  await page.waitForTimeout(3000);

  const bodyAfter = await page.locator("body").innerText();
  const skillMatches = bodyAfter.match(/Add missing skill: [^\n]+/g) ?? [];
  console.log("\n'Add missing skill' lines visible after accept:", skillMatches);

  const pendingBadgeAfter = await page.locator("text=/\d+ pending/").first().textContent().catch(() => "?");
  console.log("Pending badge after accept:", pendingBadgeAfter);

  const resumeHasNewSkill = bodyAfter.includes("Sheet Metal Design");
  console.log("Resume preview now shows 'Sheet Metal Design':", resumeHasNewSkill);

  await page.screenshot({ path: "scratch/skillgap_after_accept.png" });
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
