import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/test/**/*.test.ts"],
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
