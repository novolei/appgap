import { COUNTRIES, countryLabel, isGameGenre, type ChartId, type LensId } from "./catalog";
import { chineseName } from "./translate";
import { detectKind } from "./what";
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
  const snapshots = [...new Set(rows.map((row) => row.date))].sort();
  for (const row of rows) {
    const key = `${row.appId}|${row.country}|${row.chart}|${row.genreId}`;
    let dates = byKey.get(key);
    if (!dates) {
      dates = new Map();
      byKey.set(key, dates);
    }
    dates.set(row.date, row.rank);
  }
  const todayIndex = snapshots.lastIndexOf(today);
  const previousSnapshot = todayIndex > 0 ? snapshots[todayIndex - 1] : null;

  return {
    consecutiveDays(appId, country, chart, genreId) {
      const dates = byKey.get(`${appId}|${country}|${chart}|${genreId}`);
      if (!dates) return 1;
      let weeks = 0;
      for (let i = snapshots.length - 1; i >= 0; i -= 1) {
        if (!dates.has(snapshots[i])) break;
        weeks += 1;
        if (weeks > 52) break;
      }
      return Math.max(weeks, 1);
    },
    rankChange(appId, country, chart, genreId, todayRank) {
      if (!previousSnapshot) return null;
      const dates = byKey.get(`${appId}|${country}|${chart}|${genreId}`);
      const previous = dates?.get(previousSnapshot);
      if (previous == null) return null;
      return previous - todayRank;
    },
  };
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
    nameZh: chineseName(input.app.name, input.primary.genreId, input.app.description),
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
  const metrics = new Map(input.metrics.map((item) => [`${item.appId}|${item.country}`, item]));
  const countryCount = COUNTRIES.length;
  const result: OpportunityRow[] = [];

  for (const [appId, positions] of byApp) {
    const app = apps.get(appId);
    if (!app) continue;
    const primary = bestGrossing(positions);
    if (!primary) continue;
    const metric = metrics.get(`${appId}|${primary.country}`);
    const rating = metric?.rating ?? null;
    const ratingCount = metric?.ratingCount ?? 0;
    const oneLiner = input.oneLinerFor(app, primary);
    const countriesPresent = new Set(positions.map((item) => item.country));
    const bestRank = Math.min(...positions.map((item) => item.rank));
    const bestFree = positions.filter((item) => item.chart === "free").sort((a, b) => a.rank - b.rank)[0];

    const official = isOfficialOrBigApp(app.name, app.artistName);
    const streak = input.history.consecutiveDays(app.id, primary.country, primary.chart, primary.genreId);

    if (!official && primary.chart === "grossing" && primary.rank <= 40 && !isGameGenre(primary.genreId)) {
      result.push(
        rowFrom({
          lens: "paid_tools",
          app,
          primary,
          all: positions,
          metric,
          history: input.history,
          score: (50 - primary.rank) * 10 + ln(ratingCount ?? 1),
          oneLiner,
          reasons: [`${countryLabel(primary.country)}畅销榜第 ${primary.rank}`, "有人在为这个小工具付钱"],
        }),
      );
    }

    if (!official && primary.chart === "grossing" && primary.rank <= 40 && isGameGenre(primary.genreId)) {
      result.push(
        rowFrom({
          lens: "paid_games",
          app,
          primary,
          all: positions,
          metric,
          history: input.history,
          score: (50 - primary.rank) * 10 + ln(ratingCount ?? 1),
          oneLiner,
          reasons: [`${countryLabel(primary.country)}游戏畅销榜第 ${primary.rank}`, "这套玩法正在收钱"],
        }),
      );
    }

    if (
      !official &&
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
            "需求在，口碑不在",
          ],
        }),
      );
    }

    if (!official && streak <= 1 && bestRank <= 40) {
      result.push(
        rowFrom({
          lens: "fresh",
          app,
          primary,
          all: positions,
          metric,
          history: input.history,
          score: (45 - bestRank) * 8,
          oneLiner,
          reasons: ["这次扫描才第一次见到", `${countryLabel(primary.country)}第 ${primary.rank}`],
        }),
      );
    }

    const viralRank = bestFree?.rank ?? (bestRank <= 25 ? bestRank : 999);
    if (!official && (bestFree ? bestFree.rank <= 30 : primary.rank <= 20)) {
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
    if (!official && bestRank <= 20 && missing >= Math.max(4, countryCount - 6)) {
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

  }

  const clusterBuckets = new Map<string, OpportunityRow[]>();
  for (const row of result.filter((item) => item.lens === "paid_tools")) {
    const kind = detectKind(row.name, apps.get(row.appId)?.description ?? "");
    if (!kind) continue;
    const list = clusterBuckets.get(kind.id) ?? [];
    list.push(row);
    clusterBuckets.set(kind.id, list);
  }
  for (const [kindId, list] of clusterBuckets) {
    if (list.length < 4) continue;
    const kind = detectKind(list[0].name, apps.get(list[0].appId)?.description ?? "");
    for (const row of list) {
      result.push({
        ...row,
        lens: "cluster",
        score: list.length * 30 + (40 - row.rank),
        reasons: [`「${kind?.nameZh ?? kindId}」同时有 ${list.length} 款在赚钱`, `畅销榜第 ${row.rank}`],
      });
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
