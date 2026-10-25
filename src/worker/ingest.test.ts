import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SqliteDatabase } from "../server/database";
import { fetchChart, lookupApps, fetchReviews, INGEST_JOBS } from "./apple";
import { runIngest } from "./ingest";

vi.mock("./apple", async (original) => ({ ...await original<typeof import("./apple")>(), fetchChart: vi.fn(), lookupApps: vi.fn(), fetchReviews: vi.fn() }));
let db: SqliteDatabase;
beforeEach(() => {
  db = new SqliteDatabase(":memory:");
  db.sqlite.exec(`INSERT INTO apps (id,name,artist_name,updated_at) VALUES ('123','Old Scanner','Studio','now');
    INSERT INTO chart_ranks VALUES ('2026-10-24','us','grossing','6002',3,'123');
    INSERT INTO opportunities (lens,app_id,score) VALUES ('paid_tools','123',10);
    INSERT INTO pools VALUES ('123','build','now');`);
  vi.mocked(fetchChart).mockImplementation(async (job) => Array.from({ length: 10 }, (_, i) => ({ appId: `${job.genreId}${i+1}`, name: "Scanner", artistName: "Small Studio", artistId: null, bundleId: null, iconUrl: null, genreId: job.genreId, genreName: "Tools", summary: "scanner", country: job.country, chart: job.chart, rank: i+1 })));
  vi.mocked(lookupApps).mockResolvedValue([]); vi.mocked(fetchReviews).mockResolvedValue([]);
});
afterEach(() => { db.close(); vi.clearAllMocks(); });

it("publishes a full snapshot and preserves the saved project pool", async () => {
  const stats = await runIngest({ DB: db }, { source: "test" });
  expect(stats.charts).toBe(INGEST_JOBS.length * 10);
  expect(stats.opportunities).toBeGreaterThan(0);
  expect(await db.prepare("SELECT status FROM ingest_runs").first()).toEqual({ status: "success" });
  expect(await db.prepare("SELECT pool FROM pools WHERE app_id='123'").first()).toEqual({ pool: "build" });
});

it("keeps every published table intact if final publication fails", async () => {
  db.sqlite.exec("CREATE TRIGGER fail_publish BEFORE INSERT ON chart_ranks BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  await expect(runIngest({ DB: db }, { source: "test" })).rejects.toThrow("injected failure");
  expect(await db.prepare("SELECT COUNT(*) AS n FROM apps").first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT rank FROM chart_ranks").first()).toEqual({ rank: 3 });
  expect(await db.prepare("SELECT app_id FROM opportunities").first()).toEqual({ app_id: "123" });
  expect(await db.prepare("SELECT status FROM ingest_runs").first()).toEqual({ status: "error" });
});

it("allows only one concurrent ingest", async () => {
  const outcomes = await Promise.allSettled([runIngest({ DB: db }, { source: "a" }), runIngest({ DB: db }, { source: "b" })]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
  expect(String(rejected.reason)).toContain("ingest already running");
});

it("rejects a partial market scan instead of misreporting missing countries", async () => {
  vi.mocked(fetchChart).mockImplementation(async (job) => job.country === "us" ? Array.from({ length: 200 }, (_, i) => ({ appId: String(i), name: "Scanner", artistName: "Studio", artistId: null, bundleId: null, iconUrl: null, genreId: job.genreId, genreName: "Tools", summary: "", country: job.country, chart: job.chart, rank: i+1 })) : []);
  await expect(runIngest({ DB: db }, { source: "test" })).rejects.toThrow("榜单不完整");
  expect(await db.prepare("SELECT rank FROM chart_ranks").first()).toEqual({ rank: 3 });
});
