// Real review page, synthetic APIs, and a controlled browser clock only.
// Every request is intercepted; no server, credentials, production writes, or AI.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const candidate = "11111111-1111-4111-8111-111111111111";
const otherCandidate = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const endpoint = "/api/admin/candidate-job-review";
const base = {
  source: "extension", candidate_id: candidate, candidate_name: "Fixture Candidate",
  job_id: "fixture-job", job_title: "Fixture Engineer", company: "Fixture Company",
  apply_url: null, base_resume_id: "base", base_resume_name: "Main resume",
  alternate_resumes: [{ resumeId: "alternate", resumeName: "Alternate evidence", score: 78 }],
  ats_score: 81, ai_status: "failed", ai_tier: null, ai_score: null,
  ai_reason: null, ai_failure_reason: "Temporary fixture failure", hard_gates: [],
  status: "pending", priority: "default", assigned_to_user_id: owner, assigned_to_name: "Fixture Owner",
  reviewed_by_name: null, reviewed_at: null, review_note: null, application_id: null,
  created_at: "2026-11-04T02:00:00Z",
};
let rows = [
  { ...base, id: "first", ai_status: "scored", ai_tier: "strong", ai_score: 89 },
  { ...base, id: "retry" },
  { ...base, id: "watched", ai_status: "pending", ai_failure_reason: null },
  { ...base, id: "last" },
];
const filterOptions = {
  candidates: [{ id: candidate, name: "Fixture Candidate" }, { id: otherCandidate, name: "Empty Candidate" }],
  staff: [{ id: owner, name: "Fixture Owner", role: "admin" }],
};

const bundle = await build({
  stdin: {
    contents: 'import React from "react";import{createRoot}from"react-dom/client";import"./src/app/globals.css";import Page from"./src/app/candidate-job-review/page.tsx";let root;window.mountReviewFixture=()=>{root=createRoot(document.getElementById("root"));root.render(React.createElement(Page))};window.unmountReviewFixture=()=>root.unmount();window.mountReviewFixture();',
    resolveDir: process.cwd(), loader: "jsx",
  },
  bundle: true, write: false, outdir: "fixture-build", platform: "browser",
  format: "iife", jsx: "automatic", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-link-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: 'import React from"react";export default function Link({href,children,...p}){return React.createElement("a",{href,...p},children)}',
      loader: "js", resolveDir: process.cwd(),
    }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const rawCss = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const { css } = await postcss([tailwindcss({ content: [{ raw: script, extension: "js" }] })]).process(rawCss, { from: undefined });

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ timezoneId: "Asia/Dhaka", reducedMotion: "reduce" });
  const reads = [], mutations = [], errors = [], unexpected = [];
  let nextRead = null, nextMutation = null, failRead = false, failMutation = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-11-04T06:00:00Z") });
  await page.addInitScript(() => {
    // Explicitly model tab visibility: headless tabs are otherwise always visible.
    window.fixtureVisibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.fixtureVisibility });
    window.fixtureFetches = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => {
      const entry = { url: String(url), method: options.method || "GET", aborted: false, settled: false };
      window.fixtureFetches.push(entry);
      options.signal?.addEventListener("abort", () => { entry.aborted = true; });
      // One read can deliberately ignore transport cancellation to prove that a
      // late response cannot overwrite a newer filter/action response.
      if (window.ignoreNextAbort && entry.method === "GET") {
        window.ignoreNextAbort = false;
        options = { ...options, signal: undefined };
      }
      return originalFetch(url, options).finally(() => { entry.settled = true; });
    };
    window.fixtureListeners = { focus: new Set(), visibilitychange: new Set() };
    for (const [target, type] of [[window, "focus"], [document, "visibilitychange"]]) {
      const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
      target.addEventListener = (event, callback, ...rest) => {
        if (event === type) window.fixtureListeners[type].add(callback);
        return add(event, callback, ...rest);
      };
      target.removeEventListener = (event, callback, ...rest) => {
        if (event === type) window.fixtureListeners[type].delete(callback);
        return remove(event, callback, ...rest);
      };
    }
  });

  function payload(params) {
    const filtered = rows.filter(item => (!params.get("candidate_id") || item.candidate_id === params.get("candidate_id"))
      && (!params.get("staff_id") || item.assigned_to_user_id === params.get("staff_id"))
      && (params.get("source") === "all" || item.source === params.get("source"))
      && (params.get("tier") === "all" || (params.get("tier") === "unscored" ? item.ai_status !== "scored" : item.ai_tier === params.get("tier")))
      && (!params.get("start") || Date.parse(item.created_at) >= Date.parse(params.get("start")))
      && (!params.get("end") || Date.parse(item.created_at) <= Date.parse(params.get("end"))));
    const counts = { pending: 0, approved: 0, rejected: 0 }, pendingTiers = { strong: 0, adjacent: 0, stretch: 0 };
    for (const item of filtered) {
      counts[item.status]++;
      if (item.status === "pending" && item.ai_tier) pendingTiers[item.ai_tier]++;
    }
    const matching = filtered.filter(item => params.get("status") === "all" || item.status === params.get("status"));
    const currentPage = Number(params.get("page")), pageSize = 2;
    return structuredClone({ items: matching.slice((currentPage - 1) * pageSize, currentPage * pageSize), counts,
      pendingTiers, filterOptions, pagination: { page: currentPage, pageSize, total: matching.length } });
  }

  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== "https://talentos.test") { unexpected.push(request.url()); return route.abort(); }
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname === endpoint && request.method() === "GET") {
      const gate = nextRead; nextRead = null;
      const json = failRead ? { error: "Fixture refresh failure" } : payload(url.searchParams);
      const status = failRead ? 503 : 200;
      reads.push({ params: Object.fromEntries(url.searchParams), json });
      if (gate) await gate.promise;
      return route.fulfill({ status, json });
    }
    if (url.pathname.startsWith(endpoint + "/") && request.method() === "POST") {
      const action = url.pathname.split("/").at(-1), id = url.pathname.split("/").at(-2);
      if (!["retry-ai", "approve", "reject", "bulk-approve"].includes(action)) {
        unexpected.push(request.url()); return route.abort();
      }
      const gate = nextMutation; nextMutation = null;
      mutations.push({ id, action, body: request.postData() });
      if (gate) await gate.promise;
      if (failMutation) return route.fulfill({ status: 409, json: { error: "Fixture action was not applied" } });
      if (action === "retry-ai") rows = rows.map(item => item.id === id ? { ...item, ai_status: "pending", ai_failure_reason: null } : item);
      if (action === "approve" || action === "reject") rows = rows.map(item => item.id === id ? { ...item, status: action === "approve" ? "approved" : "rejected" } : item);
      return route.fulfill({ status: action === "retry-ai" ? 202 : 200,
        json: action === "bulk-approve" ? { approved: 0, failed: [] } : action === "retry-ai" ? { ok: true, accepted: true, aiStatus: "pending" } : { ok: true } });
    }
    if (url.pathname === "/candidate-job-review") return route.fulfill({ contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main class="page"><div id="root"></div></main><script src="/fixture.js"></script></body></html>' });
    unexpected.push(request.url()); return route.abort();
  });

  const card = id => page.locator("section.card").filter({ has: page.locator(`#review-title-${id}`) });
  const updateStatus = page.getByRole("status", { name: "Review queue updates" });
  const loading = page.getByText("Loading the review queue…", { exact: true });
  async function tick(ms = 15_000) { await page.clock.fastForward(ms); }
  async function focus() { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); }
  async function visibility(value) {
    await page.evaluate(value => { window.fixtureVisibility = value; document.dispatchEvent(new Event("visibilitychange")); }, value);
  }
  async function readAfter(action) {
    const count = reads.length;
    await action();
    await expect.poll(() => reads.length).toBe(count + 1);
    await expect(loading).toHaveCount(0);
  }
  async function assertQuietState() {
    await expect(card("watched").getByRole("button", { expanded: true })).toBeVisible();
    assert.equal(await page.getByLabel("Filter by candidate").inputValue(), candidate);
    assert.equal(await page.getByLabel("Filter by staff owner").inputValue(), owner);
    assert.equal(await page.getByLabel("Filter by source").inputValue(), "extension");
    assert.equal(await page.getByLabel("Filter by AI tier").inputValue(), "all");
    assert.equal(await page.getByLabel("Queued from").inputValue(), "2026-11-04T07:00");
    assert.equal(await page.getByLabel("Queued until").inputValue(), "2026-11-04T09:00");
    assert.equal(reads.at(-1).params.page, "2");
    assert.equal(await page.evaluate(() => window.watchedNode === document.querySelector('[aria-labelledby="review-title-watched"]')), true, "quiet refresh must retain the keyed card DOM");
    assert.equal(await page.evaluate(() => window.loadingFlashes), 0, "quiet refresh must never flash the loading placeholder");
  }

  await page.goto("https://talentos.test/candidate-job-review");
  await expect(card("retry")).toBeVisible();
  await page.clock.pauseAt(new Date("2026-11-04T06:00:05Z"));
  await readAfter(() => page.getByLabel("Filter by candidate").selectOption(candidate));
  await readAfter(() => page.getByLabel("Filter by staff owner").selectOption(owner));
  await readAfter(() => page.getByLabel("Filter by source").selectOption("extension"));
  await readAfter(() => page.getByLabel("Queued from").fill("2026-11-04T07:00"));
  await readAfter(() => page.getByLabel("Queued until").fill("2026-11-04T09:00"));
  await readAfter(() => page.getByRole("button", { name: "Next", exact: true }).click());
  await expect(card("watched")).toBeVisible();
  await card("watched").getByRole("button", { name: "1 other resume scored" }).click();
  await expect(card("watched").getByRole("button", { name: "Retry AI check" })).toBeDisabled();
  await expect(card("watched").getByRole("button", { name: "Approve & start AI workflow" })).toBeEnabled();
  await expect(card("watched").getByRole("button", { name: "Reject", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.watchedNode = document.querySelector('[aria-labelledby="review-title-watched"]');
    window.loadingFlashes = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.textContent?.includes("Loading the review queue…")) window.loadingFlashes++;
      }
    }).observe(document.getElementById("root"), { childList: true, subtree: true });
  });

  // A new ATS-only capture arrives without a reload, on the same selected page.
  rows.splice(2, 0, { ...base, id: "new-capture", job_title: "New extension capture", ai_status: "pending" });
  const captureRead = deferred(); nextRead = captureRead;
  const beforeCapture = reads.length;
  await tick();
  await expect.poll(() => reads.length).toBe(beforeCapture + 1);
  await expect(loading).toHaveCount(0);
  await assertQuietState();
  await tick(45_000);
  assert.equal(reads.length, beforeCapture + 1, "slow reads must not overlap");
  captureRead.release();
  await expect(card("new-capture")).toBeVisible();
  await expect(page.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await assertQuietState();

  // Pending AI becomes scored; the expanded card, focus, filters and page survive.
  rows = rows.map(item => item.id === "watched" ? { ...item, ai_status: "scored", ai_tier: "strong", ai_score: 93, ai_reason: "Completed fixture scoring." } : item);
  const expandedToggle = card("watched").getByRole("button", { expanded: true });
  await expandedToggle.focus();
  await readAfter(() => tick());
  await expect(card("watched").getByText("Strong · 93", { exact: true })).toBeVisible();
  await expect(expandedToggle).toBeFocused();
  await assertQuietState();
  assert.equal(mutations.length, 0, "polling must never auto-approve or start AI");

  const updatedTime = await page.locator("time").first().getAttribute("datetime");
  failRead = true;
  await readAfter(() => tick());
  await expect(updateStatus).toContainText("Automatic refresh failed");
  assert.equal(await page.locator("time").first().getAttribute("datetime"), updatedTime, "failed reads must not advance last updated");
  await assertQuietState();
  failRead = false;
  await readAfter(() => tick());
  await expect(updateStatus).toContainText("Updates automatically");

  // Hiding cancels an active refresh and stops polling/focus reads until return.
  const hiddenRead = deferred(); nextRead = hiddenRead;
  const beforeHidden = reads.length;
  await tick();
  await expect.poll(() => reads.length).toBe(beforeHidden + 1);
  await visibility("hidden");
  assert.equal(await page.evaluate(() => window.fixtureFetches.at(-1).aborted), true);
  hiddenRead.release();
  await tick(60_000); await focus();
  assert.equal(reads.length, beforeHidden + 1);
  await expect(updateStatus).toContainText("tab is hidden");
  await readAfter(() => visibility("visible"));
  await assertQuietState();
  await tick(1100);
  await readAfter(() => focus());
  const coalesced = reads.length;
  await focus(); await visibility("visible");
  assert.equal(reads.length, coalesced, "rapid return/focus events should coalesce");

  // Even if the transport ignores abort, an old filter response cannot win.
  const staleRead = deferred(); nextRead = staleRead;
  await page.evaluate(() => { window.ignoreNextAbort = true; });
  const beforeStale = reads.length;
  await tick();
  await expect.poll(() => reads.length).toBe(beforeStale + 1);
  const staleFetchIndex = await page.evaluate(() => window.fixtureFetches.length - 1);
  await readAfter(() => page.getByLabel("Filter by candidate").selectOption(otherCandidate));
  await expect(page.getByText("Nothing in this view", { exact: true })).toBeVisible();
  staleRead.release();
  await page.waitForFunction(index => window.fixtureFetches[index].settled, staleFetchIndex);
  await expect(page.locator("section.card")).toHaveCount(0);
  assert.equal(await page.getByLabel("Filter by candidate").inputValue(), otherCandidate);

  await readAfter(() => page.getByRole("button", { name: "Clear filters", exact: true }).click());
  await expect(card("retry")).toBeVisible();
  await page.evaluate(() => { window.loadingFlashes = 0; });
  // Start retry during an outstanding read: cancellation plus the action lock
  // prevent both a stale overwrite and duplicate review/AI requests.
  const actionStaleRead = deferred(); nextRead = actionStaleRead;
  await page.evaluate(() => { window.ignoreNextAbort = true; });
  await readAfter(() => tick());
  const actionStaleIndex = await page.evaluate(() => window.fixtureFetches.length - 1);
  const retryGate = deferred(); nextMutation = retryGate;
  await card("retry").getByRole("button", { name: "Retry AI check" }).click();
  await expect.poll(() => mutations.length).toBe(1);
  assert.equal(await page.evaluate(index => window.fixtureFetches[index].aborted, actionStaleIndex), true);
  const readsDuringRetry = reads.length;
  await tick(60_000); await focus(); await visibility("hidden"); await visibility("visible");
  assert.equal(reads.length, readsDuringRetry, "retry must pause all automatic reads");
  await expect(card("first").getByRole("button", { name: "Approve & start AI workflow" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Strong/ }).first()).toBeDisabled();
  failRead = true; // The queued optimistic state must also survive a failed follow-up read.
  retryGate.release();
  await expect(page.getByText(/AI eligibility check queued\. Results will update automatically/)).toBeVisible();
  await expect(card("retry").getByText("AI check pending", { exact: true })).toBeVisible();
  await expect(card("retry").getByRole("button", { name: "Retry AI check" })).toBeDisabled();
  await expect(card("retry").getByRole("button", { name: "Approve & start AI workflow" })).toBeEnabled();
  await expect(updateStatus).toContainText("Automatic refresh failed");
  actionStaleRead.release();
  await page.waitForFunction(index => window.fixtureFetches[index].settled, actionStaleIndex);
  await expect(card("retry").getByText("AI check pending", { exact: true })).toBeVisible();
  failRead = false;
  rows = rows.map(item => item.id === "retry" ? { ...item, ai_status: "scored", ai_tier: "adjacent", ai_score: 74 } : item);
  await readAfter(() => tick());
  await expect(card("retry").getByText("Adjacent · 74", { exact: true })).toBeVisible();

  // Every human action pauses refresh, and its own follow-up read is quiet.
  page.on("dialog", dialog => dialog.accept("Fixture rejection"));
  for (const action of ["approve", "reject", "bulk-approve"]) {
    const gate = deferred(); nextMutation = gate;
    const before = mutations.length;
    if (action === "bulk-approve") await page.getByRole("button", { name: /^Strong \+ Adjacent/ }).click();
    else await card(action === "approve" ? "retry" : "first").getByRole("button", {
      name: action === "approve" ? "Approve & start AI workflow" : "Reject", exact: true,
    }).click();
    await expect.poll(() => mutations.length).toBe(before + 1);
    const readCount = reads.length;
    await tick(60_000); await focus();
    assert.equal(reads.length, readCount, `${action} must pause polling/focus reads`);
    await expect(updateStatus).toContainText("Updates paused during review action");
    gate.release();
    await expect.poll(() => reads.length).toBe(readCount + 1);
    await expect(updateStatus).toContainText("Updates automatically");
  }
  assert.deepEqual(mutations.map(item => item.action), ["retry-ai", "approve", "reject", "bulk-approve"]);
  assert.equal(await page.evaluate(() => window.loadingFlashes), 0, "action follow-up reads must also be quiet");

  failMutation = true;
  await card("new-capture").getByRole("button", { name: "Approve & start AI workflow" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture action was not applied");
  failMutation = false;
  await readAfter(() => tick());
  await expect(page.getByRole("alert")).toContainText("Fixture action was not applied");

  // Cleanup aborts the active read and removes both listeners and timers.
  const unmountRead = deferred(); nextRead = unmountRead;
  await readAfter(() => tick());
  await page.evaluate(() => window.unmountReviewFixture());
  assert.deepEqual(await page.evaluate(() => ({ aborted: window.fixtureFetches.at(-1).aborted,
    focus: window.fixtureListeners.focus.size, visibility: window.fixtureListeners.visibilitychange.size })),
  { aborted: true, focus: 0, visibility: 0 });
  unmountRead.release();
  const afterUnmount = reads.length;
  await tick(60_000); await focus(); await visibility("visible");
  assert.equal(reads.length, afterUnmount);

  // An initial load failure recovers automatically without retaining a stale alert.
  failRead = true;
  await page.evaluate(() => window.mountReviewFixture());
  await expect(page.getByRole("alert")).toContainText("Fixture refresh failure");
  failRead = false;
  await readAfter(() => tick());
  await expect(card("watched")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const unmountAction = deferred(); nextMutation = unmountAction;
  await card("new-capture").getByRole("button", { name: "Approve & start AI workflow" }).click();
  await expect(updateStatus).toContainText("Updates paused during review action");
  await page.evaluate(() => window.unmountReviewFixture());
  assert.equal(await page.evaluate(() => window.fixtureFetches.at(-1).aborted), true, "unmount also aborts the active action request");
  unmountAction.release();
  const finalReads = reads.length;
  await tick(60_000); await focus();
  assert.equal(reads.length, finalReads, "an unmounted action must not start a follow-up read");
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Review Queue live refresh passed: new captures, pending→scored, stable cards/focus/filters/page, quiet failures/recovery, non-overlap, hidden/focus refresh, stale response protection, queued retry, all action locks, and unmount abort/listener/timer cleanup. Synthetic APIs only; no production writes or AI.");
} finally {
  await browser.close();
}
