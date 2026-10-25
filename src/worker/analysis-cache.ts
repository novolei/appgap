import type { Database } from "./env";
import type { AiAnalysis } from "../shared/ai";
export type AnalysisIdentity = {
  key: string; scope: string; owner: string; visibility: "shared" | "session";
  runId: number; dataCapturedAt: string;
};
export class AnalysisError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 429 = 429) { super(message); }
}

export class AnalysisCache {
  private readonly pending = new Map<string, Promise<AiAnalysis>>();
  constructor(private readonly db: Database, private readonly dailyLimit = 20) {}
  private day() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  async budget() {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM ai_call_ledger WHERE day=?").bind(this.day()).first<{ n: number }>();
    return { day: this.day(), limit: this.dailyLimit, remaining: Math.max(0, this.dailyLimit - (row?.n || 0)) };
  }
  async read(identity: AnalysisIdentity, recent = false): Promise<AiAnalysis | null> {
    const row = await this.db.prepare(`SELECT cache_key AS key, markdown, created_at AS createdAt,
      data_captured_at AS dataCapturedAt, run_id AS runId, visibility
      FROM ai_result_cache WHERE ${recent ? "scope_hash=? AND owner_hash=? AND visibility='shared'" : "cache_key=? AND owner_hash=?"}
      AND expires_at>? ORDER BY created_at DESC LIMIT 1`)
      .bind(recent ? identity.scope : identity.key, identity.owner, new Date().toISOString())
      .first<AiAnalysis & { key: string }>();
    if (!row) return null;
    return { markdown: row.markdown, createdAt: row.createdAt, dataCapturedAt: row.dataCapturedAt,
      runId: row.runId, visibility: row.visibility, cached: true, stale: row.key !== identity.key };
  }
  async save(identity: AnalysisIdentity, markdown: string, createdAt = new Date().toISOString()) {
    const days = identity.visibility === "shared" ? 7 : 1;
    await this.db.prepare(`INSERT OR REPLACE INTO ai_result_cache
      (cache_key,scope_hash,owner_hash,visibility,run_id,data_captured_at,created_at,expires_at,markdown)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(identity.key, identity.scope, identity.owner, identity.visibility,
      identity.runId, identity.dataCapturedAt, createdAt, new Date(Date.parse(createdAt) + days * 86400000).toISOString(), markdown).run();
  }
  async generate(identity: AnalysisIdentity, make: () => Promise<string>, requestOwner = identity.owner): Promise<AiAnalysis> {
    const existing = await this.read(identity);
    if (existing) return existing;
    const waiting = this.pending.get(identity.key);
    if (waiting) return { ...await waiting, coalesced: true };
    if (this.pending.size) throw new AnalysisError("另一份研究正在生成；已有缓存仍可阅读，请稍后重试。");
    const task = (async () => {
      const now = new Date().toISOString();
      await this.db.batch([
        this.db.prepare("DELETE FROM ai_result_cache WHERE expires_at<?").bind(now),
        this.db.prepare("DELETE FROM ai_call_ledger WHERE day<?").bind(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
        this.db.prepare("UPDATE ai_call_ledger SET status='error' WHERE status='running' AND created_at<?").bind(new Date(Date.now() - 5 * 60000).toISOString()),
      ]);
      let call;
      try {
        call = await this.db.prepare(`INSERT INTO ai_call_ledger(day,owner_hash,status,created_at)
          SELECT ?,?,'running',? WHERE (SELECT COUNT(*) FROM ai_call_ledger WHERE day=?)<?
          AND (?='' OR (SELECT COUNT(*) FROM ai_call_ledger WHERE day=? AND owner_hash=?)<5)`)
          .bind(this.day(), requestOwner, now, this.day(), this.dailyLimit, requestOwner, this.day(), requestOwner).run();
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) throw new AnalysisError("已有研究正在生成，请稍后重试。");
        throw error;
      }
      if (!call.meta.changes) throw new AnalysisError("今日研究额度已用完。缓存仍可阅读；自定义研究每个会话每日最多 5 次。");
      try {
        const markdown = await make();
        if (!markdown.trim() || markdown.length > 100000) throw Error("invalid analysis length");
        const createdAt = new Date().toISOString();
        await this.save(identity, markdown, createdAt);
        await this.db.prepare("UPDATE ai_call_ledger SET status='success' WHERE id=?").bind(call.meta.last_row_id).run();
        return { markdown, createdAt, dataCapturedAt: identity.dataCapturedAt, runId: identity.runId,
          visibility: identity.visibility, cached: false, stale: false };
      } catch (error) {
        await this.db.prepare("UPDATE ai_call_ledger SET status='error' WHERE id=?").bind(call.meta.last_row_id).run();
        throw error;
      }
    })();
    this.pending.set(identity.key, task);
    try { return await task; } finally { if (this.pending.get(identity.key) === task) this.pending.delete(identity.key); }
  }
}

const registries = new WeakMap<Database, AnalysisCache>();
export function analysisCache(db: Database) {
  let cache = registries.get(db);
  if (!cache) { cache = new AnalysisCache(db); registries.set(db, cache); }
  return cache;
}
