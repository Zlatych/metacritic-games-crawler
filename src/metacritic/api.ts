import { z } from "zod";
import { config } from "../config";
import { getJson } from "./http";

/**
 * Metacritic's site is a Nuxt app backed by a public JSON API (backend.metacritic.com).
 * We call the same endpoints the site uses instead of parsing rendered HTML — faster and far less brittle.
 */
const API = "https://backend.metacritic.com";
const IMG = "https://www.metacritic.com/a/img/catalog";

const nullish = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? null);

const finderItem = z.object({ id: z.number(), slug: z.string(), title: z.string() });
const finderResponse = z.object({ data: z.object({ items: z.array(finderItem) }) });
export type ListedGame = z.infer<typeof finderItem>;

const image = z.object({ typeName: nullish(z.string()), bucketPath: nullish(z.string()) });
const scoreSummary = z.object({
  score: nullish(z.number()),
  reviewCount: nullish(z.number()),
  sentiment: nullish(z.string()),
});

const product = z.object({
  data: z.object({
    item: z.object({
      id: z.number(),
      slug: z.string(),
      title: z.string(),
      description: nullish(z.string()),
      releaseDate: nullish(z.string()),
      rating: nullish(z.string()),
      criticScoreSummary: nullish(scoreSummary),
      genres: nullish(z.array(z.object({ name: z.string() }))),
      images: nullish(z.array(image)),
      video: nullish(z.object({ title: nullish(z.string()), embedUrl: nullish(z.string()) })),
      production: nullish(
        z.object({ companies: nullish(z.array(z.object({ typeName: nullish(z.string()), name: z.string() }))) }),
      ),
      platforms: nullish(
        z.array(
          z.object({
            name: z.string(),
            slug: z.string(),
            isLeadPlatform: nullish(z.boolean()),
            releaseDate: nullish(z.string()),
            criticScoreSummary: nullish(scoreSummary),
          }),
        ),
      ),
    }),
  }),
});

const statsResponse = z.object({ data: z.object({ item: scoreSummary }) });

const review = z.object({
  quote: nullish(z.string()),
  score: nullish(z.number()),
  date: nullish(z.string()),
  author: nullish(z.string()),
  publicationName: nullish(z.string()),
  platform: nullish(z.string()),
});
const reviewsResponse = z.object({ data: z.object({ totalResults: z.number(), items: z.array(review) }) });
export type Review = z.infer<typeof review> & { kind: "critic" | "user" };

export type PlatformInfo = {
  name: string;
  slug: string;
  position: number;
  isLead: boolean;
  releaseDate: string | null;
  metascore: number | null;
  criticCount: number;
  userscore: number | null;
  userCount: number;
};

export type GameDetails = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  developer: string | null;
  publisher: string | null;
  genres: string[];
  releaseDate: string | null;
  rating: string | null;
  videoUrl: string | null;
  videoTitle: string | null;
  metascore: number | null;
  userscore: number | null;
  criticReviewCount: number;
  userReviewCount: number;
  platforms: PlatformInfo[];
  criticReviews: Review[];
  userReviews: Review[];
};

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

/** "New Releases" carousel on https://www.metacritic.com/game/ (20 items). */
export async function fetchNewReleases(): Promise<ListedGame[]> {
  const url = `${API}/finder/metacritic/web?${qs({
    componentName: "new-releases-carousel",
    componentType: "ProductList",
    sortBy: "-releaseDate",
    metaScoreMin: 1,
    offset: 0,
    limit: 20,
    mcoTypeId: 13,
  })}`;
  return finderResponse.parse(await getJson(url)).data.items;
}

export const BROWSE_PAGE_SIZE = 24;

/** "See All" — https://www.metacritic.com/browse/game/all/all/all-time/new/?page=N */
export async function fetchBrowsePage(page: number): Promise<ListedGame[]> {
  const url = `${API}/finder/metacritic/web?${qs({
    sortBy: "-releaseDate",
    productType: "games",
    page,
    releaseYearMin: 1958,
    releaseYearMax: new Date().getFullYear() + 1,
    offset: (page - 1) * BROWSE_PAGE_SIZE,
    limit: BROWSE_PAGE_SIZE,
  })}`;
  return finderResponse.parse(await getJson(url)).data.items;
}

async function fetchUserStats(slug: string, platform: string) {
  const url = `${API}/reviews/metacritic/user/games/${slug}/platform/${platform}/stats/web`;
  const { score, reviewCount, sentiment } = statsResponse.parse(await getJson(url)).data.item;
  // Below Metacritic's minimum review count the score is "tbd": the API returns score 0 and no sentiment.
  return { userscore: sentiment && score != null ? score : null, userCount: reviewCount ?? 0 };
}

async function fetchReviews(kind: "critic" | "user", slug: string, platform: string, limit: number): Promise<Review[]> {
  const url = `${API}/reviews/metacritic/${kind}/games/${slug}/platform/${platform}/web?${qs({
    offset: 0,
    limit,
    filterBySentiment: "all",
    sort: "date",
  })}`;
  const { items } = reviewsResponse.parse(await getJson(url)).data;
  return items.filter((r) => r.quote?.trim()).map((r) => ({ ...r, kind }));
}

function bestMetascore(platforms: PlatformInfo[]): number | null {
  const scores = platforms.map((p) => p.metascore).filter((s): s is number => s != null);
  return scores.length ? Math.max(...scores) : null;
}

export async function fetchGameDetails(slug: string): Promise<GameDetails> {
  const url = `${API}/games/metacritic/${slug}/web?${qs({ componentName: "product", componentType: "Product" })}`;
  const item = product.parse(await getJson(url)).data.item;

  const companies = item.production?.companies ?? [];
  const namesOf = (type: string) =>
    companies
      .filter((c) => c.typeName === type)
      .map((c) => c.name)
      .join(", ") || null;

  const images = item.images ?? [];
  const cover = images.find((i) => i.typeName === "cardImage") ?? images.find((i) => i.typeName === "mainImage") ?? images[0];

  const rawPlatforms = item.platforms ?? [];
  const platforms: PlatformInfo[] = await Promise.all(
    rawPlatforms.map(async (p, position) => ({
      name: p.name,
      slug: p.slug,
      position,
      isLead: p.isLeadPlatform ?? false,
      releaseDate: p.releaseDate,
      metascore: p.criticScoreSummary?.score ?? null,
      criticCount: p.criticScoreSummary?.reviewCount ?? 0,
      ...(await fetchUserStats(item.slug, p.slug)),
    })),
  );

  // Reviews: from the platforms with the most reviews (keeps request count bounded for multi-platform titles).
  const top = (key: "criticCount" | "userCount") =>
    [...platforms]
      .filter((p) => p[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .slice(0, config.MC_REVIEW_PLATFORMS);
  const limit = config.MC_REVIEWS_PER_PLATFORM;
  const [criticReviews, userReviews] = await Promise.all([
    Promise.all(top("criticCount").map((p) => fetchReviews("critic", item.slug, p.slug, limit))).then((r) => r.flat()),
    Promise.all(top("userCount").map((p) => fetchReviews("user", item.slug, p.slug, limit))).then((r) => r.flat()),
  ]);

  // Game-level userscore mirrors Metascore: the lead platform, else the platform with the most user reviews.
  const lead = platforms.find((p) => p.isLead && p.userscore != null);
  const mostReviewed = [...platforms].filter((p) => p.userscore != null).sort((a, b) => b.userCount - a.userCount)[0];

  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    description: item.description?.trim() || null,
    coverUrl: cover?.bucketPath ? `${IMG}${cover.bucketPath}` : null,
    developer: namesOf("Developer"),
    publisher: namesOf("Publisher"),
    genres: (item.genres ?? []).map((g) => g.name),
    releaseDate: item.releaseDate,
    rating: item.rating,
    videoUrl: item.video?.embedUrl ?? null,
    videoTitle: item.video?.title ?? null,
    metascore: item.criticScoreSummary?.score ?? bestMetascore(platforms),
    userscore: (lead ?? mostReviewed)?.userscore ?? null,
    criticReviewCount: platforms.reduce((s, p) => s + p.criticCount, 0),
    userReviewCount: platforms.reduce((s, p) => s + p.userCount, 0),
    platforms,
    criticReviews,
    userReviews,
  };
}
