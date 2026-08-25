import { chromium } from "playwright";
import { queryOne } from "../src/server/db/neon";

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

  for (const qs of ["direction=inbox", "direction=inbox&relevant=true", "direction=inbox&clearanceOnly=true", "direction=inbox&relevant=true&clearanceOnly=true"]) {
    const res = await context.request.get(`${BASE_URL}/api/gmail-communications?${qs}`, { timeout: 40000 });
    const body = await res.text();
    if (res.ok()) console.log(`${qs} -> total=${JSON.parse(body).total}`);
    else console.log(`${qs} -> HTTP ${res.status()}: ${body.slice(0, 300)}`);
  }

  const msg = await queryOne<{ id: string }>(
    `SELECT id FROM email_communications WHERE gmail_thread_id = $1 LIMIT 1`,
    ["1a01e7903b9181d6"]
  );
  console.log("\nMessage row for thread 1a01e7903b9181d6:", msg?.id ?? "NOT FOUND");
  if (msg) {
    const res = await context.request.get(`${BASE_URL}/api/gmail-communications/${msg.id}`, { timeout: 40000 });
    const data = await res.json();
    console.log("Detail fetch:", res.status());
    console.log("  ai_matched_application_id:", data.message?.ai_matched_application_id);
    console.log("  resume_version_id:", data.message?.resume_version_id);
    console.log("  portal_token:", data.message?.portal_token ? "present" : "MISSING");
    console.log("  job_title/company:", data.message?.job_title, "/", data.message?.company_name);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
