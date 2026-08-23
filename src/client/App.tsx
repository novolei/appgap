import { useEffect, useMemo, useState } from "react";
import {
  COUNTRIES,
  DATA_SOURCE,
  LENSES,
  POOLS,
  countryName,
  isCountryId,
  lensById,
  type LensId,
  type PoolId,
} from "../shared/catalog";
import { buildExportMarkdown, buildListMarkdown } from "../shared/exportNote";
import type { AppDetail, OpportunityRow } from "../shared/types";
import {
  fetchAppDetail,
  fetchAppsByIds,
  fetchMeta,
  fetchOpportunities,
  fetchPools,
  requestAnalysis,
  savePool,
} from "./api";
import { copyText } from "./copy";
import { formatCount, formatRating, positionText, ratingTone, relativeTime } from "./format";
import { readPools } from "./storage";

const LENS_OR_POOL = [
  "paid_tools",
  "paid_games",
  "money_hated",
  "fresh",
  "cluster",
  "indie_viral",
  "geo_gap",
  "watch",
  "build",
] as const;

function parseHash(): { lens: LensId | PoolId; appId: string | null; q: string; country: string } {
  const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, "").replace(/^\/?/, ""));
  const raw = params.get("lens") === "local_king" ? "geo_gap" : params.get("lens") || "paid_tools";
  const lens = (LENS_OR_POOL.includes(raw as (typeof LENS_OR_POOL)[number]) ? raw : "paid_tools") as LensId | PoolId;
  const countryRaw = params.get("country") || "";
  return {
    lens,
    appId: params.get("app"),
    q: params.get("q") || "",
    country: isCountryId(countryRaw) ? countryRaw : "",
  };
}

function writeHash(lens: LensId | PoolId, appId: string | null, q: string, country: string) {
  const params = new URLSearchParams();
  params.set("lens", lens);
  if (appId) params.set("app", appId);
  if (q) params.set("q", q);
  if (country) params.set("country", country);
  window.location.hash = params.toString();
}

function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        if (/^#{1,3} /.test(lines[0])) {
          const title = lines[0].replace(/^#{1,3} /, "");
          const rest = lines.slice(1).join("\n").trim();
          return (
            <div key={index}>
              <h3>{title}</h3>
              {rest ? <p>{rest}</p> : null}
            </div>
          );
        }
        const listish = lines.filter((line) => line.trim());
        if (listish.length && listish.every((line) => /^[-*•]\s/.test(line) || /^\d+\.\s/.test(line))) {
          return (
            <ul key={index}>
              {listish.map((line, lineIndex) => (
                <li key={lineIndex}>{line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

type PoolState = { watch: string[]; build: string[] };

function lensLabel(lens: LensId | PoolId) {
  if (lens === "watch" || lens === "build") {
    return POOLS.find((item) => item.id === lens)?.label ?? lens;
  }
  return lensById(lens).label;
}

export function App() {
  const initial = parseHash();
  const [lens, setLens] = useState<LensId | PoolId>(initial.lens);
  const [query, setQuery] = useState(initial.q);
  const [country, setCountry] = useState(initial.country);
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
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiAt, setAiAt] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"app" | "list" | null>(null);

  useEffect(() => {
    writeHash(lens, activeId, query, country);
  }, [lens, activeId, query, country]);

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
          setHint(POOLS.find((item) => item.id === lens)?.hint ?? "");
          return;
        }
        const data = await fetchOpportunities(lens, country || undefined);
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
  }, [lens, ingesting, pools, country]);

  useEffect(() => {
    setAiText(null);
    setAiAt(null);
    setAiError(null);
    setAiLoading(false);
    setCopied(null);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchAppDetail(activeId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        if (data.ai) {
          setAiText(data.ai.markdown);
          setAiAt(data.ai.createdAt);
        }
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
    return items.filter((item) => {
      if (country && (lens === "watch" || lens === "build")) {
        const hit = item.country === country || item.positions.some((pos) => pos.country === country);
        if (!hit) return false;
      }
      if (!q) return true;
      return `${item.name} ${item.nameZh} ${item.artistName} ${item.oneLiner}`.toLowerCase().includes(q);
    });
  }, [items, query, country, lens]);

  const activeApp = items.find((item) => item.appId === activeId) ?? null;

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

  async function onAnalyze(fresh = false) {
    if (!activeId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await requestAnalysis(activeId, fresh);
      setAiText(result.markdown);
      setAiAt(result.createdAt);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function onCopyApp() {
    if (!detail) return;
    await copyText(buildExportMarkdown(detail, aiText));
    setCopied("app");
    window.setTimeout(() => setCopied(null), 1600);
  }

  async function onCopyList() {
    await copyText(
      buildListMarkdown({
        lensLabel: lensLabel(lens),
        countryName: country ? countryName(country) : "",
        hint,
        items: filtered,
      }),
    );
    setCopied("list");
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>AppGap</h1>
          <p>
            每周扫一次各国畅销榜，用来发现能做的小工具和游戏需求。点进 App 可以加入候选收藏，确认了再立项。名单存在线上。
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
        {POOLS.map((item) => (
          <button key={item.id} className={lens === item.id ? "active" : ""} onClick={() => openLens(item.id)}>
            {item.label} {pools[item.id].length}
          </button>
        ))}
      </nav>

      <div className="countries" role="tablist" aria-label="按国家筛选">
        <button type="button" className={country === "" ? "active" : ""} onClick={() => setCountry("")}>
          全部国家
        </button>
        {COUNTRIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={country === item.id ? "active" : ""}
            onClick={() => setCountry(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="lede-row">
        <p className="lede">{hint}</p>
        <button className="source-link" type="button" onClick={() => void onCopyList()}>
          {copied === "list" ? "已复制本页" : "复制本页"}
        </button>
      </div>

      <div className="list">
        {error && <div className="empty">{error}</div>}
        {!error && ingesting && items.length === 0 && <div className="banner">正在从 Apple 公开榜单拉数据，稍等片刻。</div>}
        {!error && !ingesting && filtered.length === 0 && (
          <div className="empty">{country ? "这个国家这一栏暂时没有。" : "这一栏暂时是空的。"}</div>
        )}
        {filtered.map((item, index) => (
          <button
            key={`${item.lens}-${item.appId}`}
            className={`row ${activeId === item.appId ? "active" : ""}`}
            onClick={() => setActiveId(item.appId)}
          >
            <div className="rank">{String(index + 1).padStart(2, "0")}</div>
            {item.iconUrl ? <img className="icon" src={item.iconUrl} alt="" /> : <div className="icon" />}
            <div className="body">
              <div className="title">
                <span className="orig-name">{item.name}</span>
                {item.nameZh && item.nameZh !== item.name && (
                  <>
                    <span className="dash"> — </span>
                    <span className="zh-name">{item.nameZh}</span>
                  </>
                )}
                {pools.build.includes(item.appId) && <em className="badge">立项</em>}
                {pools.watch.includes(item.appId) && !pools.build.includes(item.appId) && (
                  <em className="badge faint">候选</em>
                )}
              </div>
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
        每周一扫描一次，不是每天。标题是商店原名 — 中文名。点进 App 后可加入候选或立项，也可以复制给 Codex 继续分析。
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
                  <h2>
                    {detail?.app.name || activeApp?.name}
                    {(detail?.app.nameZh || activeApp?.nameZh) &&
                      (detail?.app.nameZh || activeApp?.nameZh) !== (detail?.app.name || activeApp?.name) && (
                        <>
                          <span className="dash"> — </span>
                          <span className="zh-name">{detail?.app.nameZh || activeApp?.nameZh}</span>
                        </>
                      )}
                  </h2>
                  <div className="blurb">{detail?.app.oneLiner || activeApp?.oneLiner}</div>
                </div>
              </div>
              <button className="close" onClick={() => setActiveId(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="actions">
              <button className={pools.watch.includes(activeId) ? "primary" : ""} onClick={() => void onToggle("watch")}>
                {pools.watch.includes(activeId) ? "移出候选" : "加入候选"}
              </button>
              <button className={pools.build.includes(activeId) ? "primary" : ""} onClick={() => void onToggle("build")}>
                {pools.build.includes(activeId) ? "移出立项" : "标记立项"}
              </button>
              <button disabled={!detail} onClick={() => void onCopyApp()}>
                {copied === "app" ? "已复制" : "复制给 Codex"}
              </button>
              {(detail?.app.trackViewUrl || activeApp?.trackViewUrl) && (
                <a href={detail?.app.trackViewUrl || activeApp?.trackViewUrl || "#"} target="_blank" rel="noreferrer">
                  打开 App Store
                </a>
              )}
            </div>
            <p className="pool-note">候选是先收藏看着；立项是准备动手。两份名单都存在线上数据库。</p>
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
                  <h3>DeepSeek 分析</h3>
                  <div className="actions">
                    <button className="primary" disabled={aiLoading} onClick={() => void onAnalyze(!aiText)}>
                      {aiLoading ? "正在分析…" : aiText ? "再跑一次" : "用 DeepSeek 分析"}
                    </button>
                  </div>
                  {aiError && <p className="ai-error">{aiError}</p>}
                  {aiLoading && <p className="orig">正在用 DeepSeek v4 Flash 看这份材料，大概十几秒。</p>}
                  {aiText && (
                    <>
                      {aiAt && <p className="orig">分析于 {aiAt.replace("T", " ").slice(0, 16)} UTC</p>}
                      <Markdown text={aiText} />
                    </>
                  )}
                  {!aiText && !aiLoading && !aiError && (
                    <p className="orig">点一次就会根据榜单、评分和评价写一份笔记。密钥只在服务器，不会进浏览器。</p>
                  )}
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
