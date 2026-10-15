import { defineConfig } from "@playwright/test";

const PORT = 3123;
// A system HTTP(S)_PROXY must not intercept requests to the local test server.
process.env.NO_PROXY = [process.env.NO_PROXY, "localhost", "127.0.0.1"].filter(Boolean).join(",");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    // Isolated DB, no auto-crawl: the smoke test seeds its own data and must not hit Metacritic.
    command: "npx tsx src/server.tsx",
    url: `http://localhost:${PORT}/api/platforms`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DB_PATH: "./tmp/e2e.db", RUN_ON_STARTUP: "false", RUN_CRON: "0 0 1 1 *", LLM_API_KEY: "" },
  },
});
