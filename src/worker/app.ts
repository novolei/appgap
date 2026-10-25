import { Hono } from "hono";
import { isCountryId, LENSES, lensById, type LensId, type PoolId } from "../shared/catalog";
import type { OpportunityListResponse, OpportunityRow, RankPosition } from "../shared/types";
import { chineseName, chineseOneLiner, localizeRegions } from "../shared/translate";
import { readAppAnalysis, generateAppAnalysis } from "./app-ai";
import { AnalysisError } from "./analysis-cache";
import { loadAppDetail } from "./detail";
import type { RuntimeEnv } from "./env";
import { isActivelyIngesting } from "./ingestStatus";
import {
  isIngestLocked,
  latestIngest,
  latestSuccessfulIngest,
  lensCounts,
  rebuildOpportunities,
  runIngest,
  snapshotDateFromStats,
} from "./ingest";

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

function uniqueByApp(rows: OppRecord[]): OppRecord[] {
  const seen = new Map<string, OppRecord>();
  for (const row of rows) {
    const prev = seen.get(row.app_id);
    if (!prev || row.rank < prev.rank || (row.rank === prev.rank && row.score > prev.score)) {
      seen.set(row.app_id, row);
    }
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank || b.score - a.score).slice(0, 80);
}

const app = new Hono<{ Bindings: RuntimeEnv }>();

app.get("/api/health", async (context) => {
  await context.env.DB.prepare("SELECT 1").first();
  return context.json({ ok: true });
});

app.get("/api/meta", async (context) => {
  const latest = await latestIngest(context.env);
  const lastOk = await latestSuccessfulIngest(context.env);
  const counts = await lensCounts(context.env);
  return context.json({
    lastSuccessAt: lastOk?.finished_at ?? null,
    lastStatus: latest?.status ?? null,
    snapshotDate: snapshotDateFromStats(lastOk?.stats),
    ingesting: isActivelyIngesting(latest),
    counts,
  });
});

app.get("/api/opportunities", async (context) => {
  const lens = (context.req.query("lens") || "paid_tools") as LensId;
  if (!LENSES.some((item) => item.id === lens)) {
    return context.json({ error: "unknown lens" }, 400);
  }
  const latest = await latestIngest(context.env);
  const lastOk = await latestSuccessfulIngest(context.env);
  const country = context.req.query("country") || "";
  if (country && !isCountryId(country)) {
    return context.json({ error: "unknown country" }, 400);
  }
  let items: OpportunityRow[];
  if (country) {
    const rows = await context.env.DB.prepare(
      `SELECT o.lens, o.app_id, o.score,
              cr.country AS country, o.chart AS chart, o.genre_id AS genre_id, cr.rank AS rank,
              COALESCE(m.rating, o.rating) AS rating,
              COALESCE(m.rating_count, o.rating_count) AS rating_count,
              o.rank_change, o.consecutive_days, o.one_liner, o.payload,
              a.name, a.artist_name, a.icon_url, a.track_view_url, a.description
       FROM opportunities o
       JOIN apps a ON a.id = o.app_id
       JOIN (
         SELECT app_id, country, chart, genre_id, MIN(rank) AS rank
         FROM chart_ranks
         WHERE country = ?
           AND snapshot_date = (SELECT MAX(snapshot_date) FROM chart_ranks)
         GROUP BY app_id, country, chart, genre_id
       ) cr ON cr.app_id = o.app_id AND cr.chart = o.chart AND cr.genre_id = o.genre_id
       LEFT JOIN app_metrics m
         ON m.app_id = o.app_id AND m.country = cr.country
        AND m.snapshot_date = (SELECT MAX(snapshot_date) FROM chart_ranks)
       WHERE o.lens = ?
       ORDER BY cr.rank ASC, o.score DESC
       LIMIT 80`,
    )
      .bind(country, lens)
      .all<OppRecord>();
    items = uniqueByApp(rows.results ?? []).map(mapRow);
  } else {
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
    items = (rows.results ?? []).map(mapRow);
  }
  const response: OpportunityListResponse = {
    lens,
    hint: lensById(lens).hint,
    snapshotDate: snapshotDateFromStats(lastOk?.stats),
    ingesting: isActivelyIngesting(latest),
    items,
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
  const detail = await loadAppDetail(context.env, context.req.param("id"));
  if (!detail) return context.json({ error: "not found" }, 404);
  detail.ai = (await readAppAnalysis(context.env, context.req.param("id"))).analysis;
  return context.json(detail);
});

app.post("/api/apps/:id/analyze", async (context) => {
  try {
    return context.json(await generateAppAnalysis(context.env, context.req.param("id")));
  } catch (error) {
    if (error instanceof AnalysisError) return context.json({ error: error.message }, error.status);
    console.error("App Store analysis failed", error instanceof Error ? error.message : "unknown");
    return context.json({ error: "分析未完成，未缓存不完整结果，请稍后重试。" }, 502);
  }
});

app.get("/api/pools", async (context) => {
  const rows = await context.env.DB.prepare("SELECT app_id AS appId, pool FROM pools").all<{
    appId: string;
    pool: PoolId;
  }>();
  const watch: string[] = [];
  const build: string[] = [];
  for (const row of rows.results ?? []) {
    if (row.appId.startsWith("steam:") !== (context.req.query("platform") === "steam")) continue;
    if (row.pool === "build") build.push(row.appId);
    else watch.push(row.appId);
  }
  return context.json({ watch, build });
});

app.post("/api/pools", async (context) => {
  const body: unknown = await context.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("appId" in body) || typeof body.appId !== "string" || !/^(steam:)?\d{1,20}$/.test(body.appId) || !("pool" in body)) return context.json({ error: "invalid pool request" }, 400);
  const appId = body.appId;
  if (body.pool === null) {
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
    return context.json({ ok: false, ingesting: true, error: "ingest already running" }, 409);
  }
  try {
    const stats = await runIngest(context.env, { source: "manual" });
    return context.json({ ok: true, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already running")) {
      return context.json({ ok: false, ingesting: true, error: message }, 409);
    }
    return context.json({ ok: false, error: message }, 502);
  }
});

export default app;
