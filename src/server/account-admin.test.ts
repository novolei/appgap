import { afterEach,expect,it } from "vitest";
import { accountRoutes } from "./accounts";
import { SqliteDatabase } from "./database";
import { hash } from "./account-security";
import { loginResponse } from "../worker/auth";
import type { AdminUsers } from "../shared/community";

let db:SqliteDatabase;
afterEach(()=>db?.close());
async function setup(){
  db=new SqliteDatabase(":memory:");
  const env={DB:db,SITE_PASSWORD:"fixture-site-password",ACCOUNTS_ACTIVE:true};
  const app=accountRoutes(env,"https://appgap.test");
  const owner=(await loginResponse(env.SITE_PASSWORD,env,new Request("https://appgap.test"))).headers.get("set-cookie")!.split(";")[0];
  db.sqlite.prepare("INSERT INTO users(id,username,display_name,password_hash,recovery_hash,created_at) VALUES('alpha','alpha','用户甲','PRIVATE_PASSWORD_HASH','PRIVATE_RECOVERY_HASH',?)").run(new Date().toISOString());
  const token="a".repeat(43);
  db.sqlite.prepare("INSERT INTO user_sessions VALUES(?,?,?,?)").run(hash(token),"alpha",new Date().toISOString(),"2099-01-01");
  const get=(query="",cookie=owner)=>app.request("https://appgap.test/admin/users"+query,{headers:{cookie}});
  return {app,owner,get,member:`appgap_user=${token}`};
}
it("refuses anonymous, ordinary and expired sessions even with a forged admin query",async()=>{
  const {get,member}=await setup();
  expect((await get("","")).status).toBe(401);
  expect((await get("?role=admin",member)).status).toBe(403);
  db.sqlite.prepare("UPDATE user_sessions SET expires_at='2000-01-01'").run();
  expect((await get("",member)).status).toBe(401);
});
it("returns bounded, literal searches and clamped pagination with unfiltered summary counts",async()=>{
  const {get}=await setup();
  for(let i=0;i<28;i++)db.sqlite.prepare("INSERT INTO users(id,username,display_name,created_at) VALUES(?,?,?,?)").run(`id-${i}`,`person_${i}`,i===0?"100% 真名":"用户",new Date().toISOString());
  const first=await get();expect(first.headers.get("cache-control")).toBe("no-store");
  const body=await first.json() as AdminUsers;expect(body).toMatchObject({total:30,page:1,pageSize:25,summary:{registered:29,newThisWeek:29,loggedInThisWeek:0,admins:1}});expect(body.items).toHaveLength(25);
  const second=await (await get("?page=999")).json() as AdminUsers;expect(second).toMatchObject({page:2,total:30});expect(second.items).toHaveLength(5);
  expect(new Set([...body.items,...second.items].map(item=>item.id)).size).toBe(30);
  for(const query of ["%","100%","id-0"]){const result=await (await get("?q="+encodeURIComponent(query))).json() as AdminUsers;expect(result.total).toBe(1);expect(result.items[0].id).toBe("id-0");expect(result.summary.registered).toBe(29);}
  expect((await (await get("?q="+encodeURIComponent("' OR 1=1 --"))).json() as AdminUsers).total).toBe(0);
  for(const query of ["?page=0","?page=-1","?page=1.5","?page=1000000","?q="+"x".repeat(65)])expect((await get(query)).status).toBe(400);
});
it("reports per-user totals without exposing credentials, private contents or duplicating donations",async()=>{
  const {get}=await setup();
  for(const [id,pool] of [["1","watch"],["2","watch"],["steam:440","build"]])db.sqlite.prepare("INSERT INTO user_pools VALUES('alpha',?,?,'now')").run(id,pool);
  db.sqlite.prepare("INSERT INTO research_history VALUES('alpha','private-report','PRIVATE_RESEARCH_TITLE','now')").run();
  for(const [id,status,amount] of [["one","confirmed",1230],["two","confirmed",200],["pending","pending",400],["refund","refunded",500]])db.sqlite.prepare("INSERT INTO donations(id,user_id,amount_minor,status,public_name,message,created_at) VALUES(?,'alpha',?,?,'PRIVATE_NAME','PRIVATE_MESSAGE','now')").run(id,amount,status);
  db.sqlite.prepare("UPDATE users SET last_login_at=? WHERE id='alpha'").run(new Date().toISOString());
  const response=await get("?q=ALPHA"),body=await response.json() as AdminUsers;
  expect(body.items).toHaveLength(1);expect(body.items[0]).toMatchObject({id:"alpha",watchCount:2,buildCount:1,researchCount:1,activeSessions:1,donatedMinor:1430});
  expect(body.summary.loggedInThisWeek).toBe(1);
  expect(Object.keys(body.items[0]).sort()).toEqual(["id","username","displayName","role","createdAt","lastLoginAt","watchCount","buildCount","researchCount","activeSessions","donatedMinor"].sort());
  expect(JSON.stringify(body)).not.toContain("PRIVATE_");expect(JSON.stringify(body)).not.toContain(hash("a".repeat(43)));
});
