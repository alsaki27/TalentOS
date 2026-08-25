import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("response", async (res) => {
    if (res.url().includes("/api/") && res.request().method() === "POST") {
      console.log("POST", res.url(), "->", res.status());
      try { console.log("  body:", (await res.text()).slice(0, 300)); } catch {}
    }
  });
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(500);
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log("Final URL:", page.url());
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
