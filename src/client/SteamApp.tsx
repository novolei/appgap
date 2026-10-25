import { useEffect, useRef, useState } from "react";
import type {
  SteamGame,
  SteamRank,
  SteamSnapshot,
  SteamView,
} from "../shared/steam";
import { Markdown } from "./Markdown";
import { savePool } from "./api";
import { csvCell } from "../shared/steam-export";
import "./steam.css";

const format = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(n);
const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "未知" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const date = (stamp: number | null | undefined) =>
  stamp ? new Date(stamp * 1000).toLocaleDateString("zh-CN") : "无基线";
const regionNames: Record<string, string> = {
  GLOBAL: "全球",
  CN: "中国",
  US: "美国",
  JP: "日本",
  KR: "韩国",
  TW: "台湾",
  HK: "香港",
  DE: "德国",
  GB: "英国",
  FR: "法国",
  BR: "巴西",
  RU: "俄罗斯",
  TR: "土耳其",
  CA: "加拿大",
  AU: "澳大利亚",
  PL: "波兰",
  TH: "泰国",
  SG: "新加坡",
  ES: "西班牙",
  IT: "意大利",
};
const labels: Record<string, string> = {
  windows: "机会窗口",
  games: "游戏与证据",
  regions: "地区 × 类型",
  genres: "类型对照",
  methods: "来源与方法",
};
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) {
    location.reload();
    throw Error("请登录");
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw Error(`服务返回非 JSON 响应（HTTP ${response.status}），请稍后重试。`);
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw Error(data.error || "请求失败");
  return data as T;
}

export function SteamApp() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initial = new URLSearchParams(location.search);
  const [country, setCountry] = useState(initial.get("country") || "ALL"),
    [tag, setTag] = useState(initial.get("tag") || ""),
    [model, setModel] = useState(initial.get("model") || "all"),
    [chart, setChart] = useState(initial.get("chart") || "sales");
  const [view, setView] = useState<SteamView | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("windows"),
    [query, setQuery] = useState("");
  const [detail, setDetail] = useState<{
      game: SteamGame;
      positions: SteamRank[];
      capturedAt: string;
      reviewWindow: SteamSnapshot["reviewWindow"];
    } | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState(""),
    [analyzing, setAnalyzing] = useState(false),
    [method, setMethod] = useState(""),
    [notice, setNotice] = useState("");
  const [pools, setPools] = useState<{ watch: string[]; build: string[] }>({
      watch: [],
      build: [],
    }),
    [poolFilter, setPoolFilter] = useState("all");
  const params = new URLSearchParams({ country, tag, model, chart }).toString();
  const activeScope = useRef(params);
  activeScope.current = params;
  useEffect(() => {
    document.title = "AppGap · Steam 游戏机会研究";
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setMarkdown("");
    history.replaceState(null, "", `/steam?${params}`);
    request<SteamView>(`/api/steam/view?${params}`, { signal: abort.signal })
      .then(setView)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e.message));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [params]);
  useEffect(() => {
    request<{ watch: string[]; build: string[] }>("/api/pools?platform=steam")
      .then(setPools)
      .catch((e) => setNotice(e.message));
  }, []);
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    const abort = new AbortController();
    request<NonNullable<typeof detail>>(`/api/steam/game/${selected}`, {
      signal: abort.signal,
    })
      .then(setDetail)
      .catch((e) => {
        if (!abort.signal.aborted) setNotice(e.message);
      });
    return () => abort.abort();
  }, [selected]);
  useEffect(() => {
    if (tab === "methods" && !method)
      fetch("/api/steam/methodology")
        .then((r) => {
          if (!r.ok) throw Error("方法文档读取失败");
          return r.text();
        })
        .then(setMethod)
        .catch((e) => setNotice(e.message));
  }, [tab, method]);
  useEffect(() => {
    if (!selected) return;
    dialogRef.current?.showModal();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);
  async function pool(id: string, target: "watch" | "build" | null) {
    try {
      await savePool(`steam:${id}`, target);
      setPools((old) => ({
        watch: [
          ...old.watch.filter((v) => v !== `steam:${id}`),
          ...(target === "watch" ? [`steam:${id}`] : []),
        ],
        build: [
          ...old.build.filter((v) => v !== `steam:${id}`),
          ...(target === "build" ? [`steam:${id}`] : []),
        ],
      }));
      setNotice(target ? "已保存，可在游戏列表筛选查看。" : "已移除收藏。");
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function analyze() {
    setAnalyzing(true);
    setNotice("");
    try {
      const result = await request<{ markdown: string }>(
        `/api/steam/analyze?${params}`,
        { method: "POST" },
      );
      if (activeScope.current === params) setMarkdown(result.markdown);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setAnalyzing(false);
    }
  }
  function csv() {
    if (!view) return;
    const rows = [
      [
        "appId",
        "name",
        "free",
        "subscription",
        "US_reference_price_USD",
        "global_lifetime_reviews",
        "global_positive_pct",
        "internal_priority",
        "regions",
        "recent_sample_n",
        "negative_sample_n",
      ],
      ...view.games.map((g) => [
        g.appId,
        g.name,
        g.free,
        Boolean(g.subscription),
        g.priceUsd,
        g.reviewCount,
        g.positivePct,
        g.opportunity.score,
        g.opportunity.regions,
        g.sampleN,
        g.negativeSampleN,
      ]),
    ];
    const blob = new Blob(
      ["\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `steam-${view.runId}-${country}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const shown =
    view?.games.filter(
      (g) =>
        (!query ||
          `${g.name} ${g.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (poolFilter === "all" ||
          pools[poolFilter as "watch" | "build"].includes(`steam:${g.appId}`)),
    ) || [];
  return (
    <main className="steam-page">
      <header className="steam-hero">
        <div>
          <a className="eyebrow" href="/">
            APPGAP / App Store ←
          </a>
          <h1>Steam 机会研究</h1>
          <p>
            从真实付费信号、玩家抱怨与类型变化，找到下一款游戏可验证的切口。
          </p>
        </div>
        <div className="steam-stamp">
          <strong>
            {view
              ? new Date(view.capturedAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Hong_Kong",
                })
              : "读取快照中"}
          </strong>
          <span>香港时间 · 每日 09:13 采集，完成后同步</span>
          <span>
            {view
              ? `${view.totalGames} 款入样游戏 · ${view.countries.length - 1} 个地区`
              : "官方公开数据"}
          </span>
        </div>
      </header>
      <p className="steam-footnote"><a href="/research/steam-opportunities-2026-10-25.html" target="_blank" rel="noreferrer">2026-10-25 综合研究与原型建议 ↗</a> · <a href="/research/steam-analysis-2026-10-25.html" target="_blank" rel="noreferrer">复算笔记预览</a> · <a href="/research/steam-analysis-2026-10-25.ipynb" download>下载 Notebook</a></p>
      <div className="steam-caution">
        研究范围是公开榜单入样游戏，覆盖头部需求；无法代表 Steam
        全量市场。畅销含内购，免费榜不等于下载榜；地区指榜单，评论样本来自全球。
      </div>
      <section className="steam-filters" aria-label="研究范围">
        <label>
          国家／地区
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              if (
                !["GLOBAL", "ALL"].includes(e.target.value) &&
                chart === "players"
              )
                setChart("sales");
            }}
          >
            {[
              { id: "ALL", name: "全部地区联合样本" },
              ...(view?.countries || [{ id: "GLOBAL", name: "Global" }]),
            ].map((c) => (
              <option key={c.id} value={c.id}>
                {regionNames[c.id] || c.name} · {c.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          信号榜单
          <select value={chart} onChange={(e) => setChart(e.target.value)}>
            <option value="sales">收入畅销 Top 100</option>
            <option value="free">免费游戏的畅销信号</option>
            <option
              value="players"
              disabled={!["GLOBAL", "ALL"].includes(country)}
            >
              全球最常玩 Top 100
            </option>
          </select>
        </label>
        <label>
          游戏标签
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部类型</option>
            {view?.tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          商业模式
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="all">全部</option>
            <option value="paid">付费本体</option>
            <option value="free">免费本体</option>
          </select>
        </label>
      </section>
      {loading && <p role="status">正在读取已发布快照…</p>}
      {error && (
        <p className="steam-error" role="alert">
          {error}。采集失败时保留上次成功快照；首次采集完成后刷新。
        </p>
      )}
      {notice && (
        <p className="steam-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="关闭提示">
            ×
          </button>
        </p>
      )}
      {view && !loading && !error && (
        <>
          {(Date.now() - Date.parse(view.capturedAt) > 48 * 3600000 ||
            view.status?.status === "error") && (
            <p className="steam-error">
              数据可能过期／最近采集失败：
              {String(view.status?.error || "超过 48 小时未更新")}
              。以下仍为上次成功快照。
            </p>
          )}
          <p className="steam-footnote">
            可用周榜基线：{view.comparisonDates.join("、") || "暂无"}。
            {!view.momentumUsable
              ? "基线缺失或超过 14 天，动量未参与优先级评分；目前不能确认哪类玩法正在持续增长。"
              : "仅表示与该周榜相比的名次差，不能等同于销量增速。"}
            评论接口成功 {view.reviewCoverage.succeeded}/
            {view.reviewCoverage.targeted} 款。
          </p>
          <section className="steam-stats" aria-label="样本概览">
            {[
              ["当前入样", view.summary.n, "不同游戏"],
              [
                "付费 / 免费",
                `${view.summary.paid} / ${view.summary.free}`,
                "本体商业模式",
              ],
              [
                "付费中位价",
                money(view.summary.medianPrice),
                "美国区买断现价，不含订阅",
              ],
              [
                "排名上移",
                `${view.summary.rising} / ${view.summary.compared}`,
                "与标注周榜基线可比",
              ],
              [
                "近 30 天评论",
                format(view.summary.reviewSampleN),
                "每款至多 100 条全部评价",
              ],
              [
                "负评证据",
                format(view.summary.negativeSampleN),
                "额外抽取负评，去重",
              ],
            ].map(([label, value, note]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{note}</small>
              </div>
            ))}
          </section>
          <nav className="steam-tabs" aria-label="研究视图">
            {Object.entries(labels).map(([id, label]) => (
              <button
                key={id}
                aria-current={tab === id ? "page" : undefined}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
            <span />
            <button onClick={csv}>导出筛选 CSV</button>
            <a href="/api/steam/export">完整 JSON</a>
          </nav>
          {tab === "windows" && (
            <>
              <div className="steam-section-heading">
                <div>
                  <h2>先选可验证的切口</h2>
                  <p>
                    下列是研究假设。优先级分仅用于内部排序，样本不足 3
                    款时仅作线索；原型阈值是建议的内部闸门。
                  </p>
                </div>
                <button onClick={analyze} disabled={analyzing || loading}>
                  {analyzing ? "正在生成…" : "DeepSeek 综合论证"}
                </button>
              </div>
              <p className="steam-footnote">
                点击综合论证会调用已配置的付费模型，同一快照与筛选条件复用缓存。数据采集和下列统计不调用模型。
              </p>
              <div className="steam-window-grid">
                {view.windows.map((w, index) => (
                  <article className="steam-window" key={w.id}>
                    <div className="steam-window-top">
                      <span>假设 {String(index + 1).padStart(2, "0")}</span>
                      <b>
                        {w.score}
                        <small> / 100</small>
                      </b>
                    </div>
                    <h3>{w.title}</h3>
                    <p>{w.proposition}</p>
                    <div className="steam-chips">
                      <span>{w.n} 款游戏</span>
                      <span>涉及 {w.regionN} 地区</span>
                      <span>付费中位 {money(w.priceMedian)}</span>
                      <span>{w.n < 3 ? "样本偏少" : "需原型验证"}</span>
                    </div>
                    <p>
                      <b>抱怨线索：</b>
                      {w.pains
                        .map((p) => `${p.label} ${p.hits}/${p.denominator}`)
                        .join("；") || "暂无足够负评证据"}
                    </p>
                    <div className="steam-examples">
                      {w.examples.map((id) => (
                        <button key={id} onClick={() => setSelected(id)}>
                          {view.games.find((g) => g.appId === id)?.name || id} ↗
                        </button>
                      ))}
                    </div>
                    <details>
                      <summary>原型、验证与风险</summary>
                      <p>
                        <b>最小原型：</b>
                        {w.prototype}
                      </p>
                      <p>
                        <b>继续条件：</b>
                        {w.validation}
                      </p>
                      <p>
                        <b>主要风险：</b>
                        {w.risk}
                      </p>
                    </details>
                  </article>
                ))}
              </div>
              {markdown && (
                <article className="steam-ai">
                  <h2>综合论证 · 模型推断，需核原始证据</h2>
                  <Markdown text={markdown} />
                </article>
              )}
              <p className="steam-footnote">
                有评论痛点不代表存在可盈利的空缺；修复老游戏的问题，也不意味着玩家会迁移到新产品。下一步仍需试玩、访谈和愿望单实验。
              </p>
            </>
          )}
          {tab === "games" && (
            <>
              <div className="steam-list-tools">
                <label>
                  搜索游戏
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="游戏名或英文标签"
                  />
                </label>
                <label>
                  收藏状态
                  <select
                    value={poolFilter}
                    onChange={(e) => setPoolFilter(e.target.value)}
                  >
                    <option value="all">全部样本</option>
                    <option value="watch">候选收藏</option>
                    <option value="build">准备立项</option>
                  </select>
                </label>
              </div>
              <div className="steam-table-wrap">
                <table>
                  <caption>
                    当前筛选 {shown.length} 款 · 点击游戏核对地区排名与评论原文
                  </caption>
                  <thead>
                    <tr>
                      <th>游戏</th>
                      <th>商业模式 / 美国价</th>
                      <th>全球总体口碑</th>
                      <th>地区数</th>
                      <th>排名变化</th>
                      <th>负评抽样</th>
                      <th>优先分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((g) => (
                      <tr key={g.appId}>
                        <th>
                          <button
                            className="steam-game-link"
                            onClick={() => setSelected(g.appId)}
                          >
                            {g.name}
                          </button>
                          <small>{g.tags.slice(0, 3).join(" · ")}</small>
                        </th>
                        <td>
                          {g.free ? "免费本体" : g.subscription ? `订阅 · 首期 ${money(g.priceUsd)}` : money(g.priceUsd)}
                          {g.discountPct > 0 && (
                            <small>现价折扣 −{g.discountPct}%</small>
                          )}
                        </td>
                        <td>
                          {format(g.positivePct)}%
                          <small>{format(g.reviewCount)} 条，非近 30 天</small>
                        </td>
                        <td>{g.opportunity.regions}</td>
                        <td>
                          {g.opportunity.averageRankChange === null
                            ? "无可比项"
                            : `${g.opportunity.averageRankChange > 0 ? "+" : ""}${format(g.opportunity.averageRankChange)}`}
                          <small>
                            {g.opportunity.changeComparisons} 个榜单可比
                          </small>
                        </td>
                        <td>
                          {g.negativeSampleN}
                          <small>全部评论样本 {g.sampleN}</small>
                        </td>
                        <td>
                          {g.opportunity.score}
                          <small>{g.opportunity.confidence}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "regions" && (
            <>
              <h2>地区偏好线索</h2>
              <p>
                每格为“该类型上榜游戏数 /
                当前商业模式下该地区入样数”。括号为相对全球指数，100 =
                全球同榜占比；不是销售份额。游戏取前 6
                个标签，可重复计数。标签筛选决定显示列，矩阵分母保留各地完整入样。
                指数仅在地区与全球均至少 30 款、全球该标签至少 5
                款时计算。免费模式的矩阵统一从各区收入畅销 Top100
                中筛选免费游戏，额外全球免费榜只用于游戏列表。
              </p>
              <div className="steam-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>地区 · 入样数</th>
                      {view.matrixTags.map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.matrix.map((row) => (
                      <tr key={row.country}>
                        <th>
                          <button onClick={() => setCountry(row.country)}>
                            {regionNames[row.country] || row.country} · {row.n}
                          </button>
                        </th>
                        {row.cells.map((cell) => (
                          <td
                            key={cell.tag}
                            className={
                              (cell.index ?? 0) >= 140 && cell.n >= 3
                                ? "steam-heat"
                                : ""
                            }
                          >
                            {cell.n}/{cell.denominator}
                            <small>
                              {cell.index === null
                                ? "基线不足"
                                : `指数 ${cell.index}`}
                            </small>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "genres" && (
            <>
              <h2>类型、价格与进入成本</h2>
              <p>
                一款游戏可有多个标签。价格为美国区付费游戏现价中位数；排名上移按可比周榜观察，不是销量增长。最高主题命中数
                / 负评样本数用于发现重复抱怨，非真实痛点发生率。
              </p>
              <div className="steam-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>前 6 标签分组</th>
                      <th>游戏数</th>
                      <th>付费数</th>
                      <th>付费中位价</th>
                      <th>上移 / 可比游戏</th>
                      <th>涉及地区</th>
                      <th>主要主题命中 / 负评样本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.genreStats.map((g) => (
                      <tr key={g.tag}>
                        <th>
                          <button
                            onClick={() => {
                              setTag(g.tag);
                              setTab("games");
                            }}
                          >
                            {g.tag}
                          </button>
                        </th>
                        <td>{g.n}</td>
                        <td>{g.paid}</td>
                        <td>{money(g.priceMedian)}</td>
                        <td>
                          {g.rising}/{g.compared}
                        </td>
                        <td>{g.regions}</td>
                        <td>
                          {g.painHits}/{g.negativeN}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "methods" && (
            <>
              <h2>来源覆盖与数据质量</h2>
              <p>
                评论接口成功 {view.reviewCoverage.succeeded}/
                {view.reviewCoverage.targeted}{" "}
                款；未成功项保留为未知。地区榜源数据通常 100 条，去除
                DLC、软件和不可售项目后保留原始名次空缺。
              </p>
              <div className="steam-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>来源</th>
                      <th>状态</th>
                      <th>源条数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.coverage.map((c, i) => (
                      <tr key={i}>
                        <td>
                          {c.source?.startsWith("https://") ? (
                            <a href={c.source} target="_blank" rel="noreferrer">
                              {c.country || "商店元数据"} · {c.chart || "sales"}
                            </a>
                          ) : (
                            c.source || c.country
                          )}
                        </td>
                        <td>{c.status === "ok" ? "成功" : c.error}</td>
                        <td>{c.rows ?? `${c.returned}/${c.requested}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Markdown text={method} />
            </>
          )}
          <footer className="steam-footer">
            数据版本 #{view.runId} · {view.summary.discounted} 款处于折扣，
            {view.summary.recentReleases} 款在 90
            天内发行。快照以采集时间为准，各接口存在缓存与先后差异。
          </footer>
        </>
      )}
      {selected && (
        <dialog
          ref={dialogRef}
          className="steam-overlay"
          aria-label="游戏证据"
          onCancel={() => setSelected(null)}
          onClick={() => setSelected(null)}
        >
          <section
            className="steam-detail"
            aria-label="游戏证据"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="steam-close"
              autoFocus
              onClick={() => setSelected(null)}
            >
              关闭 ×
            </button>
            {!detail ? (
              <p>正在读取证据…</p>
            ) : (
              <>
                <span className="eyebrow">STEAM / {detail.game.appId}</span>
                <h2>{detail.game.name}</h2>
                <p>{detail.game.description}</p>
                <div className="steam-chips">
                  {detail.game.tags.slice(0, 10).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <p>
                  <a href={detail.game.url} target="_blank" rel="noreferrer">
                    打开 Steam 商店 ↗
                  </a>{" "}
                  ·{" "}
                  {detail.game.free
                    ? "免费本体"
                    : `美国区 ${detail.game.subscription ? "订阅首期 " : ""}${money(detail.game.priceUsd)}`}{" "}
                  · 发行 {date(detail.game.releaseTimestamp)}
                </p>
                <p>
                  开发商 {detail.game.developers.join(" / ") || "未知"} · 发行商{" "}
                  {detail.game.publishers.join(" / ") || "未知"}
                </p>
                <div className="steam-detail-actions">
                  <button onClick={() => pool(selected, "watch")}>
                    加入候选
                  </button>
                  <button onClick={() => pool(selected, "build")}>
                    准备立项
                  </button>
                  <button onClick={() => pool(selected, null)}>移除收藏</button>
                </div>
                <h3>地区与排名证据</h3>
                <div className="steam-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>地区 / 榜单</th>
                        <th>现排名</th>
                        <th>周榜基线</th>
                        <th>基线开始日</th>
                            <th>源页面显示价格</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.positions.map((p) => (
                        <tr key={`${p.country}:${p.chart}`}>
                          <th>
                            {regionNames[p.country] || p.country} / {p.chart}
                          </th>
                          <td>#{p.rank}</td>
                          <td>
                            {p.previousRank ? `#${p.previousRank}` : "无可比项"}
                          </td>
                          <td>{date(p.weekStart)}</td>
                          <td>{p.localPrice || "未知"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>谁在付钱：可观察的范围</h3>
                <p>
                  本体类型和上榜说明产品产生收入信号，无法识别付费人群及人均消费。
                  {detail.game.reviews?.purchase
                    ? `全部评价样本中 Steam 获取 ${detail.game.reviews.purchase.steam}、站外获取 ${detail.game.reviews.purchase.external}、获赠标记 ${detail.game.reviews.purchase.receivedFree}、已退款标记 ${detail.game.reviews.purchase.refunded}；这些标签不能证明实际支付价格。`
                    : "获取渠道标签将在下一次采集中补齐。"}
                </p>
                <h3>近 30 天评论 · 全球抽样</h3>
                {detail.game.reviews ? (
                  <>
                    <p>
                      全部评论样本 {detail.game.reviews.allSampleN} 条，其中负评{" "}
                      {detail.game.reviews.negativeInAllSample}{" "}
                      条。额外负评抽取去重后{" "}
                      {detail.game.reviews.negativeSampleN}{" "}
                      条；不可用后者计算总体差评率。
                    </p>
                    <p>
                      全部样本的负评比例 Wilson 95% 区间：
                      {detail.game.reviews.negativeWilson95
                        ?.map((n) => `${n}%`)
                        .join(" – ") || "样本不足"}
                      。这是抽样波动参考，无法消除按最新排序的选择偏差。
                    </p>
                    <p>
                      API 返回的时间窗匹配评论：全部{" "}
                      {format(detail.game.reviews.matching30Days)}、负评{" "}
                      {format(detail.game.reviews.negativeMatching30Days)}
                      。这些匹配评论中的负评占比{" "}
                      {format(detail.game.reviews.negativeRate30Days)}%
                      。实际样本时间 {date(detail.game.reviews.firstTimestamp)}{" "}
                      — {date(detail.game.reviews.lastTimestamp)}。
                    </p>
                    <p>
                      全部样本语言：
                      {Object.entries(detail.game.reviews.languages)
                        .map(([l, n]) => `${l} ${n}`)
                        .join(" · ")}
                      。语言不代表玩家所在国家。
                    </p>
                    <div className="steam-chips">
                      {detail.game.reviews.topics.map((t) => (
                        <span key={t.id}>
                          {t.label} {t.hits}/{t.denominator}
                        </span>
                      ))}
                    </div>
                    <p className="steam-footnote">
                      关键词仅提示候选主题，可能误判或漏判。逐条核对上下文后再确定设计需求。
                    </p>
                    {detail.game.reviews.evidence.slice(0, 8).map((r) => (
                      <blockquote key={r.id}>
                        <p>{r.excerpt}</p>
                        <small>
                          {r.language} · {date(r.createdAt)} · 评价时游玩{" "}
                          {format((r.minutesAtReview || 0) / 60)} 小时 ·{" "}
                          <a href={r.url} target="_blank" rel="noreferrer">
                            核对原文 ↗
                          </a>
                        </small>
                      </blockquote>
                    ))}
                  </>
                ) : (
                  <p>
                    评论采集未成功或暂无评论：
                    {detail.game.reviewError || "无可用证据"}
                  </p>
                )}
              </>
            )}
          </section>
        </dialog>
      )}
    </main>
  );
}
