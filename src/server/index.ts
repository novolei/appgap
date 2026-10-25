import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup } from "node:sqlite";
import worker from "../index";
import { runIngest } from "../worker/ingest";
import type { RuntimeEnv } from "../worker/env";
import { SqliteDatabase } from "./database";

const path = process.env.APPGAP_DB || "data/appgap.sqlite";
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new SqliteDatabase(path);

if (process.argv.includes("--ingest")) {
  try { console.log(JSON.stringify(await runIngest({ DB: db }, { source: "vps" }))); }
  finally { db.close(); }
} else if (process.argv.includes("--backup")) {
  try {
    const destination = process.env.APPGAP_BACKUP;
    if (!destination) throw new Error("APPGAP_BACKUP required");
    await backup(db.sqlite, destination);
    console.log("backup complete");
  } finally { db.close(); }
} else {
  if (!process.env.SITE_PASSWORD || process.env.SITE_PASSWORD.length < 10) throw new Error("SITE_PASSWORD of at least 10 characters required");
  const origin = process.env.PUBLIC_ORIGIN || "http://127.0.0.1:8790";
  const assets = new Hono();
  assets.use("*", serveStatic({ root: "./dist" }));
  assets.get("*", serveStatic({ path: "./dist/index.html" }));
  const env: RuntimeEnv = {
    DB: db, SITE_PASSWORD: process.env.SITE_PASSWORD,
    INGEST_SECRET: process.env.INGEST_SECRET, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    ASSETS: { fetch: (request: Request) => assets.fetch(request) } as Fetcher,
  };
  const http = new Hono();
  const attempts = new Map<string, { count: number; until: number }>();
  http.use("*", bodyLimit({ maxSize: 8192 }));
  http.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Robots-Tag", "noindex, nofollow");
    await next();
  });
  http.all("*", async (c) => {
    const url = new URL(c.req.url);
    const expected = new URL(origin);
    if (url.host === expected.host) url.protocol = expected.protocol;
    else if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return c.json({ error: "invalid host" }, 400);
    if (url.pathname === "/api/login" && c.req.method === "POST") {
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const ip = c.req.header("CF-Connecting-IP") || "local";
      const previous = attempts.get(ip);
      if ((previous?.count ?? 0) >= 5 || attempts.size >= 1024) return c.json({ error: "请稍后再试" }, 429);
      attempts.set(ip, { count: (previous?.count ?? 0) + 1, until: previous?.until ?? now + 15 * 60 * 1000 });
      const response = await worker.fetch(new Request(url, c.req.raw), env, {} as ExecutionContext);
      if (response.ok) attempts.delete(ip);
      return response;
    }
    if (url.pathname === "/api/ingest") return c.json({ error: "run the server ingest command over SSH" }, 403);
    return worker.fetch(new Request(url, c.req.raw), env, {} as ExecutionContext);
  });
  const port = Number(process.env.PORT || 8790);
  const server = serve({ fetch: http.fetch, port, hostname: "127.0.0.1" }, (info) => console.log(`AppGap ready on 127.0.0.1:${info.port}`));
  process.on("SIGTERM", () => server.close(() => { db.close(); process.exit(0); }));
}
