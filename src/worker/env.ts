export type DbResult<T = unknown> = { results: T[]; meta: { last_row_id: number; changes: number } };

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<DbResult<T>>;
  run(): Promise<DbResult>;
}

export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<DbResult[]>;
}

export type DataEnv = { DB: Database };

export type RuntimeEnv = DataEnv & {
  SITE_PASSWORD?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  INGEST_SECRET?: string;
  ALLOW_LOCAL_INGEST?: boolean;
  ASSETS?: Fetcher;
};
