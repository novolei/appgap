import { describe, expect, it } from "vitest";
import { isActivelyIngesting, isStaleRunning, snapshotDateFromStats } from "./ingestStatus";

describe("ingest status", () => {
  it("treats a 13-hour running row as stale, not as live ingest", () => {
    const started = "2026-08-23T02:09:24.873Z";
    const now = Date.parse("2026-08-23T15:09:00Z");
    expect(isStaleRunning(started, now)).toBe(true);
    expect(isActivelyIngesting({ status: "running", started_at: started }, now)).toBe(false);
  });

  it("still locks a run started 2 minutes ago", () => {
    const now = Date.parse("2026-08-23T15:09:00Z");
    const started = new Date(now - 2 * 60 * 1000).toISOString();
    expect(isActivelyIngesting({ status: "running", started_at: started }, now)).toBe(true);
  });

  it("reads snapshot date from last successful stats, not the stuck row", () => {
    expect(snapshotDateFromStats('{"date":"2026-08-22","apps":1684}')).toBe("2026-08-22");
    expect(snapshotDateFromStats(null)).toBe(null);
  });
});
