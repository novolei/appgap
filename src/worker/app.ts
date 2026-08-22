import { Hono } from "hono";
import { analyzeApp } from "../shared/analysis";
import { LENSES, lensById, type LensId, type PoolId } from "../shared/catalog";
import type { AppDetail, OpportunityListResponse, OpportunityRow, RankPosition, ReviewItem } from "../shared/types";
import { chineseName, chineseOneLiner, chineseReview, hasForeignScript, localizeRegions } from "../shared/translate";
import { fetchReviews } from "./apple";
import { isIngestLocked, latestIngest, lensCounts, rebuildOpportunities, runIngest } from "./ingest";

type OppRecord = {
  lens: LensId;
  app_id: string;
  score: number;
  country: string;
  chart: OpportunityRow["chart"];
  genre_id: string;
  rank: number;
  rating: number | null;
  rating_count: number | null;
  rank_change: number | null;
  consecutive_days: number;
  one_liner: string | null;
  payload: string | null;
  name: string;
  artist_name: string;
  icon_url: string | null;
  track_view_url: string | null;
  description?: string | null;
};

function mapRow(row: OppRecord): OpportunityRow {
  let positions: RankPosition[] = [];
  let reasons: string[] = [];
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload) as { positions?: RankPosition[]; reasons?: string[] };
      positions = parsed.positions ?? [];
      reasons = parsed.reasons ?? [];
    } catch {
      positions = [];
    }
  }
  return {
    lens: row.lens,
    appId: row.app_id,
    name: row.name,
    nameZh: chineseName(row.name, row.genre_id, row.description),
    artistName: row.artist_name,
    iconUrl: row.icon_url,
    oneLiner: chineseOneLiner({
      name: row.name,
      oneLiner: localizeRegions(row.one_liner || ""),
      description: row.description,
      genreId: row.genre_id,
      country: row.country,
      rank: row.rank,
    }),
    country: row.country,
    chart: row.chart,
    genreId: row.genre_id,
    rank: row.rank,
    rating: row.rating,
    ratingCount: row.rating_count,
    rankChange: row.rank_change,
    consecutiveDays: row.consecutive_days ?? 1,
    trackViewUrl: row.track_view_url,
    score: row.score,
    positions,
    reasons,
  };
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/meta", async (context) => {
  const latest = await latestIngest(context.env);
  const lastOk = await context.env.DB.prepare(
    "SELECT finished_at, stats FROM ingest_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1",
  ).first<{ finished_at: string | null; stats: string | null }>();
  const counts = await lensCounts(context.env);
  let snapshotDate: string | null = null;
  const stats = lastOk?.stats || (latest?.status === "success" ? latest.stats : null);
  if (stats) {
    try {
      snapshotDate = (JSON.parse(stats) as { date?: string }).date ?? null;
    } catch {
      snapshotDate = null;
    }
  }
  return context.json({
    lastSuccessAt: lastOk?.finished_at ?? (latest?.status === "success" ? latest.finished_at : null),
    lastStatus: latest?.status ?? null,
    snapshotDate,
    ingesting: latest?.status === "running",
    counts,
  });
});

app.get("/api/opportunities", async (context) => {
  const lens = (context.req.query("lens") || "paid_tools") as LensId;
  if (!LENSES.some((item) => item.id === lens)) {
    return context.json({ error: "unknown lens" }, 400);
  }
  const latest = await latestIngest(context.env);
  const empty = await context.env.DB.prepare("SELECT COUNT(*) AS c FROM opportunities").first<{ c: number }>();
  if ((empty?.c ?? 0) === 0 && !(await isIngestLocked(context.env))) {
    context.executionCtx.waitUntil(
      runIngest(context.env, { source: "lazy" }).catch((error) => {
        console.error("lazy ingest failed", error);
      }),
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT o.*, a.name, a.artist_name, a.icon_url, a.track_view_url, a.description
     FROM opportunities o
     JOIN apps a ON a.id = o.app_id
     WHERE o.lens = ?
     ORDER BY o.score DESC, o.rank ASC
     LIMIT 80`,
  )
    .bind(lens)
    .all<OppRecord>();
  const response: OpportunityListResponse = {
    lens,
    hint: lensById(lens).hint,
    snapshotDate: latest?.status === "success" ? (JSON.parse(latest.stats || "{}") as { date?: string }).date ?? null : null,
    ingesting: latest?.status === "running" || ((empty?.c ?? 0) === 0),
    items: (rows.results ?? []).map(mapRow),
  };
  return context.json(response);
});

app.get("/api/apps", async (context) => {
  const ids = (context.req.query("ids") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (ids.length === 0) return context.json({ items: [] });
  const placeholders = ids.map(() => "?").join(",");
  const rows = await context.env.DB.prepare(
    `SELECT o.*, a.name, a.artist_name, a.icon_url, a.track_view_url, a.description
     FROM opportunities o
     JOIN apps a ON a.id = o.app_id
     WHERE o.app_id IN (${placeholders})
     ORDER BY o.score DESC`,
  )
    .bind(...ids)
    .all<OppRecord>();
  const seen = new Set<string>();
  const items = [];
  for (const row of rows.results ?? []) {
    if (seen.has(row.app_id)) continue;
    seen.add(row.app_id);
    items.push(mapRow(row));
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) {
    const more = await context.env.DB.prepare(
      `SELECT id AS app_id, name, artist_name, icon_url, track_view_url, one_liner, genre_id, description
       FROM apps WHERE id IN (${missing.map(() => "?").join(",")})`,
    )
      .bind(...missing)
      .all<{
        app_id: string;
        name: string;
        artist_name: string;
        icon_url: string | null;
        track_view_url: string | null;
        one_liner: string | null;
        genre_id: string | null;
        description: string | null;
      }>();
    for (const row of more.results ?? []) {
      items.push({
        lens: "money_hated",
        appId: row.app_id,
        name: row.name,
        nameZh: chineseName(row.name, row.genre_id, row.description),
        artistName: row.artist_name,
        iconUrl: row.icon_url,
        oneLiner: chineseOneLiner({
          name: row.name,
          oneLiner: row.one_liner,
          description: row.description,
          genreId: row.genre_id,
        }),
        country: "jp",
        chart: "grossing",
        genreId: row.genre_id || "6002",
        rank: 0,
        rating: null,
        ratingCount: null,
        rankChange: null,
        consecutiveDays: 1,
        trackViewUrl: row.track_view_url,
        score: 0,
        positions: [],
        reasons: [],
      } satisfies OpportunityRow);
    }
  }
  return context.json({ items });
});

app.get("/api/apps/:id", async (context) => {
  const id = context.req.param("id");
  const appRow = await context.env.DB.prepare("SELECT * FROM apps WHERE id = ?").bind(id).first<{
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
  if (!appRow) return context.json({ error: "not found" }, 404);

  const opp = await context.env.DB.prepare(
    "SELECT * FROM opportunities WHERE app_id = ? ORDER BY score DESC LIMIT 1",
  ).bind(id).first<{
    country: string;
    rank: number;
    genre_id: string;
    rating: number | null;
    rating_count: number | null;
  }>();

  const positions = await context.env.DB.prepare(
    `SELECT r.country, r.chart, r.genre_id AS genreId, r.rank, m.rating, m.rating_count AS ratingCount
     FROM chart_ranks r
     LEFT JOIN app_metrics m
       ON m.app_id = r.app_id AND m.country = r.country AND m.snapshot_date = r.snapshot_date
     WHERE r.app_id = ?
       AND r.snapshot_date = (SELECT MAX(snapshot_date) FROM chart_ranks)
     ORDER BY r.rank ASC`,
  )
    .bind(id)
    .all<{ country: string; chart: OpportunityRow["chart"]; genreId: string; rank: number; rating: number | null; ratingCount: number | null }>();

  const history = await context.env.DB.prepare(
    `SELECT snapshot_date AS date, country, chart, genre_id AS genreId, rank
     FROM chart_ranks WHERE app_id = ? ORDER BY snapshot_date DESC, rank ASC LIMIT 40`,
  )
    .bind(id)
    .all<{ date: string; country: string; chart: string; genreId: string; rank: number }>();

  const country = opp?.country || positions.results?.[0]?.country || "us";
  const stored = await context.env.DB.prepare(
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
  };
  return context.json(detail);
});

app.get("/api/pools", async (context) => {
  const rows = await context.env.DB.prepare("SELECT app_id AS appId, pool FROM pools").all<{
    appId: string;
    pool: PoolId;
  }>();
  const watch: string[] = [];
  const build: string[] = [];
  for (const row of rows.results ?? []) {
    if (row.pool === "build") build.push(row.appId);
    else watch.push(row.appId);
  }
  return context.json({ watch, build });
});

app.post("/api/pools", async (context) => {
  const body = await context.req.json<{ appId?: string; pool?: PoolId | null }>().catch(() => null);
  const appId = body?.appId?.trim();
  if (!appId) return context.json({ error: "missing appId" }, 400);
  if (!body?.pool) {
    await context.env.DB.prepare("DELETE FROM pools WHERE app_id = ?").bind(appId).run();
    return context.json({ ok: true });
  }
  if (body.pool !== "watch" && body.pool !== "build") {
    return context.json({ error: "bad pool" }, 400);
  }
  await context.env.DB.prepare("INSERT OR REPLACE INTO pools (app_id, pool, created_at) VALUES (?, ?, ?)").bind(
    appId,
    body.pool,
    new Date().toISOString(),
  ).run();
  return context.json({ ok: true });
});

app.post("/api/ingest", async (context) => {
  const secret = (context.env as Env & { INGEST_SECRET?: string }).INGEST_SECRET;
  const given = context.req.header("authorization")?.replace(/^Bearer\s+/i, "") || context.req.query("key");
  if (secret && given !== secret) {
    return context.json({ error: "unauthorized" }, 401);
  }
  if (context.req.query("rebuild") === "1") {
    const lastOk = await context.env.DB.prepare(
      "SELECT stats FROM ingest_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1",
    ).first<{ stats: string | null }>();
    let date: string | null = null;
    if (lastOk?.stats) {
      try {
        date = (JSON.parse(lastOk.stats) as { date?: string }).date ?? null;
      } catch {
        date = null;
      }
    }
    if (!date) {
      date =
        (
          await context.env.DB.prepare("SELECT MAX(snapshot_date) AS d FROM chart_ranks").first<{ d: string | null }>()
        )?.d ?? null;
    }
    if (!date) return context.json({ error: "no snapshot yet" }, 400);
    const count = await rebuildOpportunities(context.env, date, { reviews: false });
    return context.json({ ok: true, rebuilt: count, date });
  }
  if (await isIngestLocked(context.env)) {
    return context.json({ ok: true, ingesting: true });
  }
  const stats = await runIngest(context.env, { source: "manual" });
  return context.json({ ok: true, stats });
});

export default app;
