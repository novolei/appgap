import { Hono } from "hono";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isAuthed } from "../worker/auth";
import { createHash } from "node:crypto";
import { steamAiRoutes } from "./steam-ai";
import type { RuntimeEnv } from "../worker/env";
import type { SteamSnapshot } from "../shared/steam";
import { buildSteamView } from "./steam-analysis";
import { SteamImageCache } from "./steam-images";

export function steamRoutes(
  env: RuntimeEnv,
  directory: string,
  origin: string,
) {
  const app = new Hono();
  const images=new SteamImageCache(join(directory,"images"));
  let cached: { stamp: number; data: SteamSnapshot; fingerprint: string } | undefined;
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
      const raw = readFileSync(path, "utf8");
      const data = JSON.parse(raw) as SteamSnapshot;
      if (data.schemaVersion !== 1 || !data.games || !Array.isArray(data.ranks))
        throw new Error("快照格式不兼容");
      cached = { stamp: stat.mtimeMs, data, fingerprint: createHash("sha256").update(raw).digest("hex") };
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
  app.get("/image/:id",async c=>{
    try{
      const game=snapshot().games[c.req.param("id")];
      if(!game?.image||c.req.query("v")!==game.image)return c.body(null,404);
      const image=await images.get(game.appId,game.image);
      if(!image){c.header("Cache-Control","private, max-age=300");return c.body(null,404);}
      c.header("Cache-Control",image.state==="STALE"?"private, max-age=300":"private, max-age=604800, immutable");
      c.header("ETag",image.etag);c.header("X-Image-Cache",image.state);
      if(c.req.header("if-none-match")===image.etag)return c.body(null,304);
      c.header("Content-Type",image.mime);return c.body(new Uint8Array(image.bytes));
    }catch{c.header("Cache-Control","private, max-age=60");return c.body(null,503);}
  });
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
  app.route("/", steamAiRoutes(env, () => {
    const data = snapshot();
    return { data, fingerprint: cached!.fingerprint };
  }, origin));
  return app;
}
