import { buildOneLiner } from "../shared/oneLiner";
import { buildHistoryIndex, classifyOpportunities, type AppSnapshot, type MetricSnapshot, type RankRecord } from "../shared/classify";
import type { LensId } from "../shared/catalog";
import type { DataEnv, Database, Statement } from "./env";
import { fetchChart, fetchReviews, INGEST_JOBS, lookupApps, mapPool, snapshotDate, type ChartEntry, type LookupApp } from "./apple";
import {
  isActivelyIngesting,
  isStaleRunning,
  type IngestRunRow,
} from "./ingestStatus";

export { snapshotDateFromStats } from "./ingestStatus";

const MIN_CHART_ROWS = 1000;
const OPPORTUNITY_COLUMNS =
  "lens, app_id, score, country, chart, genre_id, rank, rating, rating_count, rank_change, consecutive_days, one_liner, payload";

export type IngestStats = {
  date: string;
  charts: number;
  apps: number;
  opportunities: number;
  source: string;
};

async function batchRun(db: Database, statements: Statement[]) {
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

export async function runIngest(env: DataEnv, input: { source: string }): Promise<IngestStats> {
  await expireStaleIngest(env);
  if (await isIngestLocked(env)) {
    throw new Error("ingest already running");
  }
  const started = new Date().toISOString();
  const date = snapshotDate();
  const inserted = await env.DB.prepare(
    "INSERT INTO ingest_runs (source, started_at, status) VALUES (?, ?, 'running')",
  )
    .bind(input.source, started)
    .run().catch((error: unknown) => {
      if (String(error).includes("UNIQUE constraint failed: ingest_runs.status")) throw new Error("ingest already running");
      throw error;
    });
  const runId = inserted.meta.last_row_id;

  try {
    const chartResults = await mapPool(INGEST_JOBS, 6, async (job) => {
      try {
        return await fetchChart(job);
      } catch (error) {
        console.error("chart failed", job.country, job.chart, job.genreId, error);
        return [];
      }
    });
    const entries = chartResults.flat();
    const successfulFeeds = chartResults.filter((rows) => rows.length > 0).length;
    if (entries.length < MIN_CHART_ROWS || successfulFeeds < Math.ceil(INGEST_JOBS.length * 0.9)) {
      throw new Error(
        `Apple 榜单不完整（${entries.length} 条，${successfulFeeds}/${INGEST_JOBS.length} 份榜单）。已保留上一份快照。`,
      );
    }
    const idsByCountry = new Map<string, Set<string>>();
    for (const entry of entries) {
      const set = idsByCountry.get(entry.country) ?? new Set();
      set.add(entry.appId);
      idsByCountry.set(entry.country, set);
    }

    const lookups = new Map<string, LookupApp>();
    await mapPool([...idsByCountry], 3, async ([country, ids]) => {
      try {
        const found = await lookupApps([...ids], country);
        for (const item of found) {
          const key = `${country}:${item.appId}`;
          lookups.set(key, item);
          if (!lookups.has(item.appId)) lookups.set(item.appId, item);
        }
      } catch (error) {
        console.error("lookup country failed", country, error);
      }
    });

    const apps = new Map<string, ReturnType<typeof mergeApp>>();
    const metrics: MetricSnapshot[] = [];
    const metricKeys = new Set<string>();
    const ranks: RankRecord[] = [];

    for (const entry of entries) {
      const localLookup = lookups.get(`${entry.country}:${entry.appId}`);
      const lookup = localLookup ?? lookups.get(entry.appId);
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
          rating: localLookup?.rating ?? null,
          ratingCount: localLookup?.ratingCount ?? null,
        });
      }
    }

    await env.DB.batch(["apps_staging", "chart_ranks_staging", "app_metrics_staging"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    const appInsert = env.DB.prepare(
      `INSERT INTO apps_staging (id, name, artist_id, artist_name, bundle_id, icon_url, genre_id, genre_name, description, one_liner, formatted_price, track_view_url, updated_at)
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

    const rankInsert = env.DB.prepare(
      "INSERT INTO chart_ranks_staging (snapshot_date, country, chart, genre_id, rank, app_id) VALUES (?, ?, ?, ?, ?, ?)",
    );
    await batchRun(
      env.DB,
      ranks.map((row) => rankInsert.bind(date, row.country, row.chart, row.genreId, row.rank, row.appId)),
    );

    const metricInsert = env.DB.prepare(
      "INSERT INTO app_metrics_staging (snapshot_date, country, app_id, rating, rating_count) VALUES (?, ?, ?, ?, ?)",
    );
    await batchRun(
      env.DB,
      metrics.map((row) => metricInsert.bind(date, row.country, row.appId, row.rating, row.ratingCount)),
    );

    const opportunityCount = await rebuildOpportunities(env, date, { staged: true });

    const stats: IngestStats = {
      date,
      charts: entries.length,
      apps: apps.size,
      opportunities: opportunityCount,
      source: input.source,
    };
    if (runId != null) {
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO apps SELECT * FROM apps_staging"),
        env.DB.prepare("DELETE FROM chart_ranks WHERE snapshot_date = ?").bind(date),
        env.DB.prepare("INSERT INTO chart_ranks SELECT * FROM chart_ranks_staging"),
        env.DB.prepare("DELETE FROM app_metrics WHERE snapshot_date = ?").bind(date),
        env.DB.prepare("INSERT INTO app_metrics SELECT * FROM app_metrics_staging"),
        env.DB.prepare("DELETE FROM opportunities"),
        env.DB.prepare(`INSERT INTO opportunities (${OPPORTUNITY_COLUMNS}) SELECT ${OPPORTUNITY_COLUMNS} FROM opportunities_staging`),
        env.DB.prepare(
          "UPDATE ingest_runs SET finished_at = ?, status = 'success', stats = ? WHERE id = ?",
        ).bind(new Date().toISOString(), JSON.stringify(stats), runId),
      ]);
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

export async function rebuildOpportunities(env: DataEnv, date: string, options: { reviews?: boolean; staged?: boolean } = {}): Promise<number> {
  const appTable = options.staged ? "apps_staging" : "apps";
  const metricTable = options.staged ? "app_metrics_staging" : "app_metrics";
  const appRows = await env.DB.prepare(
    `SELECT id, name, artist_name AS artistName, icon_url AS iconUrl, description,
            track_view_url AS trackViewUrl, one_liner AS oneLiner, genre_id AS genreId
     FROM ${appTable}`,
  ).all<AppSnapshot & { description?: string | null; genreId?: string | null }>();
  const rankRows = await env.DB.prepare(
    `SELECT snapshot_date AS date, country, chart, genre_id AS genreId, rank, app_id AS appId
     FROM chart_ranks WHERE snapshot_date >= date(?, '-1 year') AND snapshot_date ${options.staged ? "<" : "<="} ?
     ${options.staged ? "UNION ALL SELECT snapshot_date AS date, country, chart, genre_id AS genreId, rank, app_id AS appId FROM chart_ranks_staging" : ""}`,
  )
    .bind(date, date)
    .all<RankRecord>();
  const metricRows = await env.DB.prepare(
    `SELECT app_id AS appId, country, rating, rating_count AS ratingCount
     FROM ${metricTable} WHERE snapshot_date = ?`,
  )
    .bind(date)
    .all<MetricSnapshot>();

  const primaryByApp = new Map<string, RankRecord>();
  for (const row of rankRows.results) {
    if (row.date === date && (!primaryByApp.has(row.appId) || row.rank < primaryByApp.get(row.appId)!.rank)) primaryByApp.set(row.appId, row);
  }
  const apps = (appRows.results ?? []).map((app) => {
    const primary = primaryByApp.get(app.id);
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

  if (opportunities.length === 0) {
    throw new Error("分类结果为空，保留上一份 D1 快照");
  }

  await env.DB.prepare("DELETE FROM opportunities_staging").run();
  const oppInsert = env.DB.prepare(
    `INSERT INTO opportunities_staging (${OPPORTUNITY_COLUMNS})
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
  if (!options.staged) await env.DB.batch([
    env.DB.prepare("DELETE FROM opportunities"),
    env.DB.prepare(`INSERT INTO opportunities (${OPPORTUNITY_COLUMNS}) SELECT ${OPPORTUNITY_COLUMNS} FROM opportunities_staging`),
  ]);
  const oneLinerUpdate = env.DB.prepare(`UPDATE ${appTable} SET one_liner = ? WHERE id = ?`);
  await batchRun(
    env.DB,
    apps.map((app) => oneLinerUpdate.bind(app.oneLiner, app.id)),
  );

  if (options.reviews === false) return opportunities.length;
  const reviewTargets = opportunities
    .filter((row) => row.lens === "money_hated" || row.lens === "paid_tools")
    .slice(0, 30);
  const reviewInsert = env.DB.prepare(
    "INSERT INTO app_reviews (app_id, country, rating, title, content, author, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const fetchedAt = new Date().toISOString();
  for (const row of reviewTargets) {
    try {
      const reviews = await fetchReviews(row.appId, row.country);
      if (reviews.length === 0) continue;
      await env.DB.prepare("DELETE FROM app_reviews WHERE app_id = ? AND country = ?")
        .bind(row.appId, row.country)
        .run();
      await batchRun(
        env.DB,
        reviews.map((review) =>
          reviewInsert.bind(
            row.appId,
            row.country,
            review.rating,
            review.title,
            review.content,
            review.author,
            fetchedAt,
          ),
        ),
      );
    } catch (error) {
      console.error("reviews failed", row.appId, row.country, error);
    }
  }
  return opportunities.length;
}

async function d1Retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 4; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(label, i + 1, error);
      await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function latestIngest(env: DataEnv) {
  return d1Retry("latestIngest", () =>
    env.DB.prepare(
      "SELECT id, source, started_at, finished_at, status, stats, error FROM ingest_runs ORDER BY id DESC LIMIT 1",
    ).first<IngestRunRow>(),
  );
}

export async function latestSuccessfulIngest(env: DataEnv) {
  return env.DB.prepare(
    "SELECT id, source, started_at, finished_at, status, stats, error FROM ingest_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1",
  ).first<IngestRunRow>();
}

export async function expireStaleIngest(env: DataEnv): Promise<void> {
  const latest = await latestIngest(env);
  if (!latest || latest.status !== "running") return;
  if (!isStaleRunning(latest.started_at)) return;
  await d1Retry("expireStaleIngest", () =>
    env.DB.prepare(
      "UPDATE ingest_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ? AND status = 'running'",
    )
      .bind(new Date().toISOString(), "ingest timed out，已改用上一份 D1 快照", latest.id)
      .run(),
  );
}

export async function isIngestLocked(env: DataEnv): Promise<boolean> {
  await expireStaleIngest(env);
  return isActivelyIngesting(await latestIngest(env));
}

export async function lensCounts(env: DataEnv): Promise<Record<LensId, number>> {
  const rows = await env.DB.prepare(
    "SELECT lens, COUNT(*) AS count FROM opportunities GROUP BY lens",
  ).all<{ lens: LensId; count: number }>();
  const counts: Record<LensId, number> = {
    paid_tools: 0,
    paid_games: 0,
    money_hated: 0,
    fresh: 0,
    cluster: 0,
    indie_viral: 0,
    geo_gap: 0,
  };
  for (const row of rows.results ?? []) {
    counts[row.lens] = row.count;
  }
  return counts;
}
