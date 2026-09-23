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

  const res = await context.request.get(`${BASE_URL}/api/candidate-dashboard`, { timeout: 60000 });
  const data = await res.json();
  console.log("Aggregate dashboard statusCounts:", data.statusCounts);
  console.log("Total:", data.total);
  const sumOfBuckets = Object.values(data.statusCounts as Record<string, number>).reduce((a, b) => a + b, 0);
  console.log("Sum of all buckets:", sumOfBuckets, "(should roughly match total, since every application falls into exactly one bucket)");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
