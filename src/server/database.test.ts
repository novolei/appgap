import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabase } from "./database";
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const dbs: SqliteDatabase[] = [];
function create() { const db = new SqliteDatabase(":memory:"); dbs.push(db); return db; }
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

describe("SQLite compatibility", () => {
  it("adds persistent login timestamps to an existing database without changing accounts or sessions",()=>{
    const directory=mkdtempSync(join(tmpdir(),"appgap-login-migration-"));
    try{
      const oldMigrations=join(directory,"old");mkdirSync(oldMigrations);
      for(const file of readdirSync("migrations").filter(name=>name.endsWith(".sql")&&name<"0009"))copyFileSync(join("migrations",file),join(oldMigrations,file));
      const path=join(directory,"test.sqlite"),old=new SqliteDatabase(path,oldMigrations);
      old.sqlite.prepare("INSERT INTO user_sessions VALUES('fixture-token','owner','2026-10-20T01:00:00Z','2099-01-01')").run();
      const owner=old.sqlite.prepare("SELECT * FROM users WHERE id='owner'").get();old.close();
      for(let attempt=0;attempt<2;attempt++){
        const migrated=new SqliteDatabase(path);
        try{expect(migrated.sqlite.prepare("SELECT * FROM users WHERE id='owner'").get()).toEqual({...owner,last_login_at:"2026-10-20T01:00:00Z"});expect(migrated.sqlite.prepare("SELECT count(*) AS n FROM user_sessions").get()!.n).toBe(1);}
        finally{migrated.close();}
      }
    }finally{
      if(!resolve(directory).startsWith(resolve(tmpdir())+sep+"appgap-login-migration-"))throw Error("unsafe temporary path");
      rmSync(directory,{recursive:true});
    }
  });
  it("keeps bound statements independent and rolls the whole batch back", async () => {
    const db = create();
    const insert = db.prepare("INSERT INTO pools VALUES (?, ?, ?)");
    await db.batch([insert.bind("1", "watch", "now"), insert.bind("2", "build", "now")]);
    expect((await db.prepare("SELECT app_id FROM pools ORDER BY app_id").all<{ app_id: string }>()).results.map((r) => r.app_id)).toEqual(["1", "2"]);
    await expect(db.batch([insert.bind("3", "watch", "now"), insert.bind("1", "watch", "now")])).rejects.toThrow();
    expect(await db.prepare("SELECT * FROM pools WHERE app_id='3'").first()).toBeNull();
  });
});
