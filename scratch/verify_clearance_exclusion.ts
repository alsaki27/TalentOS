import { chromium } from "playwright";
import { query } from "../src/server/db/neon";

const BASE_URL = "http://localhost:3000";
const KEYWORDS = [
  "%security clearance%", "%secret clearance%", "%top secret%", "%ts/sci%",
  "%ts-sci%", "%public trust%", "%dod clearance%", "%government clearance%",
  "%clearance required%", "%clearance eligib%", "%active clearance%",
  "%federal government%", "%federal agency%", "%u.s. citizen%", "%us citizen%",
];

async function main() {
  const groundTruth = await query<{ id: string; title: string }>(
    `SELECT id, title FROM jobs WHERE title ILIKE ANY($1) OR description_text ILIKE ANY($1) OR description_html ILIKE ANY($1)`,
    [KEYWORDS]
  );
  console.log(`Ground truth: ${groundTruth.length} real jobs match clearance keywords.`);
  groundTruth.slice(0, 5).forEach((j) => console.log(`  - ${j.title}`));

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  for (const qs of ["direction=inbox&relevant=true", "direction=inbox"]) {
    const res = await context.request.get(`${BASE_URL}/api/gmail-communications?${qs}&pageSize=100`, { timeout: 30000 });
    const data = await res.json();
    const clearanceMatches = (data.threads ?? []).filter((t: any) =>
      groundTruth.some((j) => j.title === t.job_title)
    );
    console.log(`\n${qs} -> HTTP ${res.status()}, total=${data.total}, threads returned=${data.threads?.length}, clearance-job threads leaked through=${clearanceMatches.length}`);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
