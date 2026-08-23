import { analyzeApp } from "../shared/analysis";
import type { AppDetail, OpportunityRow, ReviewItem } from "../shared/types";
import { chineseName, chineseOneLiner, chineseReview, hasForeignScript } from "../shared/translate";
import { fetchReviews } from "./apple";

export async function loadAppDetail(env: Env, id: string): Promise<AppDetail | null> {
  const appRow = await env.DB.prepare("SELECT * FROM apps WHERE id = ?").bind(id).first<{
    id: string;
    name: string;
    artist_id: string | null;
    artist_name: string;
    icon_url: string | null;
    description: string | null;
    one_liner: string | null;
    genre_name: string | null;
    formatted_price: string | null;
    track_view_url: string | null;
  }>();
  if (!appRow) return null;

  const opp = await env.DB.prepare(
    "SELECT * FROM opportunities WHERE app_id = ? ORDER BY score DESC LIMIT 1",
  ).bind(id).first<{
    country: string;
    rank: number;
    genre_id: string;
    rating: number | null;
    rating_count: number | null;
  }>();

  const positions = await env.DB.prepare(
    `SELECT r.country, r.chart, r.genre_id AS genreId, r.rank, m.rating, m.rating_count AS ratingCount
     FROM chart_ranks r
     LEFT JOIN app_metrics m
       ON m.app_id = r.app_id AND m.country = r.country AND m.snapshot_date = r.snapshot_date
     WHERE r.app_id = ?
       AND r.snapshot_date = (SELECT MAX(snapshot_date) FROM chart_ranks)
     ORDER BY r.rank ASC`,
  )
    .bind(id)
    .all<{
      country: string;
      chart: OpportunityRow["chart"];
      genreId: string;
      rank: number;
      rating: number | null;
      ratingCount: number | null;
    }>();

  const history = await env.DB.prepare(
    `SELECT snapshot_date AS date, country, chart, genre_id AS genreId, rank
     FROM chart_ranks WHERE app_id = ? ORDER BY snapshot_date DESC, rank ASC LIMIT 40`,
  )
    .bind(id)
    .all<{ date: string; country: string; chart: string; genreId: string; rank: number }>();

  const country = opp?.country || positions.results?.[0]?.country || "us";
  const stored = await env.DB.prepare(
    `SELECT rating, title, content, author FROM app_reviews
     WHERE app_id = ? AND country = ?
     ORDER BY rating ASC LIMIT 20`,
  )
    .bind(id, country)
    .all<{ rating: number | null; title: string; content: string; author: string }>();

  function toZhReview(row: { rating: number | null; title: string; content: string; author: string }): ReviewItem {
    const titleZh = chineseReview(row.title);
    const contentZh = chineseReview(row.content);
    return {
      rating: row.rating,
      title: titleZh || row.title,
      content: contentZh || row.content,
      titleOriginal: hasForeignScript(row.title) ? row.title : null,
      contentOriginal: hasForeignScript(row.content) ? row.content : null,
      author: row.author,
      updated: null,
    };
  }

  let reviews: AppDetail["reviews"] = (stored.results ?? []).map(toZhReview);
  if (reviews.length === 0) {
    try {
      reviews = (await fetchReviews(id, country))
        .slice()
        .sort((a, b) => (a.rating ?? 5) - (b.rating ?? 5))
        .map((row) => toZhReview(row));
    } catch {
      reviews = [];
    }
  }

  const analysis = analyzeApp({
    name: appRow.name,
    country,
    rank: opp?.rank || positions.results?.[0]?.rank || 0,
    genreId: opp?.genre_id || positions.results?.[0]?.genreId || "6002",
    rating: opp?.rating ?? null,
    ratingCount: opp?.rating_count ?? null,
    reviews,
  });

  const detail: AppDetail = {
    app: {
      id: appRow.id,
      name: appRow.name,
      nameZh: chineseName(appRow.name, opp?.genre_id, appRow.description),
      artistName: appRow.artist_name,
      artistId: appRow.artist_id,
      iconUrl: appRow.icon_url,
      description: appRow.description,
      oneLiner: chineseOneLiner({
        name: appRow.name,
        oneLiner: appRow.one_liner,
        description: appRow.description,
        genreId: opp?.genre_id,
        country,
        rank: opp?.rank,
      }),
      genreName: appRow.genre_name,
      formattedPrice: appRow.formatted_price,
      trackViewUrl: appRow.track_view_url,
    },
    positions: positions.results ?? [],
    history: history.results ?? [],
    reviews,
    analysis,
    ai: null,
  };

  try {
    const cached = await env.DB.prepare(
      "SELECT markdown, created_at AS createdAt FROM ai_analyses WHERE app_id = ?",
    )
      .bind(id)
      .first<{ markdown: string; createdAt: string }>();
    if (cached) detail.ai = { markdown: cached.markdown, createdAt: cached.createdAt };
  } catch {
    detail.ai = null;
  }

  return detail;
}
