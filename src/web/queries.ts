import { and, asc, count, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { gamePlatforms, games, letsplays, processedGames, runs, similarGames } from "../db/schema";
import { today } from "../lib/util";

export const SORTS = {
  metascore: "Metascore ↓",
  userscore: "User score ↓",
  newest: "Дата выхода ↓",
  title: "Название А–Я",
} as const;
export type SortKey = keyof typeof SORTS;

export type ListParams = { q?: string; platform?: string; sort?: SortKey; page?: number };
export const PAGE_SIZE = 36;

export function listGames({ q, platform, sort = "metascore", page = 1 }: ListParams) {
  const where: SQL[] = [];
  if (q?.trim()) where.push(sql`${games.title} like ${`%${q.trim().replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`);
  if (platform) {
    where.push(
      sql`exists (select 1 from ${gamePlatforms} gp where gp.game_id = ${games.id} and gp.name = ${platform})`,
    );
  }

  // With a platform filter, rating sort uses that platform's own score.
  const platformScore = (col: "metascore" | "userscore") =>
    sql`(select gp.${sql.raw(col)} from ${gamePlatforms} gp where gp.game_id = ${games.id} and gp.name = ${platform})`;
  const nullsLast = (expr: SQL | typeof games.metascore | typeof games.userscore) => [sql`${expr} is null`, desc(expr)];
  const order = {
    metascore: nullsLast(platform ? platformScore("metascore") : games.metascore),
    userscore: nullsLast(platform ? platformScore("userscore") : games.userscore),
    newest: [desc(games.releaseDate)],
    title: [asc(games.title)],
  }[sort];

  const filter = where.length ? and(...where) : undefined;
  const total = db.select({ n: count() }).from(games).where(filter).get()?.n ?? 0;
  const rows = db
    .select()
    .from(games)
    .where(filter)
    .orderBy(...order, asc(games.title))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .all();

  const platformsByGame = new Map<number, (typeof gamePlatforms.$inferSelect)[]>();
  if (rows.length) {
    const ps = db
      .select()
      .from(gamePlatforms)
      .where(inArray(gamePlatforms.gameId, rows.map((r) => r.id)))
      .orderBy(asc(gamePlatforms.position))
      .all();
    for (const p of ps) platformsByGame.set(p.gameId, [...(platformsByGame.get(p.gameId) ?? []), p]);
  }
  return { total, items: rows.map((g) => ({ ...g, platforms: platformsByGame.get(g.id) ?? [] })) };
}

export type ListedGameRow = ReturnType<typeof listGames>["items"][number];

export function allPlatforms(): string[] {
  return db
    .selectDistinct({ name: gamePlatforms.name })
    .from(gamePlatforms)
    .orderBy(asc(gamePlatforms.name))
    .all()
    .map((r) => r.name);
}

export function getGame(slug: string) {
  const game = db.select().from(games).where(eq(games.slug, slug)).get();
  if (!game) return null;
  const platforms = db.select().from(gamePlatforms).where(eq(gamePlatforms.gameId, game.id)).orderBy(asc(gamePlatforms.position)).all();
  const letsplay = db.select().from(letsplays).where(eq(letsplays.gameId, game.id)).get() ?? null;
  const similar = db
    .select({ slug: games.slug, title: games.title, coverUrl: games.coverUrl, metascore: games.metascore, score: similarGames.score })
    .from(similarGames)
    .innerJoin(games, eq(games.id, similarGames.similarId))
    .where(eq(similarGames.gameId, game.id))
    .orderBy(desc(similarGames.score))
    .all();
  return { ...game, platforms, letsplay, similar };
}

export type GameFull = NonNullable<ReturnType<typeof getGame>>;

export function serviceStats() {
  const n = (q: { n: number } | undefined) => q?.n ?? 0;
  return {
    games: n(db.select({ n: count() }).from(games).get()),
    withCriticSummary: n(db.select({ n: count() }).from(games).where(isNotNull(games.criticSummary)).get()),
    withUserSummary: n(db.select({ n: count() }).from(games).where(isNotNull(games.userSummary)).get()),
    letsplaysOk: n(db.select({ n: count() }).from(letsplays).where(eq(letsplays.status, "ok")).get()),
    processedToday: n(db.select({ n: count() }).from(processedGames).where(eq(processedGames.day, today())).get()),
    recentRuns: db.select().from(runs).orderBy(desc(runs.id)).limit(10).all(),
  };
}
