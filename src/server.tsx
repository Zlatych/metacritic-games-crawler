import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Cron } from "croner";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { closeDb, db, runMigrations } from "./db/client";
import { runs } from "./db/schema";
import { llmEnabled, sttEnabled } from "./ai/llm";
import { log } from "./lib/log";
import { closeBrowser } from "./metacritic/browser";
import { monitor } from "./pipeline/monitor";
import { triggerRun } from "./pipeline/runner";
import { app } from "./web/routes";
import { ytdlpAvailable } from "./youtube/ytdlp";

runMigrations();
// A run interrupted by a restart can never finish — close it out.
db.update(runs).set({ status: "failed", error: "interrupted by restart" }).where(eq(runs.status, "running")).run();

app.use("/static/*", serveStatic({ root: "./public", rewriteRequestPath: (p) => p.replace(/^\/static/, "") }));

const schedule = new Cron(config.RUN_CRON, { protect: true, name: "crawl" }, () => {
  triggerRun("schedule");
});
monitor.nextRunAt = () => schedule.nextRun();

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  log.info(`web UI: http://localhost:${info.port}`);
  log.info(
    `schedule "${config.RUN_CRON}" · LLM: ${llmEnabled() ? config.LLM_MODEL : "off (extractive fallback)"} · ` +
      `STT: ${sttEnabled() ? config.STT_MODEL : "off"} · yt-dlp: ${ytdlpAvailable() ? "ok" : "missing (run npm run setup)"}`,
  );
  if (config.RUN_ON_STARTUP) triggerRun("startup");
});

async function shutdown() {
  log.info("shutting down…");
  schedule.stop();
  server.close();
  await closeBrowser();
  closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
