import type { OpportunityRow } from "../shared/types";
import type { PoolId } from "../shared/catalog";

const KEY = "appgap.pools.v1";

export type PooledApp = OpportunityRow & { pooledAt: string };

type Pools = {
  watch: PooledApp[];
  build: PooledApp[];
};

function empty(): Pools {
  return { watch: [], build: [] };
}

export function readPools(): Pools {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Pools>;
    return {
      watch: Array.isArray(parsed.watch) ? parsed.watch : [],
      build: Array.isArray(parsed.build) ? parsed.build : [],
    };
  } catch {
    return empty();
  }
}

function writePools(pools: Pools) {
  localStorage.setItem(KEY, JSON.stringify(pools));
}

export function poolHas(pools: Pools, id: PoolId, appId: string) {
  return pools[id].some((item) => item.appId === appId);
}

export function togglePool(pools: Pools, id: PoolId, app: OpportunityRow): Pools {
  const exists = poolHas(pools, id, app.appId);
  const next: Pools = {
    watch: pools.watch.filter((item) => item.appId !== app.appId),
    build: pools.build.filter((item) => item.appId !== app.appId),
  };
  if (!exists) {
    next[id] = [{ ...app, pooledAt: new Date().toISOString() }, ...next[id]];
  }
  writePools(next);
  return next;
}

export function isBuilt(pools: Pools, appId: string) {
  return poolHas(pools, "build", appId);
}
