import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { dailyProgress, processedGames } from "../db/schema";
import { log } from "../lib/log";
import { today } from "../lib/util";
import { fetchBrowsePage, fetchNewReleases } from "../metacritic/api";

export type SelectedGame = { slug: string; title: string; source: "new-releases" | "browse" };

const MAX_PAGES_PER_RUN = 15;

/**
 * Picks the next N games not yet processed today:
 *   1) the 20 "New Releases" from /game/ (once per day),
 *   2) then consecutive pages of "See All → Newest", resuming from today's page cursor.
 * A new calendar day starts a fresh progress row, so the order restarts from step 1.
 * Selected slugs are recorded immediately so a game is never picked twice in one day, even if it later fails.
 */
export async function selectGames(n: number, runId: number): Promise<SelectedGame[]> {
  const day = today();
  const progress =
    db.select().from(dailyProgress).where(eq(dailyProgress.day, day)).get() ??
    db.insert(dailyProgress).values({ day }).returning().get();

  const seen = new Set(
    db.select({ slug: processedGames.slug }).from(processedGames).where(eq(processedGames.day, day)).all().map((r) => r.slug),
  );
  const picked: SelectedGame[] = [];
  const take = (items: { slug: string; title: string }[], source: SelectedGame["source"]) => {
    const fresh = items.filter((i) => !seen.has(i.slug));
    for (const i of fresh.slice(0, n - picked.length)) {
      seen.add(i.slug);
      picked.push({ slug: i.slug, title: i.title, source });
    }
    return fresh.length;
  };

  let { newReleasesDone, browsePage } = progress;
  if (!newReleasesDone) {
    take(await fetchNewReleases(), "new-releases");
    newReleasesDone = true;
    log.info(`selection: ${picked.length} games from New Releases`);
  }

  for (let i = 0; picked.length < n && i < MAX_PAGES_PER_RUN; i++) {
    const items = await fetchBrowsePage(browsePage);
    if (!items.length) break;
    const before = picked.length;
    const fresh = take(items, "browse");
    log.info(`selection: browse page ${browsePage} → ${picked.length - before} new games`);
    // Move the cursor only once a page is fully consumed; otherwise resume from it next run.
    if (picked.length - before === fresh) browsePage++;
    else break;
  }

  db.transaction((tx) => {
    tx.update(dailyProgress).set({ newReleasesDone, browsePage }).where(eq(dailyProgress.day, day)).run();
    for (const g of picked) {
      tx.insert(processedGames).values({ day, slug: g.slug, source: g.source, runId }).onConflictDoNothing().run();
    }
  });
  return picked;
}

export function markProcessed(slug: string, status: "ok" | "failed") {
  db.update(processedGames)
    .set({ status })
    .where(and(eq(processedGames.day, today()), eq(processedGames.slug, slug)))
    .run();
}
