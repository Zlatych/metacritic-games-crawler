import { z } from "zod";
import { config } from "../config";
import type { ReviewSummary } from "../db/schema";
import { errorMessage, sha256, truncate } from "../lib/util";
import { log } from "../lib/log";
import type { Review } from "../metacritic/api";
import { chatJson, llmEnabled } from "./llm";

const summarySchema = z.object({
  summary: z.string(),
  likes: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
});

/** Normalise both scales to 0..100: critics score 0-100, users 0-10. */
const score100 = (r: Review) => (r.score == null ? null : r.kind === "user" ? r.score * 10 : r.score);
const sentiment = (r: Review) => {
  const s = score100(r);
  return s == null ? "mixed" : s >= 75 ? "positive" : s < 50 ? "negative" : "mixed";
};

/** Stable fingerprint of the review set — summaries are regenerated only when reviews change. */
export function reviewsHash(reviews: Review[]): string {
  return sha256(
    reviews
      .map((r) => `${r.score}|${r.author ?? r.publicationName}|${r.quote}`)
      .sort()
      .join("\n"),
  );
}

/** Balance the sample so negative opinions are not drowned out by the majority. */
function sample(reviews: Review[], maxChars: number): Review[] {
  const buckets = { positive: [] as Review[], mixed: [] as Review[], negative: [] as Review[] };
  for (const r of reviews) buckets[sentiment(r)].push(r);
  const out: Review[] = [];
  let chars = 0;
  for (let i = 0; ; i++) {
    const round = [buckets.negative[i], buckets.positive[i], buckets.mixed[i]].filter(Boolean) as Review[];
    if (!round.length) break;
    for (const r of round) {
      chars += (r.quote ?? "").length;
      if (chars > maxChars) return out;
      out.push(r);
    }
  }
  return out;
}

function extractive(reviews: Review[]): Omit<ReviewSummary, "updatedAt"> {
  const pick = (s: string) =>
    reviews
      .filter((r) => sentiment(r) === s)
      .sort((a, b) => (s === "positive" ? (score100(b) ?? 0) - (score100(a) ?? 0) : (score100(a) ?? 0) - (score100(b) ?? 0)))
      .slice(0, 3)
      .map((r) => truncate(r.quote ?? "", 220));
  const count = (s: string) => reviews.filter((r) => sentiment(r) === s).length;
  return {
    summary: `Из ${reviews.length} отзывов: положительных ${count("positive")}, смешанных ${count("mixed")}, отрицательных ${count("negative")}.`,
    likes: pick("positive"),
    dislikes: pick("negative"),
    source: "extractive",
    reviewCount: reviews.length,
  };
}

export async function summarizeReviews(title: string, kind: "critic" | "user", reviews: Review[]): Promise<ReviewSummary> {
  const updatedAt = new Date().toISOString();
  if (!reviews.length) {
    return { summary: "Отзывов пока нет.", likes: [], dislikes: [], source: "extractive", reviewCount: 0, updatedAt };
  }
  if (!llmEnabled()) return { ...extractive(reviews), updatedAt };

  const who = kind === "critic" ? "критиков (оценка 0–100)" : "игроков (оценка 0–10)";
  const lines = sample(reviews, config.LLM_MAX_INPUT_CHARS).map(
    (r) => `- [${r.score ?? "?"}] ${(r.quote ?? "").replace(/\s+/g, " ").trim()}`,
  );
  try {
    const res = await chatJson(
      "Ты аналитик игровых отзывов. Пиши по-русски, кратко и по делу, опираясь только на текст отзывов. Отвечай строго JSON.",
      `Игра: "${title}". Ниже ${lines.length} отзывов ${who}.\n` +
        `Составь резюме: что ${kind === "critic" ? "критикам" : "игрокам"} нравится и что не нравится.\n` +
        `Формат JSON: {"summary": "2–3 предложения общего впечатления", "likes": ["до 5 коротких пунктов"], "dislikes": ["до 5 коротких пунктов"]}.\n` +
        `Если явного негатива или позитива нет — оставь соответствующий массив пустым.\n\nОтзывы:\n${lines.join("\n")}`,
      summarySchema,
    );
    return {
      summary: res.summary,
      likes: res.likes.slice(0, 6),
      dislikes: res.dislikes.slice(0, 6),
      source: "llm",
      reviewCount: reviews.length,
      updatedAt,
    };
  } catch (e) {
    log.warn(`llm: ${kind} summary for "${title}" failed, using extractive fallback: ${errorMessage(e)}`);
    return { ...extractive(reviews), updatedAt };
  }
}
