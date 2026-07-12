// Playwright configuration for TalentOS E2E tests.
// Tests skip gracefully when credentials or BASE_URL are not configured.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  expect: {
    timeout: 10000,
  },
  // Skip all tests if no credentials are available
  forbidOnly: false,
});
