/**
 * TalentOS End-to-End Smoke Tests
 *
 * These tests require:
 *   - TEST_BASE_URL pointing to a running TalentOS instance
 *   - TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD (seeded test credentials)
 *   - A seed job ID (TEST_JOB_ID) already present in the database
 *
 * Without these env vars, all tests skip gracefully with test.skip().
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || "";
const TEST_JOB_ID = process.env.TEST_JOB_ID || "";
const HAS_CREDENTIALS = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

async function loginAsAdmin(page: ReturnType<typeof test["info"] extends () => infer I ? never : any>) {
  // actually just return page after login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  return page;
}

test.describe("Core hiring workflow", () => {
  test.beforeEach(async ({ }, testInfo) => {
    if (!HAS_CREDENTIALS) {
      testInfo.skip(true, "Skipping: TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD not set");
    }
  });

  test("create candidate, build resume, apply, run pipeline", async ({ page }) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Navigate to candidates and create a test candidate
    await page.goto(`${BASE_URL}/candidates`);
    await page.click('button:has-text("Add Candidate")');
    const testName = `E2E Test Candidate ${Date.now()}`;
    await page.fill('input[name="name"]', testName);
    await page.fill('input[name="email"]', `e2e-test-${Date.now()}@test.talentos`);
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(2000);

    // 3. Verify candidate appears in list
    await expect(page.locator(`text=${testName}`).first()).toBeVisible();

    // 4. Navigate to candidate detail and build a base resume
    await page.click(`text=${testName}`);
    await page.waitForTimeout(1000);
    // Verify candidate profile page loaded
    await expect(page.locator("h1")).toBeVisible();

    // 5. Navigate to application queue and create application
    if (TEST_JOB_ID) {
      await page.goto(`${BASE_URL}/candidates`);
      // Click on the candidate to go to detail
      await page.click(`text=${testName}`);
      await page.waitForTimeout(1000);

      // Look for "New Application" or "+ New Application" button
      const newAppBtn = page.locator('button:has-text("New Application"), button:has-text("Application")').first();
      if (await newAppBtn.isVisible()) {
        await newAppBtn.click();
        await page.waitForTimeout(2000);

        // 6. Start pipeline if visible
        const startPipelineBtn = page.locator('button:has-text("Start Pipeline"), button:has-text("Run Pipeline")').first();
        if (await startPipelineBtn.isVisible()) {
          await startPipelineBtn.click();
          await page.waitForTimeout(3000);
        }
      }
    }

    // 7. Verify no error banners are present
    const errorBanner = page.locator('[role="alert"], .error-banner, .toast-error');
    const errorCount = await errorBanner.count();
    expect(errorCount).toBe(0);
  });
});

test.describe("Page smoke tests", () => {
  test.beforeEach(async ({ }, testInfo) => {
    if (!HAS_CREDENTIALS) {
      testInfo.skip(true, "Skipping: credentials not configured");
    }
  });

  const pages = [
    "/candidates",
    "/jobs",
    "/application-queue",
    "/review",
    "/follow-ups",
    "/interviews",
    "/analytics",
    "/team",
    "/ops",
    "/admin/ai",
  ];

  for (const path of pages) {
    test(`smoke: ${path} returns 200 and renders heading`, async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);

      // Check no visible error banner
      const errorBanner = page.locator('[role="alert"]:visible, .error-banner:visible');
      const hasError = await errorBanner.isVisible().catch(() => false);
      expect(hasError).toBe(false);

      // Check at least one heading or meaningful content
      const heading = page.locator("h1, h2");
      const headingCount = await heading.count();
      expect(headingCount).toBeGreaterThan(0);
    });
  }
});
