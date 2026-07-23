import { execute } from './src/server/db/neon.ts';

async function main() {
  await execute(
    "UPDATE job_ceo_runs SET status = 'failed', last_error = 'Force stopped by user request' WHERE status IN ('ingesting', 'qa', 'deep_fetch', 'matchmaking')"
  );
  console.log("Active runs stopped");
}

main().catch(console.error);
