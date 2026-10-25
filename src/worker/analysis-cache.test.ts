import { afterEach, expect, it, vi } from "vitest";
import { SqliteDatabase } from "../server/database";
import { AnalysisCache, type AnalysisIdentity } from "./analysis-cache";
const databases: SqliteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const identity: AnalysisIdentity = { key: "snapshot-1", scope: "public-scope", owner: "", visibility: "shared", runId: 1, dataCapturedAt: new Date().toISOString() };
function database() { const db = new SqliteDatabase(":memory:"); databases.push(db); return db; }

it("charges shared generations to the requesting account without charging cached readers",async()=>{
  const db=database(),cache=new AnalysisCache(db);
  for(let i=0;i<5;i++)await cache.generate({...identity,key:`public-${i}`},async()=>"complete shared report","account-a");
  await expect(cache.generate({...identity,key:"public-6"},async()=>"blocked","account-a")).rejects.toThrow("额度");
  expect(await cache.generate({...identity,key:"public-0"},async()=>"should not run","account-b")).toMatchObject({cached:true});
  expect(await cache.budget()).toMatchObject({remaining:15});
  expect(await db.prepare("SELECT count(*) AS n FROM ai_call_ledger WHERE owner_hash='account-b'").first()).toEqual({n:0});
});

it("coalesces the same request and persists both cache and daily quota across service instances", async () => {
  const db = database(), cache = new AnalysisCache(db, 2);
  let release!: (value: string) => void;
  const make = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
  const first = cache.generate(identity, make);
  await vi.waitFor(() => expect(make).toHaveBeenCalledTimes(1));
  const second = cache.generate(identity, make);
  await Promise.resolve();
  release("complete result");
  const result = await Promise.all([first, second]);
  expect(result[1].coalesced).toBe(true);
  const restarted = new AnalysisCache(db, 2);
  expect(await restarted.generate(identity, make)).toMatchObject({ cached: true, markdown: "complete result" });
  expect(make).toHaveBeenCalledTimes(1);
  expect(await restarted.budget()).toMatchObject({ remaining: 1 });
  expect(await restarted.read({ ...identity, key: "new-snapshot", runId: 2 }, true)).toMatchObject({ stale: true, runId: 1 });
});
it("counts failed attempts, preserves earlier results and refuses calls after the daily cap", async () => {
  const db = database(), cache = new AnalysisCache(db, 1);
  await cache.save({ ...identity, key: "older" }, "old complete report");
  await expect(cache.generate(identity, async () => { throw Error("provider timeout"); })).rejects.toThrow("timeout");
  expect(await cache.read(identity)).toBeNull();
  expect(await cache.read(identity, true)).toMatchObject({ markdown: "old complete report", stale: true });
  const make = vi.fn(async () => "should not run");
  await expect(cache.generate(identity, make)).rejects.toThrow("额度");
  expect(make).not.toHaveBeenCalled();
});
it("does not return another session's private result and expires old cached content", async () => {
  const db = database(), cache = new AnalysisCache(db);
  const privateA = { ...identity, key: "private-A", owner: "session-A", visibility: "session" as const };
  await cache.save(privateA, "private business idea");
  expect(await cache.read({ ...privateA, owner: "session-B" })).toBeNull();
  expect(await cache.read(identity, true)).toBeNull();
  await db.prepare("UPDATE ai_result_cache SET expires_at='2000-01-01T00:00:00Z'").run();
  expect(await cache.read(privateA)).toBeNull();
});
