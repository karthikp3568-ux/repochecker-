import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: API route handlers against a real Postgres database (`repojudge_test`)
 * with the LLM in mock mode. Requires Postgres + Redis (`pnpm services` or docker compose).
 */
const base = process.env.DATABASE_URL ?? "postgresql://repojudge:repojudge@localhost:5432/repojudge";
const testUrl = base.replace(/\/[^/?]+(\?|$)/, "/repojudge_test$1");
const storageDir = path.resolve(import.meta.dirname, ".data/test");
// Global setup runs in this process and reads these.
process.env.TEST_DATABASE_URL = testUrl;
process.env.TEST_STORAGE_DIR = storageDir;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/helpers.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      LLM_MODE: "mock",
      STORAGE_DIR: storageDir,
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      APP_URL: "http://localhost:3000",
    },
  },
});
