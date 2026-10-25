import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SteamGame, SteamSnapshot } from "../shared/steam";
import { buildSteamView } from "./steam-analysis";
import { steamRoutes } from "./steam";
import { SqliteDatabase } from "./database";
import { loginResponse } from "../worker/auth";

const game = (appId: string, tags: string[], free = false): SteamGame => ({
  appId,
  name: appId,
  free,
  description: "test",
  tags,
  developers: [],
  publishers: [],
  priceUsd: free ? 0 : 10,
  priceOriginalUsd: 10,
  discountPct: 0,
  reviewCount: 100,
  positivePct: 90,
  url: "https://store.steampowered.com/app/" + appId,
  opportunity: {
    score: 55,
    demand: 50,
    pain: 10,
    momentum: null,
    feasibility: 80,
    confidence: "初步线索",
    regions: 1,
    bestSalesRank: 1,
    averageRankChange: null,
    changeComparisons: 0,
  },
});
const fixture: SteamSnapshot = {
  schemaVersion: 1,
  runId: 1,
  capturedAt: "2026-10-25T08:00:00Z",
  startedAt: "2026-10-25T07:00:00Z",
  date: "2026-10-25",
  reviewWindow: { start: 1, end: 1000000, days: 30 },
  countries: [
    { id: "GLOBAL", name: "Global" },
    { id: "US", name: "USA" },
  ],
  games: {
    "1": game("1", ["Puzzle"]),
    "2": game("2", ["Action"], true),
    "3": game("3", ["Puzzle"]),
  },
  ranks: [
    { country: "GLOBAL", chart: "sales", rank: 1, appId: "1" },
    { country: "GLOBAL", chart: "sales", rank: 2, appId: "2" },
    { country: "US", chart: "sales", rank: 1, appId: "1" },
    { country: "US", chart: "sales", rank: 2, appId: "3" },
    { country: "US", chart: "sales", rank: 3, appId: "2" },
    { country: "GLOBAL", chart: "free", rank: 1, appId: "2" },
  ],
  coverage: [],
  sources: [],
  reviewCoverage: { targeted: 3, succeeded: 0 },
};

it("deduplicates union games and keeps region matrix denominators outside tag selection", () => {
  const union = buildSteamView(
    fixture,
    new URLSearchParams({ country: "ALL" }),
  );
  expect(union.summary.n).toBe(3);
  expect(union.summary.paid).toBe(2);
  const view = buildSteamView(
    fixture,
    new URLSearchParams({ country: "US", tag: "Puzzle" }),
  );
  expect(view.summary.n).toBe(2);
  expect(
    view.matrix
      .find((r) => r.country === "US")!
      .cells.find((c) => c.tag === "Puzzle"),
  ).toEqual({ tag: "Puzzle", n: 2, denominator: 3, index: 133 });
  expect(view.summary.rising).toBe(0);
  expect(view.summary.compared).toBe(0);
  expect(view.summary.medianPrice).toBe(10);
});
it("derives regional free signals from sales and rejects nonexistent local player charts", () => {
  expect(
    buildSteamView(
      fixture,
      new URLSearchParams({ country: "US", chart: "free" }),
    ).games.map((g) => g.appId),
  ).toEqual(["2"]);
  expect(() =>
    buildSteamView(
      fixture,
      new URLSearchParams({ country: "US", chart: "players" }),
    ),
  ).toThrow("仅有全球");
  expect(() =>
    buildSteamView(fixture, new URLSearchParams({ country: "XX" })),
  ).toThrow("未知");
});
const directories: string[] = [];
const databases: SqliteDatabase[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  directories.splice(0).forEach((path) => {
    if (!path.startsWith(join(tmpdir(), "appgap-steam-route-")))
      throw Error("unsafe temporary path");
    rmSync(path, { recursive: true });
  });
});
it("protects snapshots and AI mutations, invalidates replaced cache, and tolerates first-run absence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "appgap-steam-route-"));
  directories.push(directory);
  const db = new SqliteDatabase(":memory:");
  databases.push(db);
  const env = { DB: db, SITE_PASSWORD: "test-site-password" };
  const app = steamRoutes(env, directory, "https://appgap.test");
  expect((await app.request("https://appgap.test/export")).status).toBe(401);
  const cookie = (
    await loginResponse(
      env.SITE_PASSWORD,
      env,
      new Request("https://appgap.test"),
    )
  ).headers
    .get("set-cookie")!
    .split(";")[0];
  const headers = { cookie };
  expect(
    (await app.request("https://appgap.test/view", { headers })).status,
  ).toBe(503);
  writeFileSync(join(directory, "latest.json"), JSON.stringify(fixture));
  expect(
    (
      (await (
        await app.request("https://appgap.test/view?country=ALL", { headers })
      ).json()) as { summary: { n: number } }
    ).summary.n,
  ).toBe(3);
  expect(
    (
      await app.request("https://appgap.test/analyze", {
        method: "POST",
        headers: { ...headers, origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await app.request("https://appgap.test/game/1", { headers })).status,
  ).toBe(200);
  writeFileSync(
    join(directory, "latest.json"),
    JSON.stringify({ ...fixture, schemaVersion: 99 }),
  );
  expect(
    (await app.request("https://appgap.test/view", { headers })).status,
  ).toBe(503);
});
