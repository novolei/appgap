import { useEffect, useMemo, useState } from "react";
import { DATA_SOURCE, LENSES, type LensId, type PoolId } from "../shared/catalog";
import type { AppDetail, OpportunityRow } from "../shared/types";
import { fetchAppDetail, fetchAppsByIds, fetchMeta, fetchOpportunities, fetchPools, savePool } from "./api";
import { formatCount, formatRating, positionText, ratingTone, relativeTime } from "./format";
import { readPools } from "./storage";

function parseHash(): { lens: LensId | PoolId; appId: string | null; q: string } {
  const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, "").replace(/^\/?/, ""));
  const raw = params.get("lens") === "local_king" ? "geo_gap" : params.get("lens") || "paid_tools";
  const lens = (
    ["paid_tools", "paid_games", "money_hated", "fresh", "cluster", "indie_viral", "geo_gap", "watch", "build"].includes(raw)
      ? raw
      : "paid_tools"
  ) as LensId | PoolId;
  return { lens, appId: params.get("app"), q: params.get("q") || "" };
}

function writeHash(lens: LensId | PoolId, appId: string | null, q: string) {
  const params = new URLSearchParams();
  params.set("lens", lens);
  if (appId) params.set("app", appId);
  if (q) params.set("q", q);
  window.location.hash = params.toString();
}

type PoolState = { watch: string[]; build: string[] };

export function App() {
  const initial = parseHash();
  const [lens, setLens] = useState<LensId | PoolId>(initial.lens);
  const [query, setQuery] = useState(initial.q);
  const [items, setItems] = useState<OpportunityRow[]>([]);
  const [hint, setHint] = useState(LENSES[0].hint);
  const [ingesting, setIngesting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initial.appId);
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pools, setPools] = useState<PoolState>({ watch: [], build: [] });
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    writeHash(lens, activeId, query);
  }, [lens, activeId, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSource(false);
        setActiveId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootPools() {
      const remote = await fetchPools();
      if (cancelled) return;
      const local = readPools();
      const emptyRemote = remote.watch.length === 0 && remote.build.length === 0;
      const hasLocal = local.watch.length > 0 || local.build.length > 0;
      if (emptyRemote && hasLocal) {
        for (const app of local.build) await savePool(app.appId, "build");
        for (const app of local.watch) await savePool(app.appId, "watch");
        localStorage.removeItem("appgap.pools.v1");
        const again = await fetchPools();
        if (!cancelled) setPools(again);
        return;
      }
      setPools(remote);
    }
    void bootPools().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const meta = await fetchMeta();
        if (cancelled) return;
        setUpdatedAt(meta.lastSuccessAt);
        setIngesting(meta.ingesting);
        if (lens === "watch" || lens === "build") {
          const ids = pools[lens];
          const remote = await fetchAppsByIds(ids);
          if (cancelled) return;
          const byId = new Map(remote.items.map((item) => [item.appId, item]));
          setItems(ids.map((id) => byId.get(id)).filter((item): item is OpportunityRow => Boolean(item)));
          setHint(
            lens === "build"
              ? "准备动手的项目。这份名单存在线上，换电脑也能看到。"
              : "先盯着，还没决定做。名单存在线上数据库。",
          );
          return;
        }
        const data = await fetchOpportunities(lens);
        if (cancelled) return;
        setItems(data.items);
        setHint(data.hint);
        setIngesting(data.ingesting && data.items.length === 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (ingesting) void load();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [lens, ingesting, pools]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchAppDetail(activeId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.name} ${item.nameZh} ${item.artistName} ${item.oneLiner}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const activeApp =
    items.find((item) => item.appId === activeId) ?? null;

  function openLens(next: LensId | PoolId) {
    setLens(next);
    setActiveId(null);
  }

  async function onToggle(pool: PoolId) {
    if (!activeId) return;
    const current = pools.build.includes(activeId) ? "build" : pools.watch.includes(activeId) ? "watch" : null;
    const next = current === pool ? null : pool;
    await savePool(activeId, next);
    const fresh = await fetchPools();
    setPools(fresh);
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>AppGap</h1>
          <p>
            每周扫一次各国畅销榜，用来发现能做的小工具和游戏需求。
            <button className="source-link" type="button" onClick={() => setShowSource(true)}>
              数据来源
            </button>
          </p>
        </div>
        <div className="hero-meta">{ingesting ? "正在同步榜单" : relativeTime(updatedAt)}</div>
      </header>

      <label className="search">
        <span>搜</span>
        <input value={query} placeholder="中文译名、原名、开发者" onChange={(event) => setQuery(event.target.value)} />
      </label>

      <nav className="nav">
        {LENSES.map((item) => (
          <button key={item.id} className={lens === item.id ? "active" : ""} onClick={() => openLens(item.id)}>
            {item.label}
          </button>
        ))}
        <span className="split" />
        <button className={lens === "watch" ? "active" : ""} onClick={() => openLens("watch")}>
          观察 {pools.watch.length}
        </button>
        <button className={lens === "build" ? "active" : ""} onClick={() => openLens("build")}>
          要做 {pools.build.length}
        </button>
      </nav>

      <p className="lede">{hint}</p>

      <div className="list">
        {error && <div className="empty">{error}</div>}
        {!error && ingesting && items.length === 0 && <div className="banner">正在从 Apple 公开榜单拉数据，稍等片刻。</div>}
        {!error && !ingesting && filtered.length === 0 && <div className="empty">这一栏暂时是空的。</div>}
        {filtered.map((item, index) => (
          <button
            key={`${item.lens}-${item.appId}`}
            className={`row ${activeId === item.appId ? "active" : ""}`}
            onClick={() => setActiveId(item.appId)}
          >
            <div className="rank">{String(index + 1).padStart(2, "0")}</div>
            {item.iconUrl ? <img className="icon" src={item.iconUrl} alt="" /> : <div className="icon" />}
            <div className="body">
              <div className="zh">
                {item.nameZh}
                {pools.build.includes(item.appId) && <em className="badge">要做</em>}
              </div>
              {item.nameZh !== item.name && <div className="orig">{item.name}</div>}
              <div className="blurb">{item.oneLiner}</div>
              <div className="artist">{item.artistName}</div>
            </div>
            <div className="meta">
              <div className={`score ${ratingTone(item.rating)}`}>{formatRating(item.rating)}</div>
              <small>
                {positionText(item.country, item.rank)}
                <br />
                {formatCount(item.ratingCount)} 条评价
                {item.rankChange != null && item.rankChange !== 0
                  ? ` · 较上次${item.rankChange > 0 ? "升" : "降"} ${Math.abs(item.rankChange)}`
                  : ""}
                {item.consecutiveDays <= 1 ? " · 这次新见到" : ` · 已连续 ${item.consecutiveDays} 周`}
              </small>
            </div>
          </button>
        ))}
      </div>

      <p className="foot">
        每周一扫描一次，不是每天。区域为中文国名；标题是干什么的，下面一行是商店原名。
        {" · "}
        <button className="source-link" type="button" onClick={() => setShowSource(true)}>
          数据来源
        </button>
        <br />
        <a href="https://01mvp.com" target="_blank" rel="noreferrer">
          01MVP
        </a>
        {" · "}
        <a href="https://github.com/makerjackie/appgap" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </p>

      {showSource && (
        <div className="overlay" onClick={() => setShowSource(false)}>
          <aside className="drawer source-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-top">
              <h2>{DATA_SOURCE.title}</h2>
              <button className="close" onClick={() => setShowSource(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <p className="lede">{DATA_SOURCE.summary}</p>
            <ul className="bullets">
              {DATA_SOURCE.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </div>
      )}

      {activeId && (
        <div className="overlay" onClick={() => setActiveId(null)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-top">
              <div style={{ display: "flex", gap: 12 }}>
                {(detail?.app.iconUrl || activeApp?.iconUrl) && (
                  <img className="icon-lg" src={detail?.app.iconUrl || activeApp?.iconUrl || ""} alt="" />
                )}
                <div>
                  <div className="orig">{detail?.app.artistName || activeApp?.artistName}</div>
                  <h2>{detail?.app.nameZh || activeApp?.nameZh}</h2>
                  <div className="orig">{detail?.app.name || activeApp?.name}</div>
                  <div className="blurb">{detail?.app.oneLiner || activeApp?.oneLiner}</div>
                </div>
              </div>
              <button className="close" onClick={() => setActiveId(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="actions">
              <button className={pools.watch.includes(activeId) ? "primary" : ""} onClick={() => void onToggle("watch")}>
                {pools.watch.includes(activeId) ? "移出观察" : "加入观察"}
              </button>
              <button className={pools.build.includes(activeId) ? "primary" : ""} onClick={() => void onToggle("build")}>
                {pools.build.includes(activeId) ? "移出要做" : "标记要做"}
              </button>
              {(detail?.app.trackViewUrl || activeApp?.trackViewUrl) && (
                <a href={detail?.app.trackViewUrl || activeApp?.trackViewUrl || "#"} target="_blank" rel="noreferrer">
                  打开 App Store
                </a>
              )}
            </div>
            {detailLoading && <p className="orig">正在整理评价和分析…</p>}
            {detail && (
              <>
                <div className="block">
                  <h3>机会判断</h3>
                  <p>{detail.analysis.headline}</p>
                  <ul className="bullets">
                    {detail.analysis.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <div className="move">{detail.analysis.move}</div>
                </div>
                <div className="block">
                  <h3>上榜位置</h3>
                  <div className="pos-list">
                    {detail.positions.map((pos) => (
                      <span className="pill" key={`${pos.country}-${pos.chart}-${pos.genreId}`}>
                        {positionText(pos.country, pos.rank)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="block">
                  <h3>最近评价</h3>
                  {detail.reviews.length === 0 && <p className="orig">这一市场暂时没存到评价。</p>}
                  <ul className="reviews">
                    {detail.reviews.slice(0, 8).map((review, index) => (
                      <li key={`${review.title}-${index}`}>
                        <div>
                          {review.rating ? `${review.rating} 星 · ` : ""}
                          {review.title}
                        </div>
                        <div>{review.content}</div>
                        {(review.titleOriginal || review.contentOriginal) && (
                          <div className="orig-line">
                            原文：{review.titleOriginal || ""}
                            {review.contentOriginal ? ` ${review.contentOriginal}` : ""}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
