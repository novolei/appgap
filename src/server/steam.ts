import { Hono } from "hono";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isAuthed } from "../worker/auth";
import { generateAnalysis } from "../worker/ai";
import type { RuntimeEnv } from "../worker/env";
import type { SteamSnapshot } from "../shared/steam";
import { buildSteamView } from "./steam-analysis";

export function steamRoutes(
  env: RuntimeEnv,
  directory: string,
  origin: string,
) {
  const app = new Hono();
  let cached: { stamp: number; data: SteamSnapshot } | undefined;
  let generating = false;
  const status = () => {
    try {
      return JSON.parse(
        readFileSync(join(directory, "status.json"), "utf8"),
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const snapshot = () => {
    const path = join(directory, "latest.json");
    const stat = statSync(path);
    if (stat.size > 25 * 1024 * 1024) throw new Error("快照超出读取上限");
    if (cached?.stamp !== stat.mtimeMs) {
      const data = JSON.parse(readFileSync(path, "utf8")) as SteamSnapshot;
      if (data.schemaVersion !== 1 || !data.games || !Array.isArray(data.ranks))
        throw new Error("快照格式不兼容");
      cached = { stamp: stat.mtimeMs, data };
    }
    return cached!.data;
  };
  app.use("*", async (c, next) => {
    if (!(await isAuthed(c.req.raw, env)))
      return c.json({ error: "unauthorized" }, 401);
    if (
      c.req.method !== "GET" &&
      c.req.header("origin") &&
      c.req.header("origin") !== origin
    )
      return c.json({ error: "forbidden origin" }, 403);
    await next();
  });
  app.get("/status", (c) => c.json(status()));
  app.get("/view", (c) => {
    try {
      return c.json({
        ...buildSteamView(snapshot(), new URL(c.req.url).searchParams),
        status: status(),
      });
    } catch (error) {
      return c.json(
        {
          error:
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
              ? "首次 Steam 快照尚未采集完成"
              : error instanceof Error
                ? error.message
                : "尚无已发布快照",
          status: status(),
        },
        503,
      );
    }
  });
  app.get("/game/:id", (c) => {
    try {
      const data = snapshot();
      const game = data.games[c.req.param("id")];
      if (!game) return c.json({ error: "未收录" }, 404);
      let history: unknown[] = [];
      try {
        const db = new DatabaseSync(join(directory, "history.sqlite"), {
          readOnly: true,
        });
        try {
          history = db
            .prepare(
              "SELECT date,country,chart,rank FROM rank_history WHERE app_id=? ORDER BY date DESC,country LIMIT 13000",
            )
            .all(game.appId);
        } finally {
          db.close();
        }
      } catch {
        /* A first snapshot may precede history restoration. */
      }
      return c.json({
        game,
        positions: data.ranks.filter((r) => r.appId === game.appId),
        history,
        capturedAt: data.capturedAt,
        reviewWindow: data.reviewWindow,
      });
    } catch {
      return c.json({ error: "尚无已发布快照" }, 503);
    }
  });
  app.get("/export", (c) => {
    try {
      c.header(
        "Content-Disposition",
        'attachment; filename="steam-snapshot.json"',
      );
      return c.json(snapshot());
    } catch {
      return c.json({ error: "尚无已发布快照" }, 503);
    }
  });
  app.get("/methodology", (c) =>
    c.text(readFileSync("docs/steam-methodology.md", "utf8")),
  );
  app.post("/analyze", async (c) => {
    let data: SteamSnapshot;
    try {
      data = snapshot();
    } catch {
      return c.json({ error: "尚无已发布快照" }, 503);
    }
    const query = new URL(c.req.url).searchParams;
    const country = query.get("country") || "ALL",
      tag = (query.get("tag") || "").slice(0, 100),
      model = query.get("model") || "all",
      chart = query.get("chart") || "sales";
    const key = `steam:${data.runId}:${data.analysisVersion || "base"}:${env.DEEPSEEK_MODEL || "deepseek-flash"}:${JSON.stringify([country, tag, model, chart])}`;
    const previous = await env.DB.prepare(
      "SELECT markdown, created_at AS createdAt FROM ai_analyses WHERE app_id=?",
    )
      .bind(key)
      .first<{ markdown: string; createdAt: string }>();
    if (previous) return c.json({ ...previous, cached: true });
    if (generating)
      return c.json({ error: "已有一份 Steam 分析正在生成，请稍后" }, 429);
    generating = true;
    try {
      const view = buildSteamView(
        data,
        new URLSearchParams({ country, tag, model, chart }),
      );
      const material = {
        capturedAt: view.capturedAt,
        country,
        tag,
        model,
        chart,
        summary: view.summary,
        windows: view.windows,
        genreStats: view.genreStats.slice(0, 15),
        games: view.games.slice(0, 15).map((g) => ({
          name: g.name,
          tags: g.tags,
          priceUsd: g.priceUsd,
          free: g.free,
          positions: g.positions.filter((p) => p.country === country),
          opportunity: g.opportunity,
          topics: g.topics,
          sampleN: g.sampleN,
        })),
      };
      const markdown = await generateAnalysis(
        env,
        `面向独立游戏开发者，以以下快照写中文决策备忘录。收入榜仅为排名，不能得出销量、金额、市场份额或用户国家；评论语言不是地区。痛点为关键词线索，先核原文；首日快照只能比较已标注周榜基线，不能声称长期趋势。机会分是内部启发式，不是成功概率。分段：事实和证据、谁在付钱（付费产品/免费内购信号）、类型与地区、机会窗口、反证和竞争、两周最小原型和停损、仍缺数据。每个结论引用游戏名/地区/分母，明确事实与假设。材料：${JSON.stringify(material)}`,
      );
      const createdAt = new Date().toISOString();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO ai_analyses(app_id,markdown,created_at) VALUES(?,?,?)",
      )
        .bind(key, markdown, createdAt)
        .run();
      return c.json({ markdown, createdAt, cached: false });
    } catch (error) {
      console.error(
        "Steam analysis failed",
        error instanceof Error ? error.message : "unknown",
      );
      return c.json({ error: "分析未完成，请稍后重试" }, 502);
    } finally {
      generating = false;
    }
  });
  return app;
}
