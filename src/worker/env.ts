export type RuntimeEnv = Env & {
  SITE_PASSWORD?: string;
  DEEPSEEK_API_KEY?: string;
  INGEST_SECRET?: string;
  ASSETS?: Fetcher;
};
