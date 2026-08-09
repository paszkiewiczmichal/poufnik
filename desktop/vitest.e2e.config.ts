import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.spec.mjs"],
    hookTimeout: 900000,
    testTimeout: 240000,
    pool: "forks",
    fileParallelism: false,
  },
});
