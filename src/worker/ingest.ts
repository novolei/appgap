import { buildOneLiner } from "../shared/oneLiner";
import { buildHistoryIndex, classifyOpportunities, type AppSnapshot, type MetricSnapshot, type RankRecord } from "../shared/classify";
import type { LensId } from "../shared/catalog";
import { fetchChart, INGEST_JOBS, lookupApps, mapPool, tokyoDate, type ChartEntry, type LookupApp } from "./apple";

export type IngestStats = {
  date: string;
  charts: number;
  apps: number;
  opportunities: number;
  source: string;
};

async function batchRun(db: D1Database, statements: D1PreparedStatement[]) {
  const chunkSize = 40;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await db.batch(statements.slice(i, i + chunkSize));
  }
}

function mergeApp(entry: ChartEntry, lookup: LookupApp | undefined): AppSnapshot & {
  artistId: string | null;
  bundleId: string | null;
  genreId: string;
  genreName: string;
  description: string | null;
  formattedPrice: string | null;
} {
  return {
    id: entry.appId,
    name: entry.name || lookup?.name || "Unknown",
    artistName: lookup?.artistName || entry.artistName,
    artistId: lookup?.artistId || entry.artistId,
    bundleId: lookup?.bundleId || entry.bundleId,
    iconUrl: lookup?.iconUrl || entry.iconUrl,
    genreId: lookup?.genreId || entry.genreId,
    genreName: lookup?.genreName || entry.genreName,
    description: lookup?.description || entry.summary || null,
    formattedPrice: lookup?.formattedPrice ?? null,
    trackViewUrl: lookup?.trackViewUrl ?? null,
    oneLiner: "",
  };
}

export async function runIngest(env: Env, input: { source: string }): Promise<IngestStats> {
  const started = new Date().toISOString();
  const date = tokyoDate();
  const inserted = await env.DB.prepare(
    "INSERT INTO ingest_runs (source, started_at, status) VALUES (?, ?, 'running')",
  )
    .bind(input.source, started)
    .run();
  const runId = inserted.meta.last_row_id;

  try {
    const chartResults = await mapPool(INGEST_JOBS, 6, (job) => fetchChart(job));
    const entries = chartResults.flat();
    const idsByCountry = new Map<string, Set<string>>();
    for (const entry of entries) {
      const set = idsByCountry.get(entry.country) ?? new Set();
      set.add(entry.appId);
      idsByCountry.set(entry.country, set);
    }

    const lookups = new Map<string, LookupApp>();
    for (const [country, ids] of idsByCountry) {
      const found = await lookupApps([...ids], country);
      for (const item of found) {
        const key = `${country}:${item.appId}`;
        lookups.set(key, item);
        if (!lookups.has(item.appId)) lookups.set(item.appId, item);
      }
    }

    const apps = new Map<string, ReturnType<typeof mergeApp>>();
    const metrics: MetricSnapshot[] = [];
    const metricKeys = new Set<string>();
    const ranks: RankRecord[] = [];

    for (const entry of entries) {
      const lookup = lookups.get(`${entry.country}:${entry.appId}`) ?? lookups.get(entry.appId);
      const merged = mergeApp(entry, lookup);
      const existing = apps.get(merged.id);
      if (existing) {
        const cjk = (value: string) => /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(value);
        if (cjk(merged.name) && !cjk(existing.name)) existing.name = merged.name;
        if (!existing.trackViewUrl) existing.trackViewUrl = merged.trackViewUrl;
        if (!existing.iconUrl) existing.iconUrl = merged.iconUrl;
        if (!existing.description) existing.description = merged.description;
      } else {
        apps.set(merged.id, merged);
      }
      ranks.push({
        appId: merged.id,
        country: entry.country,
        chart: entry.chart,
        genreId: entry.genreId,
        rank: entry.rank,
        date,
      });
      const metricKey = `${date}|${entry.country}|${merged.id}`;
      if (!metricKeys.has(metricKey)) {
        metricKeys.add(metricKey);
        metrics.push({
          appId: merged.id,
          country: entry.country,
          rating: lookup?.rating ?? null,
          ratingCount: lookup?.ratingCount ?? null,
        });
      }
    }

    const appInsert = env.DB.prepare(
      `INSERT OR REPLACE INTO apps (id, name, artist_id, artist_name, bundle_id, icon_url, genre_id, genre_name, description, one_liner, formatted_price, track_view_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await batchRun(
      env.DB,
      [...apps.values()].map((app) =>
        appInsert.bind(
          app.id,
          app.name,
          app.artistId,
          app.artistName,
          app.bundleId,
          app.iconUrl,
          app.genreId,
          app.genreName,
          app.description,
          app.oneLiner,
          app.formattedPrice,
          app.trackViewUrl,
          started,
        ),
      ),
    );

    await env.DB.prepare("DELETE FROM chart_ranks WHERE snapshot_date = ?").bind(date).run();
    const rankInsert = env.DB.prepare(
      "INSERT INTO chart_ranks (snapshot_date, country, chart, genre_id, rank, app_id) VALUES (?, ?, ?, ?, ?, ?)",
    );
    await batchRun(
      env.DB,
      ranks.map((row) => rankInsert.bind(date, row.country, row.chart, row.genreId, row.rank, row.appId)),
    );

    await env.DB.prepare("DELETE FROM app_metrics WHERE snapshot_date = ?").bind(date).run();
    const metricInsert = env.DB.prepare(
      "INSERT INTO app_metrics (snapshot_date, country, app_id, rating, rating_count) VALUES (?, ?, ?, ?, ?)",
    );
    await batchRun(
      env.DB,
      metrics.map((row) => metricInsert.bind(date, row.country, row.appId, row.rating, row.ratingCount)),
    );

    const opportunityCount = await rebuildOpportunities(env, date);

    const stats: IngestStats = {
      date,
      charts: entries.length,
      apps: apps.size,
      opportunities: opportunityCount,
      source: input.source,
    };
    if (runId != null) {
      await env.DB.prepare(
        "UPDATE ingest_runs SET finished_at = ?, status = 'success', stats = ? WHERE id = ?",
      )
        .bind(new Date().toISOString(), JSON.stringify(stats), runId)
        .run();
    }
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId != null) {
      await env.DB.prepare(
        "UPDATE ingest_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?",
      )
        .bind(new Date().toISOString(), message.slice(0, 1000), runId)
        .run();
    }
    throw error;
  }
}

export async function rebuildOpportunities(env: Env, date: string): Promise<number> {
  const appRows = await env.DB.prepare(
    `SELECT id, name, artist_name AS artistName, icon_url AS iconUrl, description,
            track_view_url AS trackViewUrl, one_liner AS oneLiner, genre_id AS genreId
     FROM apps`,
  ).all<AppSnapshot & { description?: string | null; genreId?: string | null }>();
  const rankRows = await env.DB.prepare(
    `SELECT snapshot_date AS date, country, chart, genre_id AS genreId, rank, app_id AS appId
     FROM chart_ranks WHERE snapshot_date >= date(?, '-30 days')`,
  )
    .bind(date)
    .all<RankRecord>();
  const metricRows = await env.DB.prepare(
    `SELECT app_id AS appId, country, rating, rating_count AS ratingCount
     FROM app_metrics WHERE snapshot_date = ?`,
  )
    .bind(date)
    .all<MetricSnapshot>();

  const apps = (appRows.results ?? []).map((app) => {
    const primary = (rankRows.results ?? [])
      .filter((row) => row.appId === app.id && row.date === date)
      .sort((a, b) => a.rank - b.rank)[0];
    const oneLiner = buildOneLiner({
      name: app.name,
      description: app.description,
      country: primary?.country,
      rank: primary?.rank,
      genreId: primary?.genreId ?? app.genreId,
    });
    return { ...app, oneLiner };
  });
  const descriptions = new Map((appRows.results ?? []).map((app) => [app.id, app.description]));
  const history = buildHistoryIndex(rankRows.results ?? [], date);
  const opportunities = classifyOpportunities({
    today: date,
    apps,
    ranks: rankRows.results ?? [],
    metrics: metricRows.results ?? [],
    history,
    oneLinerFor: (app, primary) =>
      buildOneLiner({
        name: app.name,
        description: descriptions.get(app.id),
        country: primary.country,
        rank: primary.rank,
        genreId: primary.genreId,
      }),
  });

  await env.DB.prepare("DELETE FROM opportunities").run();
  const oppInsert = env.DB.prepare(
    `INSERT INTO opportunities (lens, app_id, score, country, chart, genre_id, rank, rating, rating_count, rank_change, consecutive_days, one_liner, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await batchRun(
    env.DB,
    opportunities.map((row) =>
      oppInsert.bind(
        row.lens,
        row.appId,
        row.score,
        row.country,
        row.chart,
        row.genreId,
        row.rank,
        row.rating,
        row.ratingCount,
        row.rankChange,
        row.consecutiveDays,
        row.oneLiner,
        JSON.stringify({ positions: row.positions, reasons: row.reasons }),
      ),
    ),
  );
  const oneLinerUpdate = env.DB.prepare("UPDATE apps SET one_liner = ? WHERE id = ?");
  await batchRun(
    env.DB,
    apps.map((app) => oneLinerUpdate.bind(app.oneLiner, app.id)),
  );
  return opportunities.length;
}

export async function latestIngest(env: Env) {
  return env.DB.prepare(
    "SELECT started_at, finished_at, status, stats, error FROM ingest_runs ORDER BY id DESC LIMIT 1",
  ).first<{
    started_at: string;
    finished_at: string | null;
    status: string;
    stats: string | null;
    error: string | null;
  }>();
}

export async function isIngestLocked(env: Env): Promise<boolean> {
  const latest = await latestIngest(env);
  if (!latest || latest.status !== "running") return false;
  const started = Date.parse(latest.started_at);
  return Number.isFinite(started) && Date.now() - started < 12 * 60 * 1000;
}

export async function lensCounts(env: Env): Promise<Record<LensId, number>> {
  const rows = await env.DB.prepare(
    "SELECT lens, COUNT(*) AS count FROM opportunities GROUP BY lens",
  ).all<{ lens: LensId; count: number }>();
  const counts: Record<LensId, number> = {
    money_hated: 0,
    indie_viral: 0,
    geo_gap: 0,
    local_king: 0,
  };
  for (const row of rows.results ?? []) {
    counts[row.lens] = row.count;
  }
  return counts;
}
