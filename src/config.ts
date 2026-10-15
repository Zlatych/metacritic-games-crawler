import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const ROOT_DIR = path.resolve(import.meta.dirname, "..");

const envFile = path.join(ROOT_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DB_PATH: z.string().default(path.join(ROOT_DIR, "data", "metacritic.db")),
  TMP_DIR: z.string().default(path.join(ROOT_DIR, "tmp")),

  RUN_CRON: z.string().default("0 * * * *"),
  RUN_ON_STARTUP: bool.default(true),
  GAMES_PER_RUN: z.coerce.number().int().positive().default(20),

  MC_FETCH_MODE: z.enum(["auto", "http", "browser"]).default("auto"),
  MC_CONCURRENCY: z.coerce.number().int().positive().default(4),
  MC_REVIEWS_PER_PLATFORM: z.coerce.number().int().positive().default(25),
  MC_REVIEW_PLATFORMS: z.coerce.number().int().positive().default(3),

  SCRAPE_WORKERS: z.coerce.number().int().positive().default(3),
  SUMMARY_WORKERS: z.coerce.number().int().positive().default(1),
  LETSPLAY_WORKERS: z.coerce.number().int().positive().default(1),

  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  LLM_MODEL: z.string().default("llama-3.1-8b-instant"),
  LLM_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(14000),

  STT_API_KEY: z.string().default(""),
  STT_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  STT_MODEL: z.string().default("whisper-large-v3-turbo"),
  STT_MAX_MINUTES: z.coerce.number().int().positive().default(15),

  LETSPLAY_ENABLED: bool.default(true),
  LETSPLAY_REFRESH_DAYS: z.coerce.number().int().positive().default(7),
  YTDLP_PATH: z.string().default(path.join(ROOT_DIR, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")),
});

const env = schema.parse(process.env);

export const config = {
  ...env,
  STT_API_KEY: env.STT_API_KEY || env.LLM_API_KEY,
};
