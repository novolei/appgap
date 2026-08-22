import type { AppDetail, MetaResponse, OpportunityListResponse, OpportunityRow } from "../shared/types";
import type { LensId } from "../shared/catalog";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchMeta() {
  return getJson<MetaResponse>("/api/meta");
}

export function fetchOpportunities(lens: LensId) {
  return getJson<OpportunityListResponse>(`/api/opportunities?lens=${lens}`);
}

export function fetchAppsByIds(ids: string[]) {
  if (ids.length === 0) return Promise.resolve({ items: [] as OpportunityRow[] });
  return getJson<{ items: OpportunityRow[] }>(`/api/apps?ids=${ids.join(",")}`);
}

export function fetchAppDetail(id: string) {
  return getJson<AppDetail>(`/api/apps/${id}`);
}

export function fetchPools() {
  return getJson<{ watch: string[]; build: string[] }>("/api/pools");
}

export function savePool(appId: string, pool: "watch" | "build" | null) {
  return fetch("/api/pools", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, pool }),
  }).then((response) => {
    if (!response.ok) throw new Error("保存失败");
  });
}
