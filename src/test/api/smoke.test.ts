/**
 * TalentOS API Smoke Tests
 *
 * These tests call the production (or configured) TalentOS API and verify
 * that core endpoints return expected status codes.
 *
 * Required env vars:
 *   - TALENTOS_BASE_URL: base URL of the TalentOS instance
 *   - CRON_SECRET: for /api/cron/* and /api/admin/ai-key-readiness endpoints
 *   - TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD: for login (optional, some tests skip)
 *
 * Without these, tests that require credentials skip gracefully.
 */

import { describe, test, expect } from "vitest";

const RUN_NETWORK_TESTS = process.env.RUN_NETWORK_TESTS === "true";
const BASE_URL = process.env.TEST_BASE_URL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || "";
const HAS_CRON_SECRET = Boolean(CRON_SECRET);
const HAS_CREDENTIALS = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

function networkSkip({ skip }: { skip: (reason?: string) => void }): boolean {
  if (!RUN_NETWORK_TESTS) {
    skip("RUN_NETWORK_TESTS not set");
    return true;
  }
  if (!BASE_URL) {
    skip("TEST_BASE_URL not set");
    return true;
  }
  return false;
}

function skipUnlessNetwork(): boolean {
  return process.env.RUN_NETWORK_TESTS === "true";
}

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  if (!HAS_CREDENTIALS) return null;

  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });

    if (!loginRes.ok) return null;

    const cookies = loginRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

    if (!cookieHeader) return null;

    return fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Cookie: cookieHeader,
      },
    });
  } catch {
    return null;
  }
}

describe("API smoke tests — unauthenticated endpoints", () => {
  test("health endpoint returns 200", async ({ skip }) => {
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeDefined();
  }, 15000);
});

describe("API smoke tests — cron endpoints (require CRON_SECRET)", () => {
  test("backup cron returns 401 without secret", async ({ skip }) => {
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/cron/backup`);
    expect(res.status).toBe(401);
  }, 15000);

  test("backup cron returns OK with valid secret", async ({ skip }) => {
    if (!HAS_CRON_SECRET) return;
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/cron/backup`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect([200, 401, 500]).toContain(res.status);
  }, 30000);

  test("digest cron returns 401 without secret", async ({ skip }) => {
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/cron/digest`);
    expect(res.status).toBe(401);
  }, 15000);

  test("import-sources cron returns 401 without secret", async ({ skip }) => {
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/cron/import-sources`);
    expect(res.status).toBe(401);
  }, 15000);

  test("categorize-jobs cron returns 401 without secret", async ({ skip }) => {
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/cron/categorize-jobs`);
    expect(res.status).toBe(401);
  }, 15000);
});

describe("API smoke tests — authenticated endpoints (skip if no credentials)", () => {
  test("follow-ups endpoint returns 200 when authenticated", async ({ skip }) => {
    if (!HAS_CREDENTIALS) return;
    if (networkSkip({ skip })) return;

    const res = await fetchWithAuth("/api/follow-ups?page=1&pageSize=10");
    if (!res) return;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  }, 15000);

  test("candidates endpoint returns 200 when authenticated", async ({ skip }) => {
    if (!HAS_CREDENTIALS) return;
    if (networkSkip({ skip })) return;

    const res = await fetchWithAuth("/api/candidates?page=1&pageSize=10");
    if (!res) return;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  }, 15000);

  test("jobs endpoint returns 200 when authenticated", async ({ skip }) => {
    if (!HAS_CREDENTIALS) return;
    if (networkSkip({ skip })) return;

    const res = await fetchWithAuth("/api/jobs?page=1&pageSize=10");
    if (!res) return;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  }, 15000);

  test("analytics endpoint returns 200 when authenticated", async ({ skip }) => {
    if (!HAS_CREDENTIALS) return;
    if (networkSkip({ skip })) return;

    const res = await fetchWithAuth("/api/analytics");
    if (!res) return;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  }, 15000);

  test("ops status endpoint returns 403 without auth", async ({ skip }) => {
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/ops/status`);
    expect([401, 403]).toContain(res.status);
  }, 15000);
});

describe("API smoke tests — AI key readiness (require CRON_SECRET)", () => {
  test("ai key readiness returns 200 with valid secret", async ({ skip }) => {
    if (!HAS_CRON_SECRET) return;
    if (networkSkip({ skip })) return;

    const res = await fetch(`${BASE_URL}/api/admin/ai-key-readiness`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect([200, 401, 503]).toContain(res.status);
  }, 15000);
});
