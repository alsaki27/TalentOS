import { chromium } from "playwright";
import { queryOne } from "../src/server/db/neon";
const BASE_URL = "http://localhost:3000";

async function main() {
  const cand = await queryOne<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM candidates c WHERE c.name = 'Hija Tovi' LIMIT 1`
  );
  console.log("Candidate:", cand);
  if (!cand) return;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  const res = await context.request.get(`${BASE_URL}/api/candidates/${cand.id}/applications/dashboard`, { timeout: 60000 });
  const data = await res.json();
  console.log("Per-candidate statusCounts:", data.statusCounts);
  console.log("Total:", data.total);

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
