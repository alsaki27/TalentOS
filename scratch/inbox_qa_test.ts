// Comprehensive, read-only-where-possible QA pass of https://talent.skarion.com/inbox
// against the "TalentOS Email System: End-to-End Testing Guide" (7 sections) using a
// temporary QA staff account. Screenshots + console-error capture at every step.
// Never clicks Approve/Reject/Send on real candidate data - those are flagged as
// "not exercised" in the report rather than risking a real side effect.
//
// Run with: npx tsx scratch/inbox_qa_test.ts

import { chromium, type Page, type ConsoleMessage } from "playwright";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://talent.skarion.com";
const EMAIL = "qa-test-claude@talentos.local";
const PASSWORD = "QaTest_Claude_2026_TempPW!";
const OUT_DIR = "C:\\Users\\iamsh\\AppData\\Local\\Temp\\claude\\c--Shohan-Skarion\\824636f5-7e26-4ece-9df1-dc037f8d73ca\\scratchpad\\inbox_qa_screenshots";
fs.mkdirSync(OUT_DIR, { recursive: true });

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
  try {
    await fn();
    console.log(`  OK`);
  } catch (err: any) {
    console.log(`  FAILED: ${err?.message || err}`);
  }
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text() });
  });
  page.on("pageerror", (err) => consoleErrors.push({ url: page.url(), text: `pageerror: ${err.message}` }));

  await step("Login", async () => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await shot(page, "login_filled");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);
    await shot(page, "post_login");
    console.log(`  landed on: ${page.url()}`);
  });

  await step("Navigate to /inbox", async () => {
    await page.goto(`${BASE_URL}/inbox`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);
    await shot(page, "inbox_initial");
  });

  await step("Section 1: Candidate selector dropdown contents", async () => {
    const select = page.locator("select").first();
    const count = await select.locator("option").count();
    console.log(`  candidate <select> option count: ${count}`);
    const optionsText = await select.locator("option").allTextContents();
    console.log(`  first 15 options: ${JSON.stringify(optionsText.slice(0, 15))}`);
    const connectedCount = optionsText.filter((t) => /connected/i.test(t) || t.includes("🟢")).length;
    console.log(`  options mentioning "connected" or 🟢: ${connectedCount}`);
  });

  let pickedCandidateLabel: string | null = null;
  await step("Section 1: Select a real candidate with connected Gmail if one exists", async () => {
    const select = page.locator("select").first();
    const optionsText = await select.locator("option").allTextContents();
    const connectedIdx = optionsText.findIndex((t) => /connected/i.test(t) || t.includes("🟢"));
    if (connectedIdx > -1) {
      await select.selectOption({ index: connectedIdx });
      pickedCandidateLabel = optionsText[connectedIdx];
      console.log(`  selected: ${pickedCandidateLabel}`);
    } else {
      console.log("  No candidate showed as connected in the dropdown text - selecting option 1 instead.");
      if (optionsText.length > 1) {
        await select.selectOption({ index: 1 });
        pickedCandidateLabel = optionsText[1];
      }
    }
    await page.waitForTimeout(1200);
    await shot(page, "candidate_selected_inbox_tab");
  });

  await step("Section 1: Click through Inbox/Approvals/Drafts/My Handovers tabs", async () => {
    for (const tabName of ["Approvals", "Drafts", "My Handovers", "Inbox"]) {
      const tab = page.getByRole("button", { name: new RegExp(tabName, "i") }).first()
        .or(page.getByRole("link", { name: new RegExp(tabName, "i") }).first())
        .or(page.getByText(new RegExp(`^${tabName}`, "i")).first());
      const visible = await tab.isVisible().catch(() => false);
      console.log(`  tab "${tabName}" visible: ${visible}`);
      if (visible) {
        await tab.click({ timeout: 5000 }).catch((e) => console.log(`    click failed: ${e.message}`));
        await page.waitForTimeout(1000);
        await shot(page, `tab_${tabName.replace(/\s+/g, "_")}`);
      }
    }
  });

  await step("Section 7: Drafts tab label text (checking for [object Object] bug)", async () => {
    const bodyText = await page.locator("body").innerText();
    const hasObjectObject = bodyText.includes("[object Object]");
    console.log(`  page contains literal "[object Object]": ${hasObjectObject}`);
    const draftsMatch = bodyText.match(/Drafts[^\n]{0,20}/);
    console.log(`  Drafts label as rendered: ${draftsMatch ? JSON.stringify(draftsMatch[0]) : "not found"}`);
  });

  await step("Section 7: My Handovers tab loads without a DB relation error", async () => {
    const handoversTab = page.getByText(/My Handovers/i).first();
    if (await handoversTab.isVisible().catch(() => false)) {
      await handoversTab.click();
      await page.waitForTimeout(1200);
      const bodyText = await page.locator("body").innerText();
      const hasDbError = /relation .* does not exist|column .* does not exist|500|Internal Server Error/i.test(bodyText);
      console.log(`  DB/relation error text present: ${hasDbError}`);
      await shot(page, "handovers_tab_detail");
    } else {
      console.log("  My Handovers tab not found/visible.");
    }
  });

  await step("Section 2: Inbox tab - approval-required emails should not appear; Show hidden toggle", async () => {
    const inboxTab = page.getByText(/^Inbox$/i).first();
    if (await inboxTab.isVisible().catch(() => false)) await inboxTab.click();
    await page.waitForTimeout(1000);
    await shot(page, "inbox_tab_default_hidden_off");
    const showHidden = page.getByText(/Show hidden/i).first();
    if (await showHidden.isVisible().catch(() => false)) {
      await showHidden.click();
      await page.waitForTimeout(1000);
      await shot(page, "inbox_tab_show_hidden_on");
    } else {
      console.log("  'Show hidden' control not found.");
    }
  });

  await step("Section 3+4: Approvals tab -> Show Details -> modal body rendering", async () => {
    const approvalsTab = page.getByText(/^Approvals/i).first();
    if (await approvalsTab.isVisible().catch(() => false)) await approvalsTab.click();
    await page.waitForTimeout(1200);
    await shot(page, "approvals_tab_list");
    const showDetails = page.getByText(/Show Details/i).first();
    if (await showDetails.isVisible().catch(() => false)) {
      await showDetails.click();
      await page.waitForTimeout(1200);
      await shot(page, "email_action_modal_details_tab");
      // Scroll within modal to see body text rendering
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      await shot(page, "email_action_modal_scrolled_body");
    } else {
      console.log("  No 'Show Details' button found (likely no pending approvals for this candidate/global view).");
    }
  });

  await step("Section 5: Candidate Name / Job Title links in an approval card (inspect only, no click-through navigation away)", async () => {
    const nameLink = page.locator("a").filter({ hasText: /./ }).first();
    console.log(`  (informational only - see screenshots for link presence/labels)`);
  });

  await step("Section 6: Jobs-style pagination on Inbox tab", async () => {
    const inboxTab = page.getByText(/^Inbox$/i).first();
    if (await inboxTab.isVisible().catch(() => false)) await inboxTab.click();
    await page.waitForTimeout(1000);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(500);
    await shot(page, "inbox_pagination_area");
    const page2 = page.getByText(/^2$/).first();
    if (await page2.isVisible().catch(() => false)) {
      await page2.click();
      await page.waitForTimeout(1000);
      await shot(page, "inbox_pagination_page2");
    } else {
      console.log("  Page '2' button not visible (may not have enough rows, or selector needs adjustment).");
    }
    const goInput = page.locator('input[type="number"], input[placeholder*="Page" i]').first();
    if (await goInput.isVisible().catch(() => false)) {
      await goInput.fill("1");
      const goBtn = page.getByText(/^Go$/).first();
      if (await goBtn.isVisible().catch(() => false)) {
        await goBtn.click();
        await page.waitForTimeout(1000);
        await shot(page, "inbox_pagination_go_page1");
      }
    } else {
      console.log("  Page-jump input not found.");
    }
  });

  await step("Section 6: Jobs-style pagination on Approvals tab", async () => {
    const approvalsTab = page.getByText(/^Approvals/i).first();
    if (await approvalsTab.isVisible().catch(() => false)) await approvalsTab.click();
    await page.waitForTimeout(1000);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(500);
    await shot(page, "approvals_pagination_area");
  });

  console.log("\n\n================ CONSOLE ERRORS CAPTURED ================");
  console.log(JSON.stringify(consoleErrors, null, 2));
  console.log(`\nTotal console errors: ${consoleErrors.length}`);

  await browser.close();
}

main().catch((err) => { console.error("QA script crashed:", err); process.exit(1); });
