import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const wranglerEntry = path.resolve("node_modules/wrangler/bin/wrangler.js");
const outputPath = path.join(os.tmpdir(), `talentos-worker-configuration-${process.pid}.d.ts`);
const wranglerArgs = [wranglerEntry, "types", outputPath, "--env-interface", "CloudflareGeneratedEnv"];

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  // Generate and check in the same runner environment. The committed editor
  // copy is intentionally not compared because Wrangler embeds platform/path
  // details that differ between Windows development and Ubuntu Actions.
  run(wranglerArgs);
  run([...wranglerArgs, "--check"]);
} finally {
  fs.rmSync(outputPath, { force: true });
}
