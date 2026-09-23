import { retriageEmailBacklog } from "../src/server/services/emailRetriageService";

async function main() {
  // Read-only diagnostic: dryRun:true writes nothing, no applyPolicySeed.
  const report = await retriageEmailBacklog({
    dryRun: true,
    batchId: `diagnostic-${new Date().toISOString()}`,
    limit: 1000,
  });
  console.log(JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
