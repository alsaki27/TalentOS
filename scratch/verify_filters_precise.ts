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

  for (const qs of ["direction=inbox&relevant=true", "direction=inbox&relevant=true&clearanceOnly=true", "direction=inbox"]) {
    const res = await context.request.get(`${BASE_URL}/api/gmail-communications?${qs}`, { timeout: 40000 });
    const body: any = await res.json().catch(() => ({}));
    console.log(`${qs} -> HTTP ${res.status()} total=${body.total}`);
  }

  const byThreadId = await context.request.get(`${BASE_URL}/api/gmail-communications?direction=inbox&search=1a01e7903b9181d6`, { timeout: 40000 });
  const btBody: any = await byThreadId.json().catch(() => ({}));
  console.log("search by gmail_thread_id -> total:", btBody.total, "first id:", btBody.threads?.[0]?.id);

  if (btBody.threads?.[0]?.id) {
    const detail = await context.request.get(`${BASE_URL}/api/gmail-communications/${btBody.threads[0].id}`, { timeout: 40000 });
    const d: any = await detail.json();
    console.log("\nDetail check for that exact thread:");
    console.log("  ai_matched_application_id:", d.message?.ai_matched_application_id);
    console.log("  resume_version_id:", d.message?.resume_version_id);
    console.log("  portal_token present:", Boolean(d.message?.portal_token));
    if (d.message?.ai_matched_application_id) {
      const appCheck = await context.request.get(`${BASE_URL}/applications/${d.message.ai_matched_application_id}`, { timeout: 40000 });
      console.log("  /applications/[id] page status:", appCheck.status());
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
