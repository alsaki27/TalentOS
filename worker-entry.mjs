import worker from "./.open-next/worker.js";

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

export default {
  async fetch(request, env, ctx) {
    if (typeof env?.JWT_SECRET === "string" && env.JWT_SECRET.length > 0) {
      globalThis.__TALENTOS_JWT_SECRET = env.JWT_SECRET;
    }
    applyHyperdrive(env);
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
  },
};

// GitHub Actions owns TalentOS scheduled jobs. Keep a no-op handler so a stale
// Cloudflare Cron Trigger cannot fail the Worker or duplicate those jobs.
export async function scheduled() {}
