// npx tsx --env-file=.env.local scratch/check_markitdown_health.ts
async function main() {
  const url = process.env.MARKITDOWN_SERVICE_URL;
  console.log("Service host (redacted path):", url ? new URL(url).host : "NOT SET");

  try {
    const t0 = Date.now();
    const healthRes = await fetch(`${url}/health`, { signal: AbortSignal.timeout(20000) });
    console.log(`GET /health -> HTTP ${healthRes.status} in ${Date.now() - t0}ms`);
    console.log("body:", await healthRes.text());
  } catch (err: any) {
    console.log("GET /health failed:", err.message);
  }

  try {
    const t0 = Date.now();
    const rootRes = await fetch(`${url}/`, { signal: AbortSignal.timeout(20000) });
    console.log(`\nGET / -> HTTP ${rootRes.status} in ${Date.now() - t0}ms`);
    console.log("body (first 500 chars):", (await rootRes.text()).slice(0, 500));
  } catch (err: any) {
    console.log("GET / failed:", err.message);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
