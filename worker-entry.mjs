import worker from "./.worker-next/index.mjs";

// GitHub Actions owns TalentOS scheduled jobs. Keep a no-op handler so a stale
// Cloudflare Cron Trigger cannot fail the Worker or duplicate those jobs.
export default worker;
export async function scheduled() {}
