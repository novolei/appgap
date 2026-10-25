import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOKUP_CHUNK_SIZE, lookupApps, snapshotDate } from "./apple";

it("uses the Hong Kong date around the old Tokyo midnight boundary", () => {
  expect(snapshotDate(new Date("2026-10-25T15:30:00Z"))).toBe("2026-10-25");
});

describe("lookupApps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps other chunks when Apple 403s one batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("111")) {
          return new Response("denied", { status: 403 });
        }
        return Response.json({
          results: [
            {
              kind: "software",
              trackId: 222,
              trackName: "Ok App",
              artistName: "Studio",
              averageUserRating: 4.2,
              userRatingCount: 90,
            },
          ],
        });
      }),
    );

    const firstChunk = Array.from({ length: LOOKUP_CHUNK_SIZE }, (_, i) => (i === 0 ? "111" : String(10000 + i)));
    const request = lookupApps([...firstChunk, "222"], "us");
    await vi.runAllTimersAsync();
    const found = await request;
    expect(found.some((app) => app.appId === "222")).toBe(true);
  });

  it("stops a blocked country after three 403 chunks instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    const ids = Array.from({ length: LOOKUP_CHUNK_SIZE * 4 }, (_, i) => String(1000 + i));
    const request = lookupApps(ids, "us");
    await vi.runAllTimersAsync();
    await expect(request).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
