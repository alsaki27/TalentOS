// Exercise the actual page/button with intercepted API responses. This fixture
// never starts a production run or calls an AI provider.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import Page from "./src/app/admin/auto-job-logging/client.tsx"; createRoot(document.getElementById("root")).render(React.createElement(Page));', resolveDir: process.cwd(), loader: "jsx" },
  bundle: true, write: false, outdir: "fixture-build", format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-link-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'import React from "react"; export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}', resolveDir: process.cwd(), loader: "js" }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const config = { is_enabled: true, password_configured: true, match_threshold: 30, ai_match_threshold: 30,
  jobs_per_run: 100, ai_calls_per_run: 200, max_applications_per_run: 100, job_freshness_days: 10,
  assigned_by_user_id: "actor-fixture", application_owner_user_id: "actor-fixture", updated_at: "2026-11-04T00:00:00Z" };
let runRequests = 0, readRequests = 0, releaseRun;
let holdRun = true, failRun = false;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://talentos.test") return route.abort();
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: js });
    if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname === "/api/admin/scheduled-job-logging/run") {
      runRequests++;
      assert.equal(route.request().method(), "POST");
      if (holdRun) await new Promise(resolve => { releaseRun = resolve; });
      return route.fulfill({ status: failRun ? 500 : 200, json: failRun ? { error: "Batch storage unavailable" } : {
        ok: true, result: { runId: "run-fixture", status: "partial", jobsSeen: 3, candidatePairsScored: 2, queuedForReview: 2, failedCount: 0, aiCalls: 2 },
      } });
    }
    if (url.pathname === "/api/admin/scheduled-job-logging") {
      assert.equal(route.request().method(), "GET");
      readRequests++;
      return route.fulfill({ json: { locked: false, config, candidates: [], candidateRules: [], recentRuns: [], recentDecisions: [],
        teamMembers: [{ user_id: "actor-fixture", display_name: "Test Manager", role: "manager" }],
        scheduledSources: [{ source: "apify_job_agent", pending_count: 98, latest_ingested_at: "2026-11-04T00:00:00Z" }],
      } });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
  });
  const openActivity = async () => {
    await page.goto("https://talentos.test/admin/auto-job-logging");
    await page.getByRole("tab", { name: /Activity/ }).click();
    await page.getByRole("button", { name: "Run one batch now" }).waitFor();
  };
  await openActivity();
  const button = page.getByRole("button", { name: "Run one batch now" });
  page.once("dialog", dialog => dialog.dismiss());
  await button.click();
  assert.equal(runRequests, 0, "cancel must not start a run");
  const beforeReads = readRequests;
  page.once("dialog", async dialog => {
    assert.match(dialog.message(), /human review/);
    await dialog.accept();
  });
  const request = page.waitForRequest(req => req.url().endsWith("/run") && req.method() === "POST");
  await button.click();
  await request;
  assert.equal(await button.isDisabled(), true, "button must block duplicate clicks while a run is in flight");
  assert.equal(runRequests, 1);
  releaseRun();
  await page.getByText(/3 jobs checked · 2 sent to Stage 2 AI · 2 queued for review/).waitFor();
  assert.ok(readRequests > beforeReads, "counts must refresh without a page reload");
  assert.equal(await button.isEnabled(), true);
  holdRun = false; failRun = true;
  page.once("dialog", dialog => dialog.accept());
  await button.click();
  await page.getByText("Batch storage unavailable", { exact: true }).waitFor();
  assert.equal(await button.isEnabled(), true, "the user must be able to retry after an error");
  config.is_enabled = false;
  await openActivity();
  assert.equal(await button.isDisabled(), true);
  config.is_enabled = true; config.application_owner_user_id = null;
  await openActivity();
  assert.equal(await button.isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("Batch button passed: cancellation, one POST per click, disabled during execution, success counts, background refresh, failure/retry, disabled feature and missing owner. Fixture APIs only.");
} finally { await browser.close(); }
