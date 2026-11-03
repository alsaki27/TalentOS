// Render the real page and styles with synthetic API responses, one browser at
// a time. No Next server, production records, credentials, or AI calls needed.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const longToken = "Resume_" + "CAD_drafting_evidence_".repeat(22);
const baseItem = {
  source: "scheduled_logging", candidate_id: "candidate-fixture",
  candidate_name: "Sample Candidate", job_id: "job-fixture",
  job_title: "Mechanical Designer, Hydroelectric sector",
  company: "Example Engineering", apply_url: "https://example.com/job",
  base_resume_id: "resume-fixture", base_resume_name: longToken,
  alternate_resumes: [{ resumeId: "alternate", resumeName: longToken, score: 82 }],
  ats_score: 88, ai_status: "scored", ai_tier: "strong", ai_score: 90,
  ai_reason: "Drafting, layout drawings, quality control, and multidisciplinary coordination are transferable to this role. ".repeat(6),
  ai_failure_reason: null,
  hard_gates: [
    "Work authorization: the reviewer must verify eligibility for the location and confirm the required authorization before proceeding. ".repeat(4),
    "Evidence reference: " + "qualification_evidence_".repeat(35),
  ],
  status: "pending", priority: "default", assigned_to_name: "Example Application Owner",
  reviewed_by_name: null, reviewed_at: null, review_note: null,
  application_id: null, created_at: "2026-11-03T17:49:34Z",
};
const items = [
  { ...baseItem, id: "strong" },
  { ...baseItem, id: "adjacent", source: "extension", ai_tier: "adjacent" },
  { ...baseItem, id: "failed", ai_status: "failed", ai_tier: null, ai_reason: null, ai_failure_reason: "Provider temporarily unavailable: " + longToken },
  { ...baseItem, id: "unscored", ai_status: "pending", ai_tier: null, ai_reason: null },
  { ...baseItem, id: "approved", status: "approved", application_id: "application-fixture" },
  { ...baseItem, id: "rejected", status: "rejected", review_note: longToken },
];

const bundle = await build({
  stdin: {
    contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import "./src/app/globals.css"; import Page from "./src/app/candidate-job-review/page.tsx"; createRoot(document.getElementById("root")).render(React.createElement(Page));',
    resolveDir: process.cwd(), loader: "jsx",
  },
  bundle: true, write: false, outdir: "fixture-build", platform: "browser",
  format: "iife", jsx: "automatic", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-link-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: 'import React from "react"; export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}',
      loader: "js", resolveDir: process.cwd(),
    }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const rawCss = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const { css } = await postcss([tailwindcss({
  content: [{ raw: script, extension: "js" }], corePlugins: { preflight: true },
})]).process(rawCss, { from: undefined });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://talentos.test") return route.abort();
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname === "/api/admin/candidate-job-review" && route.request().method() === "GET") {
      const status = url.searchParams.get("status");
      return route.fulfill({ json: { items: items.filter(item => status === "all" || item.status === status), counts: { pending: 4, approved: 1, rejected: 1 } } });
    }
    if (url.pathname.startsWith("/api/")) throw new Error("Unexpected API mutation in responsive test");
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main class="page"><div id="root"></div></main><script src="/fixture.js"></script></body></html>' });
  });
  await page.goto("https://talentos.test/candidate-job-review");
  await page.locator("section.card").first().waitFor();
  const firstCard = page.locator("section.card").first();
  await firstCard.getByRole("button", { name: "1 other resume scored" }).click();
  assert.equal(await firstCard.getByRole("button", { expanded: true }).count(), 1);

  async function assertFits(label) {
    const failures = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const failures = [];
      if (document.documentElement.scrollWidth > width + 1) failures.push("document scrolls horizontally");
      // html has overflow-x:hidden globally. Check descendants too, so clipping
      // cannot hide a broken layout and produce a false positive.
      const nodes = document.querySelectorAll(".candidate-job-review-page, .candidate-job-review-page *");
      for (const node of nodes) {
        if (node.closest("svg") || !node.getClientRects().length) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < -1 || rect.right > width + 1) failures.push(`${node.tagName}.${String(node.className)} outside viewport`);
        if (node.clientWidth && node.scrollWidth > node.clientWidth + 2) failures.push(`${node.tagName}.${String(node.className)} clips content`);
      }
      return failures.slice(0, 12);
    });
    assert.deepEqual(failures, [], label);
  }

  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    for (const width of [320, 375, 390, 640, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertFits(`${theme} ${width}px`);
      const statsColumns = await page.locator(".stats-strip").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
      assert.equal(statsColumns, width <= 640 ? 2 : 4, `summary layout at ${width}px`);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Filter by source").selectOption("extension");
  assert.equal(await page.locator("section.card").count(), 1);
  await page.getByLabel("Filter by source").selectOption("all");
  await page.getByLabel("Filter by AI tier").selectOption("unscored");
  assert.equal(await page.locator("section.card").count(), 2);
  await assertFits("unavailable and pending AI on phone");
  await page.getByLabel("Filter by AI tier").selectOption("all");
  for (const [tab, text] of [["Approved", "View application"], ["Rejected", "Rejected by"]]) {
    await page.getByRole("button", { name: new RegExp(`^${tab}`) }).click();
    await page.getByText(text, { exact: false }).waitFor();
    await assertFits(`${tab} on phone`);
  }
  await page.getByRole("button", { name: /^Pending/ }).click();
  await page.locator("section.card").first().waitFor();
  if (process.env.REVIEW_QUEUE_SCREENSHOTS) {
    await mkdir(process.env.REVIEW_QUEUE_SCREENSHOTS, { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: `${process.env.REVIEW_QUEUE_SCREENSHOTS}/review-queue-${width}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log("Review Queue passed: 16 viewport/theme checks (320–1920px), long warnings and filenames, score/action visibility, alternate resumes, filters, approved/rejected states. No API writes or AI calls.");
} finally {
  await browser.close();
}
