import type { AppDetail, MetaResponse, OpportunityListResponse, OpportunityRow } from "../shared/types";
import type { LensId } from "../shared/catalog";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) {
    window.location.reload();
    throw new Error("需要密码");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `请求失败 ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchMeta() {
  return getJson<MetaResponse>("/api/meta");
}

export function fetchOpportunities(lens: LensId, country?: string) {
  const params = new URLSearchParams({ lens });
  if (country) params.set("country", country);
  return getJson<OpportunityListResponse>(`/api/opportunities?${params.toString()}`);
}

export function requestAnalysis(id: string, fresh = false) {
  const q = fresh ? "?fresh=1" : "";
  return getJson<{ markdown: string; createdAt: string; cached: boolean }>(`/api/apps/${id}/analyze${q}`, {
    method: "POST",
  });
}

export async function fetchAppsByIds(ids: string[]) {
  if (ids.length === 0) return Promise.resolve({ items: [] as OpportunityRow[] });
  const batches: Promise<{ items: OpportunityRow[] }>[] = [];
  for (let i = 0; i < ids.length; i += 40) batches.push(getJson<{ items: OpportunityRow[] }>(`/api/apps?ids=${ids.slice(i, i + 40).join(",")}`));
  return { items: (await Promise.all(batches)).flatMap((batch) => batch.items) };
}

export function fetchAppDetail(id: string) {
  return getJson<AppDetail>(`/api/apps/${id}`);
}

export function fetchPools() {
  return getJson<{ watch: string[]; build: string[] }>("/api/pools");
}

export function savePool(appId: string, pool: "watch" | "build" | null) {
  return getJson<{ ok: true }>("/api/pools", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, pool }),
  });
}
