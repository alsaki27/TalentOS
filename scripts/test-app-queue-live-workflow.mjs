// Runs the real App Queue component in Chromium with fixture API responses.
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

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
  let latest = { id: "old-failed-workflow", application_id: appId, status: "failed", current_stage: 2 };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.route("http://queue-fixture.test/**", async (route) => {
    const url = new URL(route.request().url());
    switch (url.pathname) {
      case "/application-queue":
        documents++;
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/queue.js"></script>' });
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
            ae_stage: "in_ai_pipeline",
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
          return route.fulfill({ json: { workflow: { status: "running" }, stages: [], artifacts: [] } });
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
  await row.getByRole("button", { name: /Details/ }).click();
  await expect.poll(() => detailRequests).toEqual(["/api/application-ai-workflows/replacement-workflow"]);

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
  expect(errors).toEqual([]);
  console.log("App Queue live workflow test passed.");
} finally {
  await browser.close();
}
