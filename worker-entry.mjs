import worker from "./.open-next/worker.js";
import { getDueTeamActivityReportPeriods } from "./src/lib/teamActivityEmailSchedule.ts";

// TalentOS' Postgres moved from Neon (HTTP) to a self-hosted server, which a
// Worker can only reach over TCP. A Worker cannot verify that server's
// self-signed certificate - Cloudflare's socket API exposes no way to supply a CA
// or skip verification - so production goes through Cloudflare Hyperdrive, which
// connects from Cloudflare's network and pools connections to the origin.
//
// Hyperdrive is a binding, not an environment variable, so its connection string
// only exists at request time. Copying it into process.env here keeps
// src/server/db/neon.ts free of any runtime-specific lookup: that module reads
// process.env.DATABASE_URL and nothing else, in the Worker, in Node scripts and
// in tests alike.
//
// If the binding is absent (local `wrangler dev`, or before the Hyperdrive config
// is created) the DATABASE_URL secret is left in place, so nothing breaks - the
// Worker simply tries to connect directly.
function applyHyperdrive(env) {
  const connectionString = env?.HYPERDRIVE?.connectionString;
  if (!connectionString) return;
  globalThis.__TALENTOS_HYPERDRIVE_CONNECTION_STRING = connectionString;
  if (process.env.DATABASE_URL === connectionString) return; // already applied in this isolate
  process.env.DATABASE_URL = connectionString;
}

function applyRuntimeSecrets(env) {
  const runtimeJwtSecret =
    env?.JWT_SECRET ??
    env?.AI_KEYS_ENCRYPTION_SECRET ??
    process.env.JWT_SECRET ??
    process.env.AI_KEYS_ENCRYPTION_SECRET;
  if (typeof runtimeJwtSecret === "string" && runtimeJwtSecret.length > 0) {
    globalThis.__TALENTOS_JWT_SECRET = runtimeJwtSecret;
  }
  if (typeof env?.CRON_SECRET === "string" && env.CRON_SECRET.length > 0) {
    process.env.CRON_SECRET = env.CRON_SECRET;
  }
  if (typeof env?.JOB_AGENT_NIGHTLY_ENABLED === "string") {
    process.env.JOB_AGENT_NIGHTLY_ENABLED = env.JOB_AGENT_NIGHTLY_ENABLED;
  }
  applyHyperdrive(env);
}

async function handleFetch(request, env, ctx) {
    applyRuntimeSecrets(env);
    const response = await worker.fetch(request, env, ctx);
    // Cloudflare Web Analytics injects a RUM beacon into HTML responses. The
    // beacon is routinely blocked by Brave/ad blockers as ERR_BLOCKED_BY_CLIENT
    // and creates a noisy console error for every page load. The app already
    // uses private/no-store HTML responses, so no-transform is safe here and
    // tells the edge not to rewrite the response body.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return response;
    const headers = new Headers(response.headers);
    const cacheControl = headers.get("cache-control") ?? "private, no-store";
    if (!/\bno-transform\b/i.test(cacheControl)) {
      headers.set("cache-control", `${cacheControl}, no-transform`);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  },
  // One stage per minute, awaited inside the Cron event. Cloudflare waits for
  // scheduled() (up to 15 minutes), unlike HTTP waitUntil which is cut off 30s
  // after the response. Claim locking makes UI/GitHub/Cron overlap safe.
  async scheduled(controller, env) {
    const cron = controller.cron;
    const isMinuteTick = cron === "* * * * *";
    const isNightlyStart = cron === "0 18 * * *"; // 12:00 AM Asia/Dhaka
    const isHistoryRetention = cron === "5 18 * * *"; // 12:05 AM Asia/Dhaka
    if (!isMinuteTick && !isNightlyStart && !isHistoryRetention) return;

    const secret = env?.CRON_SECRET;
    if (typeof secret !== "string" || secret.length === 0) {
      throw new Error("CRON_SECRET is required for scheduled TalentOS jobs");
    }

    const baseUrl = env?.TALENTOS_BASE_URL || "https://talent.skarion.com";
    const tasks = [];
    if (isMinuteTick) {
      const reportPeriods = getDueTeamActivityReportPeriods(new Date(controller.scheduledTime));
      tasks.push((async () => {
        const response = await fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
          method: "GET",
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(`AI pipeline scheduled dispatch failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
        }
        console.log(`[scheduled pipeline dispatch] ${body.slice(0, 500)}`);
      })());
      tasks.push((async () => {
        const response = await fetch(`${baseUrl}/api/cron/job-agent-poll`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
        });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(`Job Agent poll failed with HTTP ${response.status}: ${body.slice(0, 1000)}`);
        }
        let pollErrors = 0;
        try { pollErrors = Number(JSON.parse(body)?.pollErrors ?? 0); } catch { /* body is logged below */ }
        if (pollErrors > 0) console.warn(`[scheduled Job Agent poll] ${pollErrors} Apify status check(s) failed: ${body.slice(0, 1000)}`);
        else console.log(`[scheduled Job Agent poll] ${body.slice(0, 500)}`);
      })());
      for (const period of reportPeriods) tasks.push((async () => {
        const response = await fetch(`${baseUrl}/api/cron/team-activity-report?period=${period}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            Accept: "application/json",
          },
        });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(`Scheduled ${period} team activity report failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
        }
        console.log(`[scheduled ${period} team activity report] ${body.slice(0, 500)}`);
      })());
    }
    if (isNightlyStart) tasks.push((async () => {
      const response = await fetch(`${baseUrl}/api/cron/job-agent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "X-Job-Agent-Invocation": "scheduled",
          "X-Job-Agent-Request-Id": `cloudflare-${controller.scheduledTime}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Nightly Job Agent start failed with HTTP ${response.status}: ${body.slice(0, 1000)}`);
      console.log(`[scheduled nightly Job Agent] ${body.slice(0, 1000)}`);
    })());
    if (isHistoryRetention) tasks.push((async () => {
      const response = await fetch(`${baseUrl}/api/cron/job-agent-retention`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Job Agent history retention failed with HTTP ${response.status}: ${body.slice(0, 1000)}`);
      console.log(`[scheduled Job Agent history retention] ${body.slice(0, 1000)}`);
    })());
    const outcomes = await Promise.allSettled(tasks);
    const errors = outcomes.flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason] : []);
    if (errors.length > 0) {
      throw new Error(`One or more scheduled tasks failed: ${errors.map((error) => String(error)).join("; ")}`);
    }
  },
};
