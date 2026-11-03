// Render the actual job-detail page in Chromium against intercepted API data.
// No production job or application is written.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const copyId = "76684cec-463e-4be7-acc7-a4c510b8512a";
const canonicalId = "00cfcd73-a337-4fdd-bc4b-777ac893adab";
const bundle = await build({
  stdin: {
    contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import Page from "./src/app/jobs/[id]/page.tsx"; createRoot(document.getElementById("root")).render(React.createElement(Page));',
    resolveDir: process.cwd(), loader: "jsx",
  },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "job-page-test-shell", setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|next\/link|@\/components\/TailorResumeModal|@\/lib\/falood\/openStudio)$/ }, args => ({ path: args.path, namespace: "shell" }));
    builder.onLoad({ filter: /.*/, namespace: "shell" }, args => {
      let contents;
      if (args.path === "next/navigation") contents = 'export const useParams=()=>({id:location.pathname.split("/").pop()}); export const useRouter=()=>({push:u=>location.assign(u),back:()=>history.back()});';
      else if (args.path === "next/link") contents = 'import React from "react"; export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}';
      else if (args.path.includes("TailorResumeModal")) contents = 'export const TailorResumeModal=()=>null;';
      else contents = 'export const openFaloodStudio=()=>{};';
      return { contents, resolveDir: process.cwd(), loader: "js" };
    });
  } }],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("https://talentos.test/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/test-bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: [] });
    if (url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.split("/").pop();
      const isCopy = id === copyId;
      const isActive = id === canonicalId;
      return route.fulfill({ json: {
        id, title: "Commercial Analyst - Natural Gas Interstate Marketing", company: "Kinder Morgan", location: "Houston, TX", source: "extension",
        is_active: isActive, content_duplicate_of: isCopy ? canonicalId : null, applicants: [], category_tags: [],
        description_text: "Analyze commercial transactions and prepare operational reports.", category_status: "pending",
        jobStatus: { state: isCopy || isActive ? "active" : "inactive", redirected: isCopy, canonicalJobId: isCopy ? canonicalId : id },
      } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/test-bundle.js"></script>' });
  });
  await page.goto(`https://talentos.test/jobs/${copyId}`);
  await page.getByText("Duplicate copy", { exact: true }).waitFor();
  assert.equal(await page.getByText("Inactive in TalentOS", { exact: true }).count(), 0);
  const originalLink = page.getByRole("link", { name: "Open the active TalentOS job record" });
  assert.equal(await originalLink.getAttribute("href"), `/jobs/${canonicalId}`);
  await originalLink.click();
  await page.getByText("Active in TalentOS", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/jobs/${canonicalId}`);
  await page.goto("https://talentos.test/jobs/closed-record");
  await page.getByText("Inactive in TalentOS", { exact: true }).waitFor();
  assert.equal(await page.getByText("Duplicate copy", { exact: true }).count(), 0);
  console.log("Job-detail UI passed: hidden copy is labelled duplicate, links to the active original, and genuine inactive jobs stay inactive.");
} finally {
  await browser.close();
}
