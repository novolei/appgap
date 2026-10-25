import type {
  SteamGame,
  SteamSnapshot,
  SteamView,
  SteamWindow,
} from "../shared/steam";

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n
    ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2
    : null;
}
const windowDefinitions = [
  {
    id: "tactics",
    tags: [
      "Turn-Based Strategy",
      "Turn-Based Tactics",
      "Deckbuilding",
      "Card Battler",
    ],
    title: "短局战术与构筑",
    proposition: "保留组合决策深度，减少长教程、无效刷取和不可读数值。",
    risk: "同质化和数值平衡；热门 IP 的需求不能直接迁移。",
    prototype: "两周制作 1 个 15 分钟循环、12 个可组合单位或卡牌，先验证复玩。",
    validation:
      "招募 15 位同类付费玩家，至少 10 位独立完成首局、8 位主动再开；未达标先改核心循环。",
  },
  {
    id: "management",
    tags: ["Management", "Automation", "Colony Sim", "Base Building"],
    title: "可控规模的经营与自动化",
    proposition:
      "从单一生产链或小型据点切入，优先存档安全、信息可读性和稳定帧率。",
    risk: "后期内容和模拟性能成本高；不要直接承诺无限世界。",
    prototype: "三周验证 3 级生产链、单张地图、可逆操作和 3 档时间速度。",
    validation:
      "20 位目标玩家中 12 位无提示打通生产链、10 位在次日返回；记录卡点和存档失败。",
  },
  {
    id: "cooperative",
    tags: ["Online Co-Op", "Co-op", "Party Game", "Local Co-Op"],
    title: "低门槛小队协作",
    proposition:
      "用一条共享目标和清晰角色分工建立朋友局，先解决加入、重连和等待。",
    risk: "联机质量、获客成组和持续运维；现有 UOS 能降低接入成本但不能替代玩法验证。",
    prototype: "两周只做 2–4 人、10 分钟、1 种任务；独立验证断线重连。",
    validation:
      "8 组朋友至少 6 组无协助建局、5 组自发连续玩三轮；收集组内邀请意愿。",
  },
  {
    id: "roguelite",
    tags: ["Roguelite", "Roguelike", "Bullet Heaven"],
    title: "紧凑的肉鸽变化",
    proposition: "用机制组合替代纯数值膨胀，在短局中持续产生可解释的新决策。",
    risk: "供给拥挤、内容产能和视觉噪声；榜上成功者存在幸存者偏差。",
    prototype: "两周验证 8 个有交互的升级、1 个场地、20 分钟完整曲线。",
    validation:
      "15 位同类玩家中 8 位能主动描述不同构筑且愿意重开；只说数值变大则重做组合。",
  },
  {
    id: "cozy",
    tags: ["Cozy", "Farming Sim", "Fishing", "Life Sim"],
    title: "有边界的舒适生活模拟",
    proposition:
      "围绕一个可持续的小动作、收集和可见成长设计，减少作业感和重复劳动。",
    risk: "美术辨识度、内容消耗和本地化成本；不能把宽泛休闲兴趣当付费证明。",
    prototype: "三周制作 1 个地点、1 个核心动作和 30 分钟成长链。",
    validation:
      "15 位目标玩家中 10 位主动完成成长目标、8 位愿意继续；用实际体验而非概念图投票。",
  },
  {
    id: "horror",
    tags: ["Horror", "Psychological Horror", "Survival Horror"],
    title: "短流程恐怖与体验密度",
    proposition: "用明确主题和高密度互动形成传播片段，控制地图与敌人种类。",
    risk: "一次性内容、主播曝光偶然性；不要把多人标签的表现归因给恐怖主题。",
    prototype: "两周验证 15 分钟、1 个场景和 3 次可交互情境反转。",
    validation:
      "10 位新玩家中 7 位完成体验、5 位能回忆并愿意分享同一核心片段；结合目标价格访谈。",
  },
  {
    id: "puzzle",
    tags: ["Puzzle", "Puzzle Platformer", "Hidden Object"],
    title: "小体量解谜与发现",
    proposition: "从可讲清楚的一条规则切入，做好提示层级、控制器和可读性。",
    risk: "内容耗尽、低价竞争和免费替代；评论痛点可能仅是个人难度偏好。",
    prototype: "两周制作 12 关递进样本，提供可选分级提示。",
    validation:
      "15 位新玩家中 10 位独立理解规则、8 位完成样本；逐关测放弃点而非只看通关率。",
  },
];

export function buildSteamView(
  snapshot: SteamSnapshot,
  filters: URLSearchParams,
): SteamView {
  const country = filters.get("country") || "ALL";
  if (country !== "ALL" && !snapshot.countries.some((c) => c.id === country))
    throw new Error("未知国家／地区");
  const tag = filters.get("tag") || "";
  const monetization = filters.get("model") || "all";
  const chart = ["sales", "free", "players"].includes(
    filters.get("chart") || "",
  )
    ? filters.get("chart")!
    : "sales";
  if (!["GLOBAL", "ALL"].includes(country) && chart === "players")
    throw new Error("在线热度仅有全球榜");
  const positions = new Map<string, SteamSnapshot["ranks"]>();
  for (const row of snapshot.ranks)
    positions.set(row.appId, [...(positions.get(row.appId) || []), row]);
  const all = Object.values(snapshot.games);
  const modelMatch = (game: SteamGame) =>
    monetization === "all" ||
    (monetization === "free" ? game.free : !game.free);
  const regionGames = (id: string) =>
    all.filter(
      (game) =>
        modelMatch(game) &&
        (positions.get(game.appId) || []).some(
          (row) =>
            (id === "ALL" || row.country === id) &&
            (id === "ALL" && chart === "free"
              ? ["sales", "free"].includes(row.chart)
              : row.chart ===
                (chart === "free" && id !== "GLOBAL" ? "sales" : chart)),
        ) &&
        (chart !== "free" || game.free),
    );
  const games = regionGames(country).filter(
    (game) => !tag || game.tags.includes(tag),
  );
  const salesRegions = (group: SteamGame[]) =>
    new Set(
      group.flatMap((game) =>
        (positions.get(game.appId) || [])
          .filter((row) => row.chart === "sales" && row.country !== "GLOBAL")
          .map((row) => row.country),
      ),
    ).size;
  const stats = (group: SteamGame[]) => ({
    n: group.length,
    paid: group.filter((g) => !g.free).length,
    priceMedian: median(
      group
        .filter((g) => !g.free && !g.subscription && g.priceUsd !== null)
        .map((g) => g.priceUsd!),
    ),
    rising: group.filter((g) => (g.opportunity.averageRankChange ?? 0) > 0)
      .length,
    compared: group.filter((g) => g.opportunity.averageRankChange !== null)
      .length,
    regions: salesRegions(group),
    painHits: group.reduce(
      (n, g) =>
        n + Math.max(0, ...(g.reviews?.topics || []).map((p) => p.hits)),
      0,
    ),
    negativeN: group.reduce((n, g) => n + (g.reviews?.negativeSampleN || 0), 0),
  });
  const genreStats = [...new Set(games.flatMap((g) => g.tags.slice(0, 6)))]
    .map((tag) => ({
      tag,
      ...stats(games.filter((g) => g.tags.slice(0, 6).includes(tag))),
    }))
    .sort((a, b) => b.n - a.n);
  const matrixTags = genreStats.slice(0, 12).map((g) => g.tag);
  const matrixGames = (id: string) =>
    chart === "free"
      ? all.filter(
          (game) =>
            game.free &&
            modelMatch(game) &&
            (positions.get(game.appId) || []).some(
              (row) => row.country === id && row.chart === "sales",
            ),
        )
      : regionGames(id);
  const global = matrixGames("GLOBAL");
  const matrix = snapshot.countries.map((region) => {
    const cohort = matrixGames(region.id);
    return {
      country: region.id,
      n: cohort.length,
      cells: matrixTags.map((tag) => {
        const n = cohort.filter((g) => g.tags.slice(0, 6).includes(tag)).length;
        const base = global.filter((g) =>
          g.tags.slice(0, 6).includes(tag),
        ).length;
        return {
          tag,
          n,
          denominator: cohort.length,
          index:
            cohort.length >= 30 && global.length >= 30 && base >= 5
              ? Math.round((n / cohort.length / (base / global.length)) * 100)
              : null,
        };
      }),
    };
  });
  const windows: SteamWindow[] = windowDefinitions
    .map((definition) => {
      const group = games.filter((game) =>
        definition.tags.some((tag) => game.tags.slice(0, 6).includes(tag)),
      );
      const topics = new Map<
        string,
        { label: string; hits: number; denominator: number }
      >();
      for (const game of group)
        for (const topic of game.reviews?.topics || []) {
          const previous = topics.get(topic.id) || {
            label: topic.label,
            hits: 0,
            denominator: 0,
          };
          previous.hits += topic.hits;
          topics.set(topic.id, previous);
        }
      const negativeN = group.reduce(
        (n, g) => n + (g.reviews?.negativeSampleN || 0),
        0,
      );
      return {
        ...definition,
        n: group.length,
        regionN: salesRegions(group),
        negativeN,
        score: Math.round(
          group.reduce((n, g) => n + g.opportunity.score, 0) /
            Math.max(1, group.length),
        ),
        priceMedian: stats(group).priceMedian,
        rising: stats(group).rising,
        examples: [...group]
          .sort((a, b) => b.opportunity.score - a.opportunity.score)
          .slice(0, 5)
          .map((g) => g.appId),
        pains: [...topics.values()]
          .map((t) => ({ ...t, denominator: negativeN }))
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 3),
      };
    })
    .filter((w) => w.n > 0)
    .sort(
      (a, b) => (b.n >= 3 ? 1 : 0) - (a.n >= 3 ? 1 : 0) || b.score - a.score,
    );
  const selectedStats = stats(games);
  return {
    comparisonDates: [
      ...new Set(
        snapshot.ranks
          .filter((r) => r.chart === "sales" && r.weekStart)
          .map((r) => new Date(r.weekStart! * 1000).toISOString().slice(0, 10)),
      ),
    ].sort(),
    momentumUsable: games.some((g) => g.opportunity.momentum !== null),
    capturedAt: snapshot.capturedAt,
    runId: snapshot.runId,
    country,
    countries: snapshot.countries,
    tags: [...new Set(all.flatMap((g) => g.tags))].sort(),
    coverage: snapshot.coverage,
    reviewCoverage: snapshot.reviewCoverage,
    totalGames: all.length,
    games: games
      .map(({ reviews, ...game }) => ({
        ...game,
        sampleN: reviews?.allSampleN || 0,
        negativeSampleN: reviews?.negativeSampleN || 0,
        topics: reviews?.topics || [],
        positions: positions.get(game.appId) || [],
      }))
      .sort((a, b) => b.opportunity.score - a.opportunity.score),
    windows,
    matrix,
    matrixTags,
    genreStats,
    summary: {
      n: games.length,
      paid: selectedStats.paid,
      free: games.length - selectedStats.paid,
      discounted: games.filter((g) => g.discountPct > 0).length,
      recentReleases: games.filter(
        (g) =>
          g.releaseTimestamp &&
          g.releaseTimestamp <= snapshot.reviewWindow.end &&
          g.releaseTimestamp >= snapshot.reviewWindow.end - 90 * 86400,
      ).length,
      medianPrice: selectedStats.priceMedian,
      reviewSampleN: games.reduce(
        (n, g) => n + (g.reviews?.allSampleN || 0),
        0,
      ),
      negativeSampleN: selectedStats.negativeN,
      rising: selectedStats.rising,
      compared: selectedStats.compared,
    },
    status: null,
  };
}
