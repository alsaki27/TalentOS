import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    // The full suite imports the Next/Neon service graph in parallel. Five
    // seconds is shorter than a cold worker/module transform on this repo and
    // creates false timeout failures before a test body starts.
    testTimeout: 15_000,
    // The service/routing tests mock shared module boundaries. Running test
    // files concurrently lets one file's mocked module graph starve another.
    // Serialize files so the reliability suite is repeatable in CI and
    // locally.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/lib/ai/routing.ts", "src/server/repositories/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
