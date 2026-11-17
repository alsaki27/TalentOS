// Runs the real App Queue component in Chromium with fixture API responses.
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const { css } = await postcss([tailwindcss()]).process(readFileSync("src/app/globals.css", "utf8"), {
  from: "src/app/globals.css",
});

const bundle = await build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import AppQueue from "./src/app/application-queue/page.tsx";
      createRoot(document.getElementById("root")).render(<AppQueue />);
    `,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outdir: "fixture-build",
  jsx: "automatic",
  platform: "browser",
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "next-link-fixture",
    setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: 'import React from "react"; export default function Link(props) { return React.createElement("a", props); }',
        resolveDir: process.cwd(),
      }));
    },
  }],
});

const appId = "application-under-test";
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync(chromium.executablePath()) ? undefined : [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync));
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage();
  const errors = [];
  const detailRequests = [];
  let documents = 0;
  let queueReads = 0;
  let polls = 0;
  let aeStage = "in_ai_pipeline";
  let finishApproval;
  let needsApproval = false;
  let finishApplied;
  const approvedRevision = "fixture-version:saved-content-hash";
  let latest = { id: "old-failed-workflow", application_id: appId, status: "failed", current_stage: 2 };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.route("http://queue-fixture.test/**", async (route) => {
    const url = new URL(route.request().url());
    switch (url.pathname) {
      case "/application-queue":
        documents++;
        return route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/queue.css"><div id="root"></div><script src="/queue.js"></script>' });
      case "/queue.css":
        return route.fulfill({ contentType: "text/css", body: css });
      case "/queue.js":
        return route.fulfill({ contentType: "text/javascript", body: script });
      case "/api/application-queue":
        if (url.searchParams.has("options")) return route.fulfill({ json: [] });
        queueReads++;
        return route.fulfill({ json: {
          total: 1,
          items: [{
            id: appId,
            app_number: 35878,
            status: "assigned",
            ae_stage: aeStage,
            resume_approval_required: needsApproval,
            priority: "normal",
            candidates: { id: "candidate", name: "Fixture Candidate" },
            jobs: { id: "job", title: "Fixture Planner", company: "Fixture Company" },
            workflow_id: "old-failed-workflow",
            workflow_status: "failed",
            workflow_stage: 2,
            resume_generation_status: "failed",
          }],
        } });
      case "/api/users":
        return route.fulfill({ json: [] });
      case "/api/bootstrap":
        return route.fulfill({ json: { role: "admin", user_id: "fixture-admin" } });
      case "/api/application-ai-workflows/active":
        expect(url.searchParams.get("view")).toBe("application-queue");
        polls++;
        return route.fulfill({ json: { workflows: [latest], needsDispatch: false } });
      case `/api/applications/${appId}`:
        if (route.request().method() === "PATCH") {
          const { ae_stage: requested, approve_resume, resume_approval_revision } = route.request().postDataJSON();
          if (requested === "applied" && needsApproval) {
            if (!approve_resume) {
              return route.fulfill({ status: 409, json: {
                code: "resume_release_required", resume_approval_revision: approvedRevision,
                error: "The current saved résumé needs approval.",
              } });
            }
            expect(resume_approval_revision).toBe(approvedRevision);
            await new Promise(resolve => { finishApplied = resolve; });
            needsApproval = false;
            aeStage = "applied";
            return route.fulfill({ json: { ae_stage: aeStage, resume_release: { pageCount: 1 } } });
          }
          if (requested === "ready_for_application") {
            const confirmed = await new Promise(resolve => { finishApproval = resolve; });
            if (!confirmed) return route.fulfill({ status: 409, json: { error: "The PDF archive could not be confirmed." } });
          }
          aeStage = requested;
          return route.fulfill({ json: {
            ae_stage: aeStage,
            ...(aeStage === "ready_for_application" ? { resume_release: { pageCount: 2 } } : {}),
          } });
        }
        return route.fulfill({ json: { resume_generation_status: "failed" } });
      case `/api/applications/${appId}/ai-workflow`:
        return route.fulfill({ status: 409, json: {
          error: "An active workflow already exists for this application",
          workflowId: "conflict-workflow",
          status: "running",
          currentStage: 2,
        } });
      default:
        if (url.searchParams.get("action") === "status") {
          detailRequests.push(url.pathname);
          return route.fulfill({ json: {
            workflow: { status: "running" },
            stages: [],
            artifacts: [
              { automation_id: "application_hiring_panel", data: { atsScore: 7, roleFitScore: 8, overallComment: "Fixture panel summary." } },
              { automation_id: "application_release_editor", data: { exportReady: false, unresolvedWarnings: ["Fixture review warning."] } },
            ],
          } });
        }
        return route.fulfill({ status: 404 });
    }
  });

  await page.goto("http://queue-fixture.test/application-queue");
  const row = page.getByRole("row").filter({ hasText: "Fixture Planner" });
  const badge = row.locator(".pipeline-live-badge");
  const retry = row.getByRole("button", { name: /Retry/ });
  const errorButton = row.getByRole("button", { name: "View error" });
  await expect(retry).toBeVisible();
  await expect(errorButton).toBeVisible();
  await row.getByRole("checkbox").check();

  // A newer workflow is queued while the application still reports the old failure.
  latest = { ...latest, id: "replacement-workflow", status: "queued", current_stage: 0 };
  await page.clock.runFor(6100);
  await expect(badge).toHaveText("Queued");
  await expect(row.getByText(/Resume Forge/)).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(errorButton).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Details/ })).toBeVisible();
  await expect(row.getByRole("checkbox")).toBeChecked();

  latest = { ...latest, status: "running", current_stage: 1 };
  await page.clock.runFor(6100);
  await expect(badge).toHaveText("Running");
  await expect(row.getByText(/Hiring Panel/)).toBeVisible();
  await expect(row.locator(".pipeline-live-dot-running")).toHaveCount(1);
  await expect(retry).toHaveCount(0);
  const findings = row.getByRole("button", { name: /Findings/ });
  await findings.click();
  await expect.poll(() => detailRequests).toEqual(["/api/application-ai-workflows/replacement-workflow"]);
  const dialog = page.getByRole("dialog", { name: "Review findings · A#35878" });
  await expect(dialog.getByText("Fixture Planner", { exact: false })).toBeVisible();
  await expect(dialog.getByText("7.0/10", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Fixture review warning.")).toBeVisible();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 760 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => Math.round((await dialog.boundingBox()).width)).toBe(Math.round(viewport.width * 0.9));
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(findings).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });

  // A real terminal failure exposes Retry, and a concurrent start corrects it immediately.
  latest = { ...latest, status: "failed" };
  await page.clock.runFor(6100);
  await expect(retry).toBeVisible();
  const pollsBeforeRetry = polls;
  await retry.click();
  await expect(badge).toHaveText("Running");
  await expect(row.getByText(/Final Polish/)).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(errorButton).toHaveCount(0);
  expect(polls).toBe(pollsBeforeRetry);
  expect(documents).toBe(1);
  expect(queueReads).toBe(1);
  const stage = row.locator('select').filter({ has: page.locator('option[value="ready_for_application"]') });
  await stage.selectOption("ready_for_review");
  await expect(stage).toHaveValue("ready_for_review");
  await stage.selectOption("ready_for_application");
  await expect(row.getByRole("status")).toHaveText("Checking and archiving the Studio PDF…");
  await expect(stage).toBeDisabled();
  await expect(stage).toHaveValue("ready_for_review");
  await expect.poll(() => Boolean(finishApproval)).toBe(true);
  finishApproval(false);
  finishApproval = undefined;
  await expect(stage).toBeEnabled();
  await expect(stage).toHaveValue("ready_for_review");
  await expect(page.getByText("The PDF archive could not be confirmed.")).toBeVisible();

  await stage.selectOption("ready_for_application");
  await expect.poll(() => Boolean(finishApproval)).toBe(true);
  finishApproval(true);
  await expect(stage).toHaveValue("ready_for_application");
  await expect(page.getByText("The approved PDF has 2 pages.", { exact: false })).toBeVisible();

  needsApproval = true;
  await page.reload();
  await expect(stage).toHaveValue("ready_for_application");
  await expect(stage.locator('option[value="applied"]')).toBeEnabled();
  const confirmation = page.getByRole("alertdialog", { name: "Confirm résumé and application" });
  await stage.selectOption("applied");
  await expect(confirmation.getByText(/A#35878/)).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(stage).toHaveValue("ready_for_application");
  expect(finishApplied).toBeUndefined();

  await stage.selectOption("applied");
  await confirmation.getByRole("button", { name: "Approve PDF and mark applied" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(stage).toBeDisabled();
  await expect(stage).toHaveValue("ready_for_application");
  await expect.poll(() => Boolean(finishApplied)).toBe(true);
  finishApplied();
  await expect(stage).toHaveValue("applied");
  await expect(page.getByText("Saved résumé approved and application marked applied.")).toBeVisible();
  expect(errors).toEqual([]);
  console.log("App Queue live workflow test passed.");
} finally {
  await browser.close();
}
