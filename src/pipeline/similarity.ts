import { db } from "../db/client";
import { games, similarGames } from "../db/schema";

const TOP_K = 6;
const MIN_SCORE = 0.12;
// Final score = weighted mix of three interpretable signals.
const W_TEXT = 0.55; // TF-IDF cosine of descriptions
const W_GENRE = 0.35; // Jaccard overlap of genres
const W_STUDIO = 0.1; // shared developer

const STOP = new Set(
  "a an the and or of to in on for with by from at as is are be this that it its your you their they will can into up out all new game games play player players world more than through".split(
    " ",
  ),
);

const words = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

const lowerSet = (items: string[]) => new Set(items.map((s) => s.trim().toLowerCase()).filter(Boolean));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function tfidfVectors(docs: string[][]): Map<string, number>[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * Math.log((1 + docs.length) / (1 + (df.get(t) ?? 0)) + 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) dot += w * (large.get(t) ?? 0);
  return dot;
}

/**
 * Content-based "similar games": description TF-IDF cosine + genre overlap + same studio.
 * Cheap enough to recompute for the whole catalogue after each run.
 */
export function recomputeSimilarity(): number {
  const rows = db.select({ id: games.id, description: games.description, genres: games.genres, developer: games.developer }).from(games).all();

  const text = tfidfVectors(rows.map((g) => words(g.description)));
  const genres = rows.map((g) => lowerSet(g.genres));
  const studios = rows.map((g) => lowerSet((g.developer ?? "").split(",")));

  const result: { gameId: number; similarId: number; score: number }[] = [];
  rows.forEach((a, i) => {
    const scored: { id: number; score: number }[] = [];
    rows.forEach((b, j) => {
      if (i === j) return;
      const score =
        W_TEXT * cosine(text[i]!, text[j]!) +
        W_GENRE * jaccard(genres[i]!, genres[j]!) +
        W_STUDIO * (jaccard(studios[i]!, studios[j]!) > 0 ? 1 : 0);
      if (score >= MIN_SCORE) scored.push({ id: b.id, score });
    });
    scored.sort((x, y) => y.score - x.score);
    for (const s of scored.slice(0, TOP_K)) result.push({ gameId: a.id, similarId: s.id, score: s.score });
  });

  db.transaction((tx) => {
    tx.delete(similarGames).run();
    for (let i = 0; i < result.length; i += 500) tx.insert(similarGames).values(result.slice(i, i + 500)).run();
  });
  return result.length;
}
