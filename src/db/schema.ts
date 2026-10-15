import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type ReviewSummary = {
  summary: string;
  likes: string[];
  dislikes: string[];
  source: "llm" | "extractive";
  reviewCount: number;
  updatedAt: string;
};

export type LetsPlayConclusion = {
  summary: string;
  pros: string[];
  cons: string[];
  verdict: string;
  source: "llm" | "extractive";
};

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`)
    .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
};

export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey(), // Metacritic product id
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    coverUrl: text("cover_url"),
    developer: text("developer"),
    publisher: text("publisher"),
    genres: text("genres", { mode: "json" }).$type<string[]>().notNull().default([]),
    releaseDate: text("release_date"),
    rating: text("rating"),
    videoUrl: text("video_url"),
    videoTitle: text("video_title"),
    metascore: integer("metascore"),
    userscore: real("userscore"),
    criticReviewCount: integer("critic_review_count").notNull().default(0),
    userReviewCount: integer("user_review_count").notNull().default(0),
    criticSummary: text("critic_summary", { mode: "json" }).$type<ReviewSummary>(),
    userSummary: text("user_summary", { mode: "json" }).$type<ReviewSummary>(),
    criticReviewsHash: text("critic_reviews_hash"),
    userReviewsHash: text("user_reviews_hash"),
    ...timestamps,
  },
  (t) => [index("games_title_idx").on(t.title), index("games_metascore_idx").on(t.metascore)],
);

export const gamePlatforms = sqliteTable(
  "game_platforms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    isLead: integer("is_lead", { mode: "boolean" }).notNull().default(false),
    releaseDate: text("release_date"),
    metascore: integer("metascore"),
    criticCount: integer("critic_count").notNull().default(0),
    userscore: real("userscore"),
    userCount: integer("user_count").notNull().default(0),
  },
  (t) => [uniqueIndex("game_platform_uq").on(t.gameId, t.slug), index("game_platform_name_idx").on(t.name)],
);

export const letsplays = sqliteTable("letsplays", {
  gameId: integer("game_id")
    .primaryKey()
    .references(() => games.id, { onDelete: "cascade" }),
  status: text("status").$type<"ok" | "not_found" | "no_transcript" | "error">().notNull(),
  videoId: text("video_id"),
  title: text("title"),
  channel: text("channel"),
  views: integer("views"),
  duration: integer("duration"),
  transcriptSource: text("transcript_source").$type<"captions" | "stt">(),
  transcript: text("transcript"),
  conclusion: text("conclusion", { mode: "json" }).$type<LetsPlayConclusion>(),
  error: text("error"),
  updatedAt: timestamps.updatedAt,
});

export const similarGames = sqliteTable(
  "similar_games",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    similarId: integer("similar_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.similarId] })],
);

/** Per-day crawl cursor: New Releases first, then "See All" (newest) pages. */
export const dailyProgress = sqliteTable("daily_progress", {
  day: text("day").primaryKey(),
  newReleasesDone: integer("new_releases_done", { mode: "boolean" }).notNull().default(false),
  browsePage: integer("browse_page").notNull().default(1),
});

export const processedGames = sqliteTable(
  "processed_games",
  {
    day: text("day").notNull(),
    slug: text("slug").notNull(),
    source: text("source").$type<"new-releases" | "browse">().notNull(),
    status: text("status").$type<"queued" | "ok" | "failed">().notNull().default("queued"),
    runId: integer("run_id"),
    processedAt: text("processed_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [primaryKey({ columns: [t.day, t.slug] })],
);

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger").$type<"schedule" | "manual" | "startup">().notNull(),
  status: text("status").$type<"running" | "ok" | "failed">().notNull().default("running"),
  startedAt: text("started_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  finishedAt: text("finished_at"),
  selected: integer("selected").notNull().default(0),
  scraped: integer("scraped").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  error: text("error"),
});

export type Game = typeof games.$inferSelect;
export type GamePlatform = typeof gamePlatforms.$inferSelect;
export type LetsPlay = typeof letsplays.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
