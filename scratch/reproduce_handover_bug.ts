import { chromium } from "playwright";
import { queryOne } from "../src/server/db/neon";

const BASE_URL = "http://localhost:3000";

async function main() {
  const email = await queryOne<{ id: string; subject: string }>(
    `SELECT id, subject FROM email_communications ORDER BY sent_at DESC LIMIT 1`
  );
  const profile = await queryOne<{ user_id: string; email: string }>(
    `SELECT user_id, email FROM profiles WHERE is_active = true LIMIT 1`
  );
  console.log("Test email_communication_id:", email?.id, "|", email?.subject);
  console.log("Test assignee_user_id:", profile?.user_id, "|", profile?.email);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  const res = await context.request.post(`${BASE_URL}/api/inbox/handover`, {
    data: {
      email_communication_id: email!.id,
      assignee_user_id: profile!.user_id,
      note: "test handover note",
      priority: "normal",
    },
    timeout: 30000,
  });
  console.log("\nStatus:", res.status());
  console.log("Body:", await res.text());

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
