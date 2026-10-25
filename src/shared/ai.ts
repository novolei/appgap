export type AiAnalysis = {
  markdown: string; createdAt: string; dataCapturedAt: string; runId: number;
  visibility: "shared" | "session"; cached: boolean; stale: boolean; coalesced?: boolean;
};
