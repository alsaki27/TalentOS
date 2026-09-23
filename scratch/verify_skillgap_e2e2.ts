import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
const SESSION_ID = "d52b3d65-2ef6-47d9-b597-f8796869d069";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("requestfinished", (req) => {
    if (req.url().includes("/api/falood/")) console.log("[net]", req.method(), req.url());
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/falood/skill-gap")) {
      console.log("[skill-gap response]", res.status(), (await res.text().catch(() => "")).slice(0, 300));
    }
  });

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  await page.goto(`${BASE_URL}/falood/studio/tailor/${SESSION_ID}?jobTitle=CAD&company=ACT`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("URL after goto:", page.url());
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "scratch/skillgap_e2e2_initial.png" });

  for (let i = 0; i < 40; i++) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (/Add missing skill|worth considering/i.test(text)) {
      console.log(`Found at ${i * 2}s`);
      await page.screenshot({ path: "scratch/skillgap_e2e2_found.png" });
      await browser.close();
      return;
    }
    await page.waitForTimeout(2000);
  }
  console.log("Not found after 80s of polling.");
  await page.screenshot({ path: "scratch/skillgap_e2e2_timeout.png" });
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
