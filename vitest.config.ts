import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/adversarial/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      LLM_PROVIDER: "mock",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
