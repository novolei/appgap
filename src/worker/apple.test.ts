import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOKUP_CHUNK_SIZE, lookupApps } from "./apple";

describe("lookupApps", () => {
  afterEach(() => {
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

    const firstChunk = Array.from({ length: LOOKUP_CHUNK_SIZE }, (_, i) => (i === 0 ? "111" : `1${i}`));
    const found = await lookupApps([...firstChunk, "222"], "us");
    expect(found.some((app) => app.appId === "222")).toBe(true);
  });

  it("stops a blocked country after three 403 chunks instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    const ids = Array.from({ length: 40 }, (_, i) => String(1000 + i));
    await expect(lookupApps(ids, "us")).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
