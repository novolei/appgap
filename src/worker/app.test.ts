import { afterEach, beforeEach, expect, it } from "vitest";
import worker from "../index";
import { SqliteDatabase } from "../server/database";
import { loginResponse } from "./auth";
import type { RuntimeEnv } from "./env";

let db: SqliteDatabase;
let env: RuntimeEnv;
let cookie: string;
beforeEach(async () => {
  db = new SqliteDatabase(":memory:"); env = { DB: db, SITE_PASSWORD: "test-site-password", INGEST_SECRET: "test-ingest" };
  cookie = (await loginResponse(env.SITE_PASSWORD!, env, new Request("https://appgap.test"))).headers.get("set-cookie")!.split(";")[0];
});
afterEach(() => db.close());
function call(path: string, init?: RequestInit) { return worker.fetch(new Request("https://appgap.test" + path, { ...init, headers: { cookie, ...init?.headers } }), env, {} as ExecutionContext); }

it("keeps Steam and App Store saved pools separate despite overlapping numeric IDs", async () => {
  for (const appId of ["123", "steam:123"]) expect((await call("/api/pools", {method:"POST",body:JSON.stringify({appId,pool:"watch"})})).status).toBe(200);
  expect(await (await call("/api/pools")).json()).toEqual({watch:["123"],build:[]});
  expect(await (await call("/api/pools?platform=steam")).json()).toEqual({watch:["steam:123"],build:[]});
});

it("rejects malformed pool inputs without clearing saved data", async () => {
  await db.prepare("INSERT INTO pools VALUES ('123', 'build', 'now')").run();
  for (const body of [{ appId: 123, pool: "watch" }, { appId: "123" }, { appId: "123", pool: false }, { appId: "123", pool: "bad" }]) {
    expect((await call("/api/pools", { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
  }
  expect(await db.prepare("SELECT pool FROM pools WHERE app_id='123'").first()).toEqual({ pool: "build" });
});

it("rejects unauthenticated local-host spoofing and cross-origin writes", async () => {
  const response = await worker.fetch(new Request("https://localhost/api/ingest", { method: "POST" }), env, {} as ExecutionContext);
  expect(response.status).toBe(401);
  expect((await call("/api/pools", { method: "POST", headers: { origin: "https://other.test" }, body: JSON.stringify({ appId: "123", pool: null }) })).status).toBe(403);
  expect((await call("/api/ingest?rebuild=1", { method: "POST" })).status).toBe(400);
});

it("uses the selected country's matching chart and category rank", async () => {
  db.sqlite.exec(`INSERT INTO apps (id,name,artist_name,updated_at) VALUES ('123','Scanner','Studio','now');
    INSERT INTO opportunities (lens,app_id,score,country,chart,genre_id,rank) VALUES ('paid_tools','123',100,'jp','grossing','6002',2);
    INSERT INTO chart_ranks VALUES ('2026-10-25','us','free','6002',1,'123'),('2026-10-25','us','grossing','6002',38,'123');`);
  const response = await call("/api/opportunities?lens=paid_tools&country=us");
  const body = await response.json() as { items: { rank: number; chart: string }[] };
  expect(body.items[0]).toMatchObject({ rank: 38, chart: "grossing" });
});
