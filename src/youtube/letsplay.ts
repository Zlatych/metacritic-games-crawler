import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chatJson, llmEnabled, sttEnabled, transcribe } from "../ai/llm";
import { config } from "../config";
import type { LetsPlayConclusion } from "../db/schema";
import { log } from "../lib/log";
import { errorMessage, truncate } from "../lib/util";
import { ytdlp } from "./ytdlp";

export type VideoCandidate = { id: string; title: string; channel: string | null; views: number; duration: number };

const searchEntry = z.object({
  id: z.string(),
  title: z.string().nullish(),
  channel: z.string().nullish(),
  uploader: z.string().nullish(),
  view_count: z.number().nullish(),
  duration: z.number().nullish(),
  live_status: z.string().nullish(),
});

// Edition qualifiers rarely appear in video titles ("Tavern Talk: Complete Edition" → "tavern talk").
const EDITION_WORDS = new Set(["edition", "remastered", "remaster", "complete", "definitive", "deluxe", "goty", "enhanced"]);
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The video title must contain the game title as a whole phrase: "Alice Nation" ≠ "Education for the Nation". */
function mentionsGame(videoTitle: string, gameTitle: string): boolean {
  const phrase = normalize(gameTitle).filter((t) => !EDITION_WORDS.has(t)).join(" ");
  return !phrase || ` ${normalize(videoTitle).join(" ")} `.includes(` ${phrase} `);
}

// Videos that are about the game but are not a let's play with the blogger's own commentary.
const NOT_LETSPLAY = /\b(review|trailer|teaser|preview|before you buy|overview|reveal|announce\w*|explained|news|tier list|guide|tips|builds?|mods?|no commentary|no talking|asmr|soundtrack|ost|shorts?)\b|обзор|трейлер|без комментариев/i;
const LETSPLAY_HINT = /let'?s ?play|playthrough|gameplay|walkthrough|part \d|episode|ep\.? ?\d|first (look|time|hour)|blind|прохождение|летсплей/i;

/** Most-viewed let's play (long-form video with commentary) whose title actually mentions the game. */
export async function findTopLetsPlay(gameTitle: string): Promise<VideoCandidate | null> {
  const out = await ytdlp(["--flat-playlist", "-J", `ytsearch25:${gameTitle} let's play`], 90_000);
  const entries = z.object({ entries: z.array(z.unknown()) }).parse(JSON.parse(out)).entries;

  const candidates = entries
    .map((e) => searchEntry.safeParse(e))
    .filter((r) => r.success)
    .map((r) => r.data)
    .filter((e) => e.live_status !== "is_live" && e.live_status !== "is_upcoming")
    .filter((e) => (e.duration ?? 0) >= 8 * 60) // let's plays are long-form; skips trailers & shorts
    .filter((e) => !NOT_LETSPLAY.test(e.title ?? ""))
    .filter((e) => mentionsGame(e.title ?? "", gameTitle))
    .map((e) => ({
      id: e.id,
      title: e.title ?? "",
      channel: e.channel ?? e.uploader ?? null,
      views: e.view_count ?? 0,
      duration: e.duration ?? 0,
    }));

  // Prefer titles that explicitly look like a let's play; fall back to any long-form gameplay video.
  const explicit = candidates.filter((c) => LETSPLAY_HINT.test(c.title));
  const pool = explicit.length ? explicit : candidates;
  return pool.sort((a, b) => b.views - a.views)[0] ?? null;
}

const json3 = z.object({
  events: z.array(z.object({ segs: z.array(z.object({ utf8: z.string().optional() })).optional() })).default([]),
});

const videoInfo = z.object({
  language: z.string().nullish(),
  subtitles: z.record(z.string(), z.array(z.unknown())).nullish(),
  automatic_captions: z.record(z.string(), z.array(z.unknown())).nullish(),
});

/**
 * Picks exactly one caption track in the video's own language: manual subtitles first, then YouTube's original
 * ASR track ("<lang>-orig"). Machine-translated tracks are skipped — they are low quality and rate-limited (HTTP 429).
 */
function pickTrack(info: z.infer<typeof videoInfo>): { lang: string; auto: boolean } | null {
  const manual = Object.keys(info.subtitles ?? {}).filter((k) => k !== "live_chat");
  const auto = Object.keys(info.automatic_captions ?? {});
  const lang = info.language ?? "en";
  const manualPick =
    manual.find((k) => k === lang || k.startsWith(`${lang}-`)) ?? manual.find((k) => /^(en|ru)/.test(k));
  if (manualPick) return { lang: manualPick, auto: false };
  const asr = auto.find((k) => k === `${lang}-orig`) ?? auto.find((k) => k.endsWith("-orig")) ?? auto.find((k) => k === lang);
  return asr ? { lang: asr, auto: true } : null;
}

async function captionsTranscript(infoFile: string, dir: string): Promise<string | null> {
  const track = pickTrack(videoInfo.parse(JSON.parse(await readFile(infoFile, "utf8"))));
  if (!track) return null;
  await ytdlp(
    [
      "--load-info-json",
      infoFile,
      "--skip-download",
      track.auto ? "--write-auto-subs" : "--write-subs",
      "--sub-langs",
      track.lang,
      "--sub-format",
      "json3",
      "-o",
      path.join(dir, "subs.%(ext)s"),
    ],
    90_000,
  );
  const file = (await readdir(dir)).find((f) => f.endsWith(".json3"));
  if (!file) return null;
  const data = json3.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
  const text = data.events
    .flatMap((e) => e.segs ?? [])
    .map((s) => s.utf8 ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

async function sttTranscript(infoFile: string, dir: string): Promise<string | null> {
  if (!sttEnabled()) return null;
  // Only the first N minutes: keeps the upload under the free-tier 25 MB limit and the job fast.
  await ytdlp(
    [
      "--load-info-json",
      infoFile,
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--download-sections",
      `*0-${config.STT_MAX_MINUTES * 60}`,
      "-x",
      "--audio-format",
      "mp3",
      "--postprocessor-args",
      "ExtractAudio:-ac 1 -ar 16000 -b:a 32k",
      "-o",
      path.join(dir, "audio.%(ext)s"),
    ],
    10 * 60_000,
  );
  return (await transcribe(createReadStream(path.join(dir, "audio.mp3")))).trim() || null;
}

/** Blogger's speech as text: YouTube captions when available, otherwise Whisper over the audio track. */
export async function getTranscript(videoId: string): Promise<{ text: string; source: "captions" | "stt" } | null> {
  const dir = path.join(config.TMP_DIR, `yt-${videoId}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const infoFile = path.join(dir, "info.json");
    await writeFile(infoFile, await ytdlp(["--skip-download", "-J", `https://www.youtube.com/watch?v=${videoId}`], 90_000));
    const captions = await captionsTranscript(infoFile, dir).catch((e) => {
      log.warn(`letsplay: captions for ${videoId} failed: ${errorMessage(e)}`);
      return null;
    });
    if (captions) return { text: captions, source: "captions" };
    const stt = await sttTranscript(infoFile, dir);
    return stt ? { text: stt, source: "stt" } : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Long transcripts: take evenly spaced windows so the LLM sees the whole video, not just the intro. */
function sampleTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const windows = 6;
  const size = Math.floor(maxChars / windows);
  const step = (text.length - size) / (windows - 1);
  return Array.from({ length: windows }, (_, i) => text.slice(Math.round(i * step), Math.round(i * step) + size)).join(" … ");
}

const conclusionSchema = z.object({
  summary: z.string(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  verdict: z.string().default(""),
});

export async function concludeLetsPlay(gameTitle: string, video: VideoCandidate, transcript: string): Promise<LetsPlayConclusion> {
  if (!llmEnabled()) {
    return { summary: truncate(transcript, 600), pros: [], cons: [], verdict: "", source: "extractive" };
  }
  const res = await chatJson(
    "Ты игровой журналист. По расшифровке летсплея делаешь краткое заключение на русском. Опирайся только на текст. Отвечай строго JSON.",
    `Игра: "${gameTitle}". Видео: "${video.title}" (канал ${video.channel ?? "?"}).\n` +
      `Расшифровка речи блогера (может быть автоматической, с ошибками):\n"""${sampleTranscript(transcript, config.LLM_MAX_INPUT_CHARS)}"""\n\n` +
      `Верни JSON: {"summary": "о чём рассказывает блогер, 3–4 предложения", "pros": ["что блогеру понравилось"], "cons": ["что не понравилось"], "verdict": "итоговое мнение блогера одним предложением"}.`,
    conclusionSchema,
  );
  return { ...res, pros: res.pros.slice(0, 6), cons: res.cons.slice(0, 6), source: "llm" };
}
