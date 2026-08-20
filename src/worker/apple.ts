import { CHARTS, COUNTRIES, GENRES, type ChartId } from "../shared/catalog";
import type { ReviewItem } from "../shared/types";

const APPLE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export type ChartEntry = {
  appId: string;
  name: string;
  artistName: string;
  artistId: string | null;
  bundleId: string | null;
  iconUrl: string | null;
  genreId: string;
  genreName: string;
  summary: string;
  country: string;
  chart: ChartId;
  rank: number;
};

export type LookupApp = {
  appId: string;
  name: string;
  artistName: string;
  artistId: string | null;
  bundleId: string | null;
  iconUrl: string | null;
  genreId: string | null;
  genreName: string | null;
  description: string | null;
  formattedPrice: string | null;
  trackViewUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": APPLE_UA, Accept: "application/json" },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`${response.status} ${url}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function labelOf(value: unknown): string {
  if (value && typeof value === "object" && "label" in value) {
    const label = (value as { label?: unknown }).label;
    if (typeof label === "string") return label;
  }
  return "";
}

function attr(value: unknown, key: string): string | null {
  if (value && typeof value === "object" && "attributes" in value) {
    const attributes = (value as { attributes?: Record<string, unknown> }).attributes;
    const found = attributes?.[key];
    return typeof found === "string" ? found : null;
  }
  return null;
}

function parseArtistId(href: string | null): string | null {
  if (!href) return null;
  const match = href.match(/id(\d+)/);
  return match?.[1] ?? null;
}

export async function fetchChart(input: {
  country: string;
  chart: ChartId;
  genreId: string;
  limit?: number;
}): Promise<ChartEntry[]> {
  const chart = CHARTS.find((item) => item.id === input.chart);
  if (!chart) return [];
  const limit = input.limit ?? 100;
  const url = `https://itunes.apple.com/${input.country}/rss/${chart.rss}/limit=${limit}/genre=${input.genreId}/json`;
  const json = (await fetchJson(url)) as { feed?: { entry?: unknown } } | null;
  const entries = asArray(json?.feed?.entry);
  const genreName = GENRES.find((item) => item.id === input.genreId)?.name ?? "";
  return entries.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const images = asArray(entry["im:image"]);
    const lastImage = images[images.length - 1];
    return {
      appId: attr(entry.id, "im:id") ?? "",
      name: labelOf(entry["im:name"]) || labelOf(entry.title),
      artistName: labelOf(entry["im:artist"]),
      artistId: parseArtistId(attr(entry["im:artist"], "href")),
      bundleId: attr(entry.id, "im:bundleId"),
      iconUrl: labelOf(lastImage) || null,
      genreId: attr(entry.category, "im:id") ?? input.genreId,
      genreName: attr(entry.category, "label") ?? genreName,
      summary: labelOf(entry.summary),
      country: input.country,
      chart: input.chart,
      rank: index + 1,
    };
  }).filter((item) => item.appId);
}

export async function lookupApps(ids: string[], country: string): Promise<LookupApp[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: LookupApp[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const url = `https://itunes.apple.com/lookup?id=${chunk.join(",")}&country=${country}`;
    const json = (await fetchJson(url)) as { results?: Array<Record<string, unknown>> } | null;
    for (const result of json?.results ?? []) {
      if (result.kind && result.kind !== "software") continue;
      const trackId = result.trackId;
      if (trackId == null) continue;
      const rating = result.averageUserRating;
      const count = result.userRatingCount;
      out.push({
        appId: String(trackId),
        name: String(result.trackName ?? ""),
        artistName: String(result.artistName ?? ""),
        artistId: result.artistId != null ? String(result.artistId) : null,
        bundleId: typeof result.bundleId === "string" ? result.bundleId : null,
        iconUrl:
          typeof result.artworkUrl100 === "string"
            ? result.artworkUrl100.replace("100x100", "256x256")
            : null,
        genreId: result.primaryGenreId != null ? String(result.primaryGenreId) : null,
        genreName: typeof result.primaryGenreName === "string" ? result.primaryGenreName : null,
        description: typeof result.description === "string" ? result.description.slice(0, 2000) : null,
        formattedPrice: typeof result.formattedPrice === "string" ? result.formattedPrice : null,
        trackViewUrl: typeof result.trackViewUrl === "string" ? result.trackViewUrl : null,
        rating: typeof rating === "number" ? rating : null,
        ratingCount: typeof count === "number" ? count : null,
      });
    }
  }
  return out;
}

export async function fetchReviews(appId: string, country: string): Promise<ReviewItem[]> {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
  const json = (await fetchJson(url)) as { feed?: { entry?: unknown } } | null;
  const entries = asArray(json?.feed?.entry);
  const reviews: ReviewItem[] = [];
  for (const raw of entries) {
    const entry = raw as Record<string, unknown>;
    const rating = labelOf(entry["im:rating"]);
    if (!rating) continue;
    reviews.push({
      rating: Number(rating) || null,
      title: labelOf(entry.title),
      content: labelOf(entry.content),
      author: labelOf((entry.author as { name?: unknown } | undefined)?.name) || labelOf(entry.author),
      updated: labelOf(entry.updated) || null,
    });
  }
  return reviews.slice(0, 20);
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function tokyoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const INGEST_JOBS = COUNTRIES.flatMap((country) =>
  CHARTS.flatMap((chart) =>
    GENRES.map((genre) => ({
      country: country.id,
      chart: chart.id,
      genreId: genre.id,
    })),
  ),
);
