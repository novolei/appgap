import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database, Statement, DbResult } from "../worker/env";

class SqliteStatement implements Statement {
  constructor(readonly owner: SqliteDatabase, readonly sql: string, readonly values: SQLInputValue[] = []) {}

  bind(...values: unknown[]): SqliteStatement {
    if (values.some((v) => v !== null && typeof v !== "number" && typeof v !== "string")) throw new TypeError("unsupported SQL parameter");
    return new SqliteStatement(this.owner, this.sql, values as SQLInputValue[]);
  }

  async first<T>(): Promise<T | null> {
    return (this.owner.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<DbResult<T>> {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) as T[], meta: { last_row_id: 0, changes: 0 } };
  }

  execute(): DbResult {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { results: [], meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } };
  }

  async run(): Promise<DbResult> { return this.execute(); }
}

export class SqliteDatabase implements Database {
  readonly sqlite: DatabaseSync;

  constructor(path: string, migrations = "migrations") {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)");
    for (const name of readdirSync(migrations).filter((n) => n.endsWith(".sql")).sort()) {
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        if (this.sqlite.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(name)) {
          this.sqlite.exec("COMMIT");
          continue;
        }
        this.sqlite.exec(readFileSync(join(migrations, name), "utf8"));
        this.sqlite.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(name);
        this.sqlite.exec("COMMIT");
      } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
    }
  }

  prepare(sql: string): SqliteStatement { return new SqliteStatement(this, sql); }

  async batch(statements: Statement[]): Promise<DbResult[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => {
        if (!(s instanceof SqliteStatement) || s.owner !== this) throw new TypeError("statement belongs to another database");
        return s.execute();
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  close(): void { this.sqlite.close(); }
}
