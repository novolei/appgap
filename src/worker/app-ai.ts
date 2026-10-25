import type { RuntimeEnv } from "./env";
import { latestSuccessfulIngest } from "./ingest";
import { loadAppDetail } from "./detail";
import { runDeepseekAnalysis } from "./ai";
import { AnalysisError, analysisCache, type AnalysisIdentity } from "./analysis-cache";

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function readAppAnalysis(env: RuntimeEnv, id: string) {
  if (!/^\d{1,20}$/.test(id)) throw new AnalysisError("未知应用。", 404);
  const row = await env.DB.prepare("SELECT updated_at AS updatedAt FROM apps WHERE id=?").bind(id).first<{ updatedAt: string }>();
  if (!row) throw new AnalysisError("未知应用。", 404);
  const latest = await latestSuccessfulIngest(env), cache = analysisCache(env.DB);
  const scope = await digest(["appstore-brief-v3", id, env.DEEPSEEK_MODEL || "deepseek-flash"]);
  const identity: AnalysisIdentity = { key: await digest([scope, latest?.id || 0, row.updatedAt]), scope,
    owner: "", visibility: "shared", runId: latest?.id || 0,
    dataCapturedAt: latest?.finished_at || latest?.started_at || (Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : "") };
  const analysis = await cache.read(identity) || await cache.read(identity, true);
  return { cache, identity, analysis };
}
export async function generateAppAnalysis(env: RuntimeEnv, id: string) {
  const { cache, identity, analysis } = await readAppAnalysis(env, id);
  if (analysis && !analysis.stale) return { ...analysis, budget: await cache.budget() };
  const result = await cache.generate(identity, async () => {
    const detail = await loadAppDetail(env, id);
    if (!detail) throw new AnalysisError("未知应用。", 404);
    return runDeepseekAnalysis(env, detail);
  });
  return { ...result, budget: await cache.budget() };
}
