import { COUNTRIES, countryLabel, type ChartId, type LensId } from "./catalog";
import { chineseName } from "./translate";
import { isOfficialOrBigApp } from "./publishers";
import type { OpportunityRow, RankPosition } from "./types";

export type RankRecord = {
  appId: string;
  country: string;
  chart: ChartId;
  genreId: string;
  rank: number;
  date: string;
};

export type AppSnapshot = {
  id: string;
  name: string;
  artistName: string;
  iconUrl: string | null;
  description: string | null;
  oneLiner: string;
  trackViewUrl: string | null;
};

export type MetricSnapshot = {
  appId: string;
  country: string;
  rating: number | null;
  ratingCount: number | null;
};

export type HistoryIndex = {
  consecutiveDays: (appId: string, country: string, chart: ChartId, genreId: string) => number;
  rankChange: (appId: string, country: string, chart: ChartId, genreId: string, todayRank: number) => number | null;
};

export function buildHistoryIndex(rows: RankRecord[], today: string): HistoryIndex {
  const byKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = `${row.appId}|${row.country}|${row.chart}|${row.genreId}`;
    let dates = byKey.get(key);
    if (!dates) {
      dates = new Map();
      byKey.set(key, dates);
    }
    dates.set(row.date, row.rank);
  }

  const yesterdayOf = (iso: string) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  };

  return {
    consecutiveDays(appId, country, chart, genreId) {
      const dates = byKey.get(`${appId}|${country}|${chart}|${genreId}`);
      if (!dates) return 1;
      let days = 0;
      let cursor = today;
      while (dates.has(cursor)) {
        days += 1;
        cursor = yesterdayOf(cursor);
        if (days > 60) break;
      }
      return Math.max(days, 1);
    },
    rankChange(appId, country, chart, genreId, todayRank) {
      const dates = byKey.get(`${appId}|${country}|${chart}|${genreId}`);
      if (!dates) return null;
      const yesterday = dates.get(yesterdayOf(today));
      if (yesterday == null) return null;
      return yesterday - todayRank;
    },
  };
}

function metricFor(metrics: MetricSnapshot[], appId: string, country: string): MetricSnapshot | undefined {
  return (
    metrics.find((item) => item.appId === appId && item.country === country) ??
    metrics.find((item) => item.appId === appId)
  );
}

function bestGrossing(positions: RankRecord[]): RankRecord | undefined {
  const grossing = positions.filter((item) => item.chart === "grossing").sort((a, b) => a.rank - b.rank);
  return grossing[0] ?? positions.slice().sort((a, b) => a.rank - b.rank)[0];
}

function rowFrom(input: {
  lens: LensId;
  app: AppSnapshot;
  primary: RankRecord;
  all: RankRecord[];
  metric: MetricSnapshot | undefined;
  history: HistoryIndex;
  score: number;
  reasons: string[];
  oneLiner: string;
}): OpportunityRow {
  const positions: RankPosition[] = input.all.map((item) => ({
    country: item.country,
    chart: item.chart,
    genreId: item.genreId,
    rank: item.rank,
  }));
  return {
    lens: input.lens,
    appId: input.app.id,
    name: input.app.name,
    nameZh: chineseName(input.app.name, input.primary.genreId),
    artistName: input.app.artistName,
    iconUrl: input.app.iconUrl,
    oneLiner: input.oneLiner,
    country: input.primary.country,
    chart: input.primary.chart,
    genreId: input.primary.genreId,
    rank: input.primary.rank,
    rating: input.metric?.rating ?? null,
    ratingCount: input.metric?.ratingCount ?? null,
    rankChange: input.history.rankChange(
      input.app.id,
      input.primary.country,
      input.primary.chart,
      input.primary.genreId,
      input.primary.rank,
    ),
    consecutiveDays: input.history.consecutiveDays(
      input.app.id,
      input.primary.country,
      input.primary.chart,
      input.primary.genreId,
    ),
    trackViewUrl: input.app.trackViewUrl,
    score: input.score,
    positions,
    reasons: input.reasons,
  };
}

function ln(value: number): number {
  return Math.log(Math.max(1, value));
}

export function classifyOpportunities(input: {
  today: string;
  apps: AppSnapshot[];
  ranks: RankRecord[];
  metrics: MetricSnapshot[];
  history: HistoryIndex;
  oneLinerFor: (app: AppSnapshot, primary: RankRecord) => string;
}): OpportunityRow[] {
  const todayRanks = input.ranks.filter((item) => item.date === input.today);
  const byApp = new Map<string, RankRecord[]>();
  for (const rank of todayRanks) {
    const list = byApp.get(rank.appId) ?? [];
    list.push(rank);
    byApp.set(rank.appId, list);
  }
  const apps = new Map(input.apps.map((app) => [app.id, app]));
  const countryCount = COUNTRIES.length;
  const result: OpportunityRow[] = [];

  for (const [appId, positions] of byApp) {
    const app = apps.get(appId);
    if (!app) continue;
    const primary = bestGrossing(positions);
    if (!primary) continue;
    const metric = metricFor(input.metrics, appId, primary.country);
    const rating = metric?.rating ?? null;
    const ratingCount = metric?.ratingCount ?? 0;
    const oneLiner = input.oneLinerFor(app, primary);
    const countriesPresent = new Set(positions.map((item) => item.country));
    const bestRank = Math.min(...positions.map((item) => item.rank));
    const bestFree = positions.filter((item) => item.chart === "free").sort((a, b) => a.rank - b.rank)[0];

    if (
      !isOfficialOrBigApp(app.name, app.artistName) &&
      primary.chart === "grossing" &&
      rating != null &&
      rating >= 2.4 &&
      rating < 3.95 &&
      ratingCount >= 80
    ) {
      const score = (130 - primary.rank) * 5 + (4.05 - rating) * 18 + ln(ratingCount);
      result.push(
        rowFrom({
          lens: "money_hated",
          app,
          primary,
          all: positions,
          metric,
          history: input.history,
          score,
          oneLiner,
          reasons: [
            `${countryLabel(primary.country)}畅销榜第 ${primary.rank}`,
            `评分 ${rating.toFixed(1)}，${ratingCount.toLocaleString("en-US")} 条评价`,
            "用户在付钱，但明显不满意",
          ],
        }),
      );
    }

    const viralRank = bestFree?.rank ?? (bestRank <= 25 ? bestRank : 999);
    if (
      !isOfficialOrBigApp(app.name, app.artistName) &&
      (bestFree ? bestFree.rank <= 30 : primary.rank <= 20)
    ) {
      const score = (40 - Math.min(viralRank, 39)) * 10 + (25 - Math.min(bestRank, 24));
      result.push(
        rowFrom({
          lens: "indie_viral",
          app,
          primary: bestFree ?? primary,
          all: positions,
          metric,
          history: input.history,
          score,
          oneLiner,
          reasons: [
            "看起来是小团队 / 小公司",
            bestFree ? `免费榜第 ${bestFree.rank}` : `畅销榜第 ${primary.rank}`,
          ],
        }),
      );
    }

    const missing = countryCount - countriesPresent.size;
    if (!isOfficialOrBigApp(app.name, app.artistName) && bestRank <= 20 && missing >= 3) {
      const score = (21 - bestRank) * missing * 8;
      const missingLabels = COUNTRIES.filter((item) => !countriesPresent.has(item.id))
        .map((item) => item.label)
        .slice(0, 4)
        .join("、");
      result.push(
        rowFrom({
          lens: "geo_gap",
          app,
          primary,
          all: positions,
          metric,
          history: input.history,
          score,
          oneLiner,
          reasons: [
            `出现在 ${countriesPresent.size} 个区的榜上`,
            missingLabels ? `在 ${missingLabels} 等区未见` : "其他区几乎空白",
          ],
        }),
      );
    }

    if (!isOfficialOrBigApp(app.name, app.artistName) && bestRank <= 8 && countriesPresent.size === 1) {
      const score = (9 - bestRank) * 40 + ln(ratingCount ?? 1) * 5;
      result.push(
        rowFrom({
          lens: "local_king",
          app,
          primary,
          all: positions,
          metric,
          history: input.history,
          score,
          oneLiner,
          reasons: [`只在${countryLabel(primary.country)}榜上靠前`, `最高第 ${bestRank} 名`],
        }),
      );
    }
  }

  const byLens = new Map<LensId, OpportunityRow[]>();
  for (const row of result) {
    const list = byLens.get(row.lens) ?? [];
    list.push(row);
    byLens.set(row.lens, list);
  }
  const trimmed: OpportunityRow[] = [];
  for (const [, list] of byLens) {
    list.sort((a, b) => b.score - a.score || a.rank - b.rank);
    trimmed.push(...list.slice(0, 80));
  }
  return trimmed;
}
