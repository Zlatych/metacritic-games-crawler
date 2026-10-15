import { desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { reviewsHash, summarizeReviews } from "../ai/reviews";
import { llmEnabled } from "../ai/llm";
import { config } from "../config";
import { db } from "../db/client";
import { gamePlatforms, games, letsplays, runs } from "../db/schema";
import { log } from "../lib/log";
import { errorMessage } from "../lib/util";
import { type GameDetails, type Review, fetchGameDetails } from "../metacritic/api";
import { concludeLetsPlay, findTopLetsPlay, getTranscript } from "../youtube/letsplay";
import { ytdlpAvailable } from "../youtube/ytdlp";
import { monitor } from "./monitor";
import { type SelectedGame, markProcessed, selectGames } from "./selection";
import { recomputeSimilarity } from "./similarity";
import { WorkerPool } from "./worker-pool";

type SummaryJob = { gameId: number; title: string; kind: "critic" | "user"; reviews: Review[]; hash: string };
type LetsPlayJob = { gameId: number; title: string };

function saveGame(d: GameDetails) {
  const { platforms, criticReviews: _c, userReviews: _u, ...fields } = d;
  db.transaction((tx) => {
    tx.insert(games)
      .values(fields)
      .onConflictDoUpdate({ target: games.id, set: { ...fields, updatedAt: sql`CURRENT_TIMESTAMP` } })
      .run();
    tx.delete(gamePlatforms).where(eq(gamePlatforms.gameId, d.id)).run();
    if (platforms.length) tx.insert(gamePlatforms).values(platforms.map((p) => ({ ...p, gameId: d.id }))).run();
  });
}

// --- Stage 1: scrape Metacritic ------------------------------------------------------------
const scrapePool = new WorkerPool<SelectedGame>(
  "scraper",
  "Сбор данных Metacritic",
  config.SCRAPE_WORKERS,
  async (job) => {
    try {
      const d = await fetchGameDetails(job.slug);
      const existing = db
        .select({ c: games.criticReviewsHash, u: games.userReviewsHash })
        .from(games)
        .where(eq(games.id, d.id))
        .get();
      saveGame(d);
      markProcessed(job.slug, "ok");
      log.info(
        `scraped "${d.title}": ${d.platforms.length} platforms, ${d.criticReviews.length} critic / ${d.userReviews.length} user reviews`,
      );
      if (monitor.run) monitor.run.scraped++;

      // Summaries are refreshed only when the review set changed since the last crawl.
      for (const [kind, reviews, prev] of [
        ["critic", d.criticReviews, existing?.c],
        ["user", d.userReviews, existing?.u],
      ] as const) {
        const hash = reviewsHash(reviews);
        if (hash !== prev) summaryPool.push({ gameId: d.id, title: d.title, kind, reviews, hash });
      }
      queueLetsPlay(d.id, d.title);
    } catch (e) {
      markProcessed(job.slug, "failed");
      if (monitor.run) monitor.run.failed++;
      throw e;
    }
  },
  (job) => job.title,
);

// --- Stage 2: review summaries (LLM) -------------------------------------------------------
const summaryPool = new WorkerPool<SummaryJob>(
  "summarizer",
  "Резюме отзывов (LLM)",
  config.SUMMARY_WORKERS,
  async (job) => {
    const summary = await summarizeReviews(job.title, job.kind, job.reviews);
    // Keep the hash only for a real LLM result, so a fallback summary is retried on the next crawl.
    const hash = summary.source === "llm" || !llmEnabled() ? job.hash : null;
    db.update(games)
      .set(job.kind === "critic" ? { criticSummary: summary, criticReviewsHash: hash } : { userSummary: summary, userReviewsHash: hash })
      .where(eq(games.id, job.gameId))
      .run();
  },
  (job) => `${job.title} · ${job.kind === "critic" ? "критики" : "игроки"}`,
);

// --- Stage 3: YouTube let's play -----------------------------------------------------------
function needsLetsPlay(gameId: number): boolean {
  if (!config.LETSPLAY_ENABLED || !ytdlpAvailable()) return false;
  const row = db.select({ status: letsplays.status, updatedAt: letsplays.updatedAt }).from(letsplays).where(eq(letsplays.gameId, gameId)).get();
  if (!row) return true;
  const age = Date.now() - new Date(`${row.updatedAt.replace(" ", "T")}Z`).getTime();
  // A good result is refreshed weekly (new videos appear); a miss is retried after a few hours.
  return age > (row.status === "ok" ? config.LETSPLAY_REFRESH_DAYS * 86_400_000 : 6 * 3_600_000);
}

// Ids already waiting in the let's play queue, so the scraper and the backfill never enqueue a game twice.
const letsPlayQueued = new Set<number>();

function queueLetsPlay(gameId: number, title: string) {
  if (letsPlayQueued.has(gameId) || !needsLetsPlay(gameId)) return;
  letsPlayQueued.add(gameId);
  letsPlayPool.push({ gameId, title });
}

/** Games already in the DB whose let's play is missing or due for a refresh (e.g. crawled before the feature ran). */
function backfillLetsPlays(limit: number) {
  const rows = db
    .select({ id: games.id, title: games.title })
    .from(games)
    .leftJoin(letsplays, eq(letsplays.gameId, games.id))
    .where(or(isNull(letsplays.gameId), lt(letsplays.updatedAt, sql`datetime('now', '-6 hours')`)))
    .orderBy(desc(games.releaseDate))
    .limit(limit * 3)
    .all();
  let queued = 0;
  for (const r of rows) {
    if (queued >= limit) break;
    const before = letsPlayQueued.size;
    queueLetsPlay(r.id, r.title);
    if (letsPlayQueued.size > before) queued++;
  }
  if (queued) log.info(`letsplay backfill: ${queued} games queued`);
}

function saveLetsPlay(gameId: number, values: Omit<typeof letsplays.$inferInsert, "gameId">) {
  const row = { videoId: null, title: null, channel: null, views: null, duration: null, transcriptSource: null, transcript: null, conclusion: null, error: null, ...values };
  db.insert(letsplays)
    .values({ gameId, ...row })
    .onConflictDoUpdate({ target: letsplays.gameId, set: { ...row, updatedAt: sql`CURRENT_TIMESTAMP` } })
    .run();
}

const letsPlayPool = new WorkerPool<LetsPlayJob>(
  "letsplay",
  "Летсплеи YouTube",
  config.LETSPLAY_WORKERS,
  async ({ gameId, title }) => {
    try {
      const video = await findTopLetsPlay(title);
      if (!video) return saveLetsPlay(gameId, { status: "not_found" });
      const meta = { videoId: video.id, title: video.title, channel: video.channel, views: video.views, duration: video.duration };
      const transcript = await getTranscript(video.id);
      if (!transcript) return saveLetsPlay(gameId, { status: "no_transcript", ...meta });
      const conclusion = await concludeLetsPlay(title, video, transcript.text);
      saveLetsPlay(gameId, { status: "ok", ...meta, transcriptSource: transcript.source, transcript: transcript.text, conclusion });
      log.info(`letsplay "${title}": ${video.title} (${video.views} views, ${transcript.source})`);
    } catch (e) {
      saveLetsPlay(gameId, { status: "error", error: errorMessage(e) });
      throw e;
    } finally {
      letsPlayQueued.delete(gameId);
    }
  },
  (job) => job.title,
);

// --- Orchestration --------------------------------------------------------------------------
let running: Promise<void> | null = null;

export const isRunning = () => running !== null;

/** Starts a crawl unless one is already in progress. Returns false if skipped. */
export function triggerRun(trigger: "schedule" | "manual" | "startup"): boolean {
  if (running) {
    log.warn(`run (${trigger}) skipped: previous run is still in progress`);
    return false;
  }
  running = executeRun(trigger).finally(() => {
    running = null;
    monitor.run = null;
    monitor.changed();
  });
  return true;
}

async function executeRun(trigger: "schedule" | "manual" | "startup") {
  const run = db.insert(runs).values({ trigger }).returning().get();
  monitor.run = { id: run.id, trigger, stage: "Выбор игр", startedAt: new Date().toISOString(), selected: 0, scraped: 0, failed: 0 };
  log.info(`run #${run.id} started (${trigger})`);
  try {
    const selected = await selectGames(config.GAMES_PER_RUN, run.id);
    monitor.run.selected = selected.length;
    log.info(`run #${run.id}: ${selected.length} games selected`);

    monitor.setStage("Сбор данных Metacritic");
    for (const g of selected) scrapePool.push(g);
    await scrapePool.drain();

    monitor.setStage("Резюме отзывов и летсплеи");
    backfillLetsPlays(config.GAMES_PER_RUN);
    await Promise.all([summaryPool.drain(), letsPlayPool.drain()]);

    monitor.setStage("Подбор похожих игр");
    const pairs = recomputeSimilarity();
    log.info(`similarity: ${pairs} links recomputed`);

    const { scraped, failed } = monitor.run;
    db.update(runs)
      .set({ status: "ok", finishedAt: sql`CURRENT_TIMESTAMP`, selected: selected.length, scraped, failed })
      .where(eq(runs.id, run.id))
      .run();
    log.info(`run #${run.id} finished: ${scraped} scraped, ${failed} failed`);
  } catch (e) {
    log.error(`run #${run.id} failed: ${errorMessage(e)}`);
    db.update(runs)
      .set({ status: "failed", finishedAt: sql`CURRENT_TIMESTAMP`, error: errorMessage(e), scraped: monitor.run?.scraped ?? 0, failed: monitor.run?.failed ?? 0 })
      .where(eq(runs.id, run.id))
      .run();
  }
}
