import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("[page error]", err.message.slice(0, 200)));

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);
  console.log("1. Login ->", page.url());

  await page.goto(`${BASE_URL}/inbox`, { waitUntil: "load", timeout: 90000 });
  const gmailSelect = page.locator("select").filter({ has: page.locator('option:has-text("Select client candidate")') });
  let optCount = 0;
  for (let i = 0; i < 30; i++) {
    optCount = await gmailSelect.locator("option").count();
    if (optCount > 1) break;
    await page.waitForTimeout(1000);
  }
  console.log(`2. Candidate selector: ${optCount} options after wait`);
  const connectedOpt = (await gmailSelect.locator("option").allTextContents()).find((t) => t.includes("Connected"));
  console.log("   Connected candidate found:", connectedOpt || "none");

  // Clearance filter toggle
  const clearanceBox = page.locator('label:has-text("Federal / clearance")').locator("input[type=checkbox]");
  const totalBefore = await page.locator("text=/\\d+ conversations/").first().textContent().catch(() => null);
  await clearanceBox.check();
  await page.waitForTimeout(2500);
  const totalAfter = await page.locator("text=/\\d+ conversations/").first().textContent().catch(() => null);
  console.log(`3. Clearance filter: before="${totalBefore}" after="${totalAfter}"`);
  await clearanceBox.uncheck();
  await page.waitForTimeout(1500);

  // Open the exact thread from the user's screenshot via Gmail Thread ID search if present, else first row.
  const searchBox = page.locator('input[placeholder*="Gmail Thread ID" i]');
  if (await searchBox.count()) {
    await searchBox.fill("1a01e7903b9181d6");
    await page.waitForTimeout(2000);
  }
  const row = page.locator('text=Indeed Application: Software Engineer').first();
  const rowExists = await row.count();
  console.log("4. Target thread row found:", rowExists > 0);
  if (rowExists) {
    await row.click();
    await page.waitForTimeout(2500);
    const linkedApp = page.locator('text=Linked application:').locator("..").locator("a");
    const tailoredResume = page.locator('text=Tailored resume:').locator("..");
    const portal = page.locator('text=Portal shows:').locator("..");
    console.log("   Linked application href:", await linkedApp.first().getAttribute("href").catch(() => "N/A"));
    console.log("   Tailored resume area text:", (await tailoredResume.first().textContent().catch(() => ""))?.slice(0, 80));
    console.log("   Portal area text:", (await portal.first().textContent().catch(() => ""))?.slice(0, 120));
    const portalLink = portal.locator("a");
    console.log("   Portal href:", await portalLink.first().getAttribute("href").catch(() => "N/A"));
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
