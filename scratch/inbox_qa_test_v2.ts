// Follow-up, more patient pass: avoids networkidle (the page polls
// continuously, so networkidle never settles - a test-methodology issue in
// v1, not an app bug), waits explicitly for real content, and targets
// candidate 8966dfa1-356d-42e1-8fd3-1349a5098aee (Avirup Bhattacharjee) -
// confirmed via direct DB query to have both Gmail connected AND a real
// pending status_change_approval, making it the single best real-data
// candidate for exercising Approvals/Show Details/pagination.
//
// Run with: npx tsx scratch/inbox_qa_test_v2.ts

import { chromium, type Page, type ConsoleMessage } from "playwright";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://talent.skarion.com";
const EMAIL = "qa-test-claude@talentos.local";
const PASSWORD = "QaTest_Claude_2026_TempPW!";
const OUT_DIR = "C:\\Users\\iamsh\\AppData\\Local\\Temp\\claude\\c--Shohan-Skarion\\824636f5-7e26-4ece-9df1-dc037f8d73ca\\scratchpad\\inbox_qa_screenshots_v2";
fs.mkdirSync(OUT_DIR, { recursive: true });
const TARGET_CANDIDATE_ID = "8966dfa1-356d-42e1-8fd3-1349a5098aee"; // Avirup Bhattacharjee

let shotIndex = 0;
async function shot(page: Page, name: string) {
  shotIndex += 1;
  const file = path.join(OUT_DIR, `${String(shotIndex).padStart(2, "0")}_${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  [screenshot] ${file}`);
}
const consoleErrors: { url: string; text: string }[] = [];
async function step(label: string, fn: () => Promise<void>) {
  console.log(`\n=== ${label} ===`);
  try { await fn(); console.log(`  OK`); }
  catch (err: any) { console.log(`  FAILED: ${err?.message || err}`); }
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("console", (msg: ConsoleMessage) => { if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text() }); });
  page.on("pageerror", (err) => consoleErrors.push({ url: page.url(), text: `pageerror: ${err.message}` }));
  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().includes("/api/")) {
      console.log(`  [HTTP ${res.status()}] ${res.url()}`);
    }
  });

  await step("Login", async () => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1000);
  });

  await step("Navigate to /inbox with a real candidateId, wait for candidates to populate", async () => {
    await page.goto(`${BASE_URL}/inbox?candidateId=${TARGET_CANDIDATE_ID}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Wait for the candidate <select>(s) to have more than the placeholder option
    await page.waitForFunction(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      return selects.some((s) => s.options.length > 1);
    }, { timeout: 15000 }).catch((e) => console.log(`  waitForFunction (candidates populated) did not resolve: ${e.message}`));
    await page.waitForTimeout(1500);
    await shot(page, "inbox_with_candidate_param");
  });

  await step("Report all <select> elements and their option counts/text", async () => {
    const selects = page.locator("select");
    const n = await selects.count();
    console.log(`  select count on page: ${n}`);
    for (let i = 0; i < n; i++) {
      const opts = await selects.nth(i).locator("option").allTextContents();
      console.log(`  select[${i}] (${opts.length} options): ${JSON.stringify(opts.slice(0, 8))}`);
    }
  });

  await step("Wait for 'Loading mailbox...' to disappear and check conversation count", async () => {
    await page.waitForFunction(() => !document.body.innerText.includes("Loading mailbox"), { timeout: 15000 }).catch((e) => console.log(`  still loading after 15s: ${e.message}`));
    await page.waitForTimeout(1000);
    const bodyText = await page.locator("body").innerText();
    const convMatch = bodyText.match(/(\d+)\s+conversations?/i);
    console.log(`  conversations count text: ${convMatch ? convMatch[0] : "not found"}`);
    await shot(page, "inbox_after_loading_resolved");
  });

  await step("Click Approvals tab for this candidate and look for real pending card + Show Details", async () => {
    const approvalsTab = page.getByText(/^Approvals\b/).first();
    if (await approvalsTab.isVisible().catch(() => false)) {
      await approvalsTab.click();
      await page.waitForTimeout(1500);
      await shot(page, "approvals_tab_real_candidate");
      const bodyText = await page.locator("body").innerText();
      console.log(`  Approvals tab body text (first 500 chars): ${JSON.stringify(bodyText.slice(0, 500))}`);
      const showDetails = page.getByText(/Show Details/i).first();
      if (await showDetails.isVisible().catch(() => false)) {
        await showDetails.click();
        await page.waitForTimeout(1500);
        await shot(page, "email_action_modal_real_data");
        const modalText = await page.locator("body").innerText();
        console.log(`  Modal visible text length: ${modalText.length}`);
      } else {
        console.log("  'Show Details' still not found even for the targeted candidate.");
      }
    } else {
      console.log("  Approvals tab element not found via text selector - checking page structure.");
      const allButtons = await page.locator("button, a").allTextContents();
      console.log(`  all button/link texts on page: ${JSON.stringify(allButtons.filter(t => t.trim()).slice(0, 40))}`);
    }
  });

  console.log("\n\n================ 4xx/5xx API RESPONSES + CONSOLE ERRORS ================");
  console.log(JSON.stringify(consoleErrors, null, 2));

  await browser.close();
}

main().catch((err) => { console.error("QA v2 script crashed:", err); process.exit(1); });
