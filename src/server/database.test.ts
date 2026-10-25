import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabase } from "./database";

const dbs: SqliteDatabase[] = [];
function create() { const db = new SqliteDatabase(":memory:"); dbs.push(db); return db; }
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

describe("SQLite compatibility", () => {
  it("keeps bound statements independent and rolls the whole batch back", async () => {
    const db = create();
    const insert = db.prepare("INSERT INTO pools VALUES (?, ?, ?)");
    await db.batch([insert.bind("1", "watch", "now"), insert.bind("2", "build", "now")]);
    expect((await db.prepare("SELECT app_id FROM pools ORDER BY app_id").all<{ app_id: string }>()).results.map((r) => r.app_id)).toEqual(["1", "2"]);
    await expect(db.batch([insert.bind("3", "watch", "now"), insert.bind("1", "watch", "now")])).rejects.toThrow();
    expect(await db.prepare("SELECT * FROM pools WHERE app_id='3'").first()).toBeNull();
  });
});
