import { afterEach, expect, it, vi } from "vitest";
import { fetchAppsByIds } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("loads all saved apps beyond the server's 40-ID batch limit", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ items: new URL(url, "https://appgap.test").searchParams.get("ids")!.split(",").map((appId) => ({ appId })) })));
  const response = await fetchAppsByIds(Array.from({ length: 85 }, (_, i) => String(i + 1)));
  expect(response.items).toHaveLength(85);
  expect(fetch).toHaveBeenCalledTimes(3);
});
