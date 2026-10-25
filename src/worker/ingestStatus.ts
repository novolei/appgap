export const INGEST_STALE_MS = 60 * 60 * 1000;

export type IngestRunRow = {
  id: number;
  source: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  stats: string | null;
  error: string | null;
};

export function isStaleRunning(startedAt: string, now = Date.now(), staleMs = INGEST_STALE_MS): boolean {
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && now - started >= staleMs;
}

export function isActivelyIngesting(
  latest: { status: string; started_at: string } | null,
  now = Date.now(),
): boolean {
  if (!latest || latest.status !== "running") return false;
  return !isStaleRunning(latest.started_at, now);
}

export function snapshotDateFromStats(stats: string | null | undefined): string | null {
  if (!stats) return null;
  try {
    return (JSON.parse(stats) as { date?: string }).date ?? null;
  } catch {
    return null;
  }
}
