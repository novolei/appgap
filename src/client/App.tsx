import { useEffect, useMemo, useState } from "react";
import { LENSES, type LensId, type PoolId } from "../shared/catalog";
import type { AppDetail, OpportunityRow } from "../shared/types";
import { fetchAppDetail, fetchAppsByIds, fetchMeta, fetchOpportunities } from "./api";
import { formatCount, formatRating, positionText, ratingTone, relativeTime } from "./format";
import { isBuilt, readPools, togglePool } from "./storage";

function Coin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v9M9.4 9.2c.6-.7 1.5-1 2.6-1 1.7 0 2.7.8 2.7 2s-1 1.9-2.8 2.2c-1.6.3-2.6.9-2.6 2s1.1 2 2.8 2c1.2 0 2.1-.4 2.6-1.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function Rocket() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 5.5c2.6 1 5 3.8 5.8 6.5-2.7.8-5.5 3.2-6.5 5.8-2.2-1.3-4.3-3.4-5.6-5.6 1.1-2.5 3.7-5.3 6.3-6.7Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="14.2" cy="9.8" r="1.2" fill="currentColor" />
      <path d="M8 16.5c-.8.2-2.3.2-3.2 1.2-.8.8-.9 2.2-1 3 1-.1 2.3-.2 3.1-1 .9-.9.9-2.4 1.1-3.2Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Globe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 12h15M12 4s3 3.2 3 8-3 8-3 8-3-3.2-3-8 3-8 3-8Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Crown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 16.5 4 8l4.2 3L12 6.5l3.8 4.5L20 8l-1 8.5H5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6 18.5h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function Clipboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="5" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 5.5h6v2.5H9V5.5Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Folder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 8.5h5l1.5 1.8h8.5v8.2a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4.5 18.5v-10Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

const ICONS = { coin: Coin, rocket: Rocket, globe: Globe, crown: Crown };

function parseHash(): { lens: LensId | PoolId; appId: string | null; q: string } {
  const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, "").replace(/^\/?/, ""));
  const raw = params.get("lens") || "money_hated";
  const lens = (
    ["money_hated", "indie_viral", "geo_gap", "local_king", "watch", "build"].includes(raw) ? raw : "money_hated"
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
  const [pools, setPools] = useState(readPools);

  useEffect(() => {
    writeHash(lens, activeId, query);
  }, [lens, activeId, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          const ids = pools[lens].map((item) => item.appId);
          const remote = await fetchAppsByIds(ids);
          if (cancelled) return;
          const byId = new Map(remote.items.map((item) => [item.appId, item]));
          setItems(pools[lens].map((item) => byId.get(item.appId) ?? item));
          setHint(lens === "build" ? "立项池只存在你这台浏览器里。把真正准备做的机会放进来。" : "候选池用来盯着，还没决定做。数据存在本地。");
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
      `${item.name} ${item.artistName} ${item.oneLiner}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const activeApp = items.find((item) => item.appId === activeId) ?? pools.watch.find((item) => item.appId === activeId) ?? pools.build.find((item) => item.appId === activeId);

  function openLens(next: LensId | PoolId) {
    setLens(next);
    setActiveId(null);
  }

  function onToggle(pool: PoolId) {
    if (!activeApp) return;
    setPools(togglePool(pools, pool, activeApp));
  }

  return (
    <div className="page">
      <div className="topbar">
        <a className="brand" href="/">
          <span className="mark">
            <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M8 21V13.5M13.5 21V9M19 21v-6.5M24 21V11" stroke="#e7c56a" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <h1>App 趋势</h1>
            <small>AppGap · 01MVP</small>
          </span>
        </a>
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            placeholder="搜索 App、开发者、品类"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="updated">{ingesting ? "正在拉榜单…" : relativeTime(updatedAt)}</div>
      </div>

      <div className="tabs-wrap">
        {LENSES.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <button key={item.id} className={`tab ${lens === item.id ? "active" : ""}`} onClick={() => openLens(item.id)}>
              <Icon />
              {item.label}
            </button>
          );
        })}
        <button className={`tab ${lens === "build" ? "active" : ""}`} onClick={() => openLens("build")}>
          <Clipboard />
          立项池 ({pools.build.length})
        </button>
        <button className={`tab watch ${lens === "watch" ? "active" : ""}`} onClick={() => openLens("watch")}>
          <Folder />
          候选池 ({pools.watch.length})
        </button>
      </div>

      <div className="hint">{hint}</div>

      <div className="table-card">
        <div className="grid-head">
          <div />
          <div>App · 干什么的</div>
          <div>畅销榜位置</div>
          <div>评分</div>
          <div>评价数</div>
          <div style={{ textAlign: "right" }}>今日变化</div>
        </div>
        {error && <div className="empty">{error}</div>}
        {!error && ingesting && items.length === 0 && (
          <div className="banner">
            第一次打开会从 Apple 公开榜单拉数据，大约一分钟。<strong>不用注册任何 API。</strong>
          </div>
        )}
        {!error && !ingesting && filtered.length === 0 && <div className="empty">这一栏暂时是空的。</div>}
        {filtered.map((item, index) => (
          <button
            key={`${item.lens}-${item.appId}`}
            className={`row ${activeId === item.appId ? "active" : ""}`}
            onClick={() => setActiveId(item.appId)}
          >
            <div className="rank">{index + 1}</div>
            <div className="app-cell">
              <div className="app-name">
                <span>{item.name}</span>
                {isBuilt(pools, item.appId) && (
                  <em className="plan-badge">
                    <Clipboard /> 方案已出
                  </em>
                )}
              </div>
              <div className="one-liner">{item.oneLiner || item.reasons[0]}</div>
              <div className="artist">{item.artistName}</div>
            </div>
            <div>
              <span className="pill">{positionText(item.country, item.rank)}</span>
            </div>
            <div className={`rating ${ratingTone(item.rating)}`}>{formatRating(item.rating)}</div>
            <div className="count">{formatCount(item.ratingCount)}</div>
            <div className="change">
              {item.rankChange == null ? null : item.rankChange > 0 ? (
                <span className="chg up">↑ {item.rankChange} 位</span>
              ) : item.rankChange < 0 ? (
                <span className="chg down">↓ {Math.abs(item.rankChange)} 位</span>
              ) : (
                <span className="chg days">持平</span>
              )}
              <span className="chg days">连续 {item.consecutiveDays} 天</span>
            </div>
          </button>
        ))}
      </div>

      <p className="foot">
        数据来自 Apple 公开畅销榜 / 免费榜和 iTunes Lookup，不是官方收入数字。畅销榜大致按付费 + 内购排序。
        <br />
        <a href="https://01mvp.com" target="_blank" rel="noreferrer">
          01MVP
        </a>
        {" · "}
        appgap.01mvp.com
      </p>

      {activeId && (
        <div className="overlay" onClick={() => setActiveId(null)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-top">
              <div style={{ display: "flex", gap: 12 }}>
                {detail?.app.iconUrl && <img className="icon-lg" src={detail.app.iconUrl} alt="" />}
                <div>
                  <div className="muted">{detail?.app.artistName || activeApp?.artistName}</div>
                  <h2>{detail?.app.name || activeApp?.name}</h2>
                  <div className="muted">{detail?.app.oneLiner || activeApp?.oneLiner}</div>
                </div>
              </div>
              <button className="close" onClick={() => setActiveId(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="actions">
              <button className={pools.watch.some((item) => item.appId === activeId) ? "primary" : ""} onClick={() => onToggle("watch")}>
                {pools.watch.some((item) => item.appId === activeId) ? "移出候选池" : "加入候选池"}
              </button>
              <button className={pools.build.some((item) => item.appId === activeId) ? "primary" : ""} onClick={() => onToggle("build")}>
                {pools.build.some((item) => item.appId === activeId) ? "移出立项池" : "移到立项池"}
              </button>
              {(detail?.app.trackViewUrl || activeApp?.trackViewUrl) && (
                <a href={detail?.app.trackViewUrl || activeApp?.trackViewUrl || "#"} target="_blank" rel="noreferrer">
                  打开 App Store
                </a>
              )}
            </div>
            {detailLoading && <p className="muted">正在拉评价和分析…</p>}
            {detail && (
              <>
                <div className="block">
                  <h3>为什么是机会</h3>
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
                  {detail.reviews.length === 0 && <p className="muted">这一区暂时没拉到评价。</p>}
                  <ul className="reviews">
                    {detail.reviews.slice(0, 8).map((review, index) => (
                      <li key={`${review.title}-${index}`}>
                        <div>
                          {review.rating ? `${review.rating} 星 · ` : ""}
                          {review.title}
                        </div>
                        <div>{review.content}</div>
                        <div className="review-meta">{review.author}</div>
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
