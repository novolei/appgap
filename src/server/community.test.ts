import { afterEach,expect,it } from "vitest";
import { Hono } from "hono";
import { accountRoutes } from "./accounts";
import { amountMinor,donationRoutes } from "./donations";
import { SqliteDatabase } from "./database";
import { authenticatedUser,loginResponse } from "../worker/auth";
import { ownerHash,passwordValid } from "./account-security";
import type { RuntimeEnv } from "../worker/env";
import worker from "../index";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let db:SqliteDatabase;
afterEach(()=>db?.close());
function setup(qrPath?:string){db=new SqliteDatabase(":memory:");const env:RuntimeEnv={DB:db,SITE_PASSWORD:"fixture-site-password",ACCOUNTS_ACTIVE:true};const app=new Hono().route("/api/account",accountRoutes(env,"https://appgap.test")).route("/api/donations",donationRoutes(env,"https://appgap.test",undefined,qrPath));return {env,app};}
const request=(path:string,body?:unknown,cookie="",origin="https://appgap.test")=>new Request("https://appgap.test"+path,{method:body===undefined?"GET":"POST",headers:{cookie,origin,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
async function register(app:ReturnType<typeof setup>["app"],username:string){const response=await app.request(request("/api/account/register",{username,password:"fixture-password-123"}));expect(response.status).toBe(201);return{cookie:response.headers.get("set-cookie")!.split(";")[0],body:await response.json() as {recoveryCode:string}};}

it("hashes credentials with independent salts and revokes server sessions on logout",async()=>{
  const {app,env}=setup(),a=await register(app,"alpha"),b=await register(app,"beta");
  const rows=db.sqlite.prepare("SELECT password_hash,recovery_hash FROM users WHERE role='member'").all();
  expect(rows[0].password_hash).not.toBe(rows[1].password_hash);expect(JSON.stringify(rows)).not.toContain("fixture-password");expect(JSON.stringify(rows)).not.toContain(a.body.recoveryCode);
  expect(await authenticatedUser(request("/",undefined,a.cookie),env)).toMatchObject({username:"alpha"});
  expect(a.cookie).not.toBe(b.cookie);
  expect((await app.request(request("/api/account/logout",{},a.cookie))).status).toBe(200);
  expect(await authenticatedUser(request("/",undefined,a.cookie),env)).toBeNull();
  expect((await app.request(request("/api/account/register",{username:"ALPHA",password:"fixture-password-123"}))).status).toBe(409);
});
it("consumes recovery codes once and invalidates every earlier login",async()=>{
  const {app,env}=setup(),a=await register(app,"alpha");
  const recovered=await app.request(request("/api/account/recover",{username:"alpha",recoveryCode:a.body.recoveryCode,newPassword:"a-new-fixture-password"}));
  expect(recovered.status).toBe(200);expect(await authenticatedUser(request("/",undefined,a.cookie),env)).toBeNull();
  expect((await app.request(request("/api/account/recover",{username:"alpha",recoveryCode:a.body.recoveryCode,newPassword:"a-new-fixture-password"}))).status).toBe(401);
  expect((await app.request(request("/api/account/login",{username:"alpha",password:"fixture-password-123"}))).status).toBe(401);
  expect((await app.request(request("/api/account/login",{username:"alpha",password:"a-new-fixture-password"}))).status).toBe(200);
});
it("accepts eight-character passwords for registration, changes and recovery, rejecting seven",async()=>{
  for(const value of [null,12345678,"1234567","x".repeat(129)])expect(passwordValid(value)).toBe(false);
  expect(passwordValid("12345678")).toBe(true);expect(passwordValid("x".repeat(128))).toBe(true);
  const {app,env}=setup();
  expect((await app.request(request("/api/account/register",{username:"eight",password:"1234567"}))).status).toBe(400);
  const registered=await app.request(request("/api/account/register",{username:"eight",password:"test1234"}));expect(registered.status).toBe(201);
  const cookie=registered.headers.get("set-cookie")!.split(";")[0];
  const oldCode=(await registered.json() as {recoveryCode:string}).recoveryCode;
  expect((await app.request(request("/api/account/login",{username:"eight",password:"test1234"}))).status).toBe(200);
  expect((await app.request(request("/api/account/password",{password:"test1234",newPassword:"1234567"},cookie))).status).toBe(400);
  const changed=await app.request(request("/api/account/password",{password:"test1234",newPassword:"next1234"},cookie));expect(changed.status).toBe(200);
  const newCode=(await changed.json() as {recoveryCode:string}).recoveryCode;expect(newCode).not.toBe(oldCode);
  expect(await authenticatedUser(request("/",undefined,cookie),env)).toBeNull();
  expect((await app.request(request("/api/account/recover",{username:"eight",recoveryCode:newCode,newPassword:"1234567"}))).status).toBe(400);
  expect((await app.request(request("/api/account/recover",{username:"eight",recoveryCode:newCode,newPassword:"back1234"}))).status).toBe(200);
  expect((await app.request(request("/api/account/login",{username:"eight",password:"back1234"}))).status).toBe(200);
});
it("isolates saved pools and report history while retaining the administrator's legacy data",async()=>{
  const {app,env}=setup(),a=await register(app,"alpha"),b=await register(app,"beta");
  const call=(path:string,body:unknown,cookie:string)=>worker.fetch(request(path,body,cookie),env,{} as ExecutionContext);
  expect((await call("/api/pools",{appId:"steam:42",pool:"watch"},a.cookie)).status).toBe(200);
  expect(await (await call("/api/pools?platform=steam",undefined,b.cookie)).json()).toEqual({watch:[],build:[]});
  const actor=(await authenticatedUser(request("/",undefined,a.cookie),env))!;
  db.sqlite.prepare("INSERT INTO ai_result_cache VALUES(?,?,?,?,?,?,?,?,?)").run("private-report","scope",ownerHash(actor.id),"session",1,"now","now","2099-01-01","private content");
  db.sqlite.prepare("INSERT INTO research_history VALUES(?,?,?,?)").run(actor.id,"private-report","secret concept","now");
  expect((await app.request(request("/api/account/research/private-report",undefined,b.cookie))).status).toBe(404);
  expect((await app.request(request("/api/account/research/private-report",undefined,a.cookie))).status).toBe(200);
  const login=await app.request(request("/api/account/login",{username:"alpha",password:"fixture-password-123"}));
  expect((await app.request(request("/api/account/research/private-report",undefined,login.headers.get("set-cookie")!.split(";")[0]))).status).toBe(200);
  db.sqlite.prepare("INSERT INTO user_pools VALUES('owner','123','build','now')").run();
  const owner=(await loginResponse(env.SITE_PASSWORD!,env,request("/"))).headers.get("set-cookie")!.split(";")[0];
  expect(await (await call("/api/pools",undefined,owner)).json()).toEqual({watch:[],build:["123"]});
  expect(await (await call("/api/pools",undefined,b.cookie)).json()).toEqual({watch:[],build:[]});
});
it("counts only confirmed consenting donations, prevents duplicate settlement, and removes refunds",async()=>{
  const {app,env}=setup(),a=await register(app,"alpha"),b=await register(app,"beta");
  const owner=(await loginResponse(env.SITE_PASSWORD!,env,request("/"))).headers.get("set-cookie")!.split(";")[0];
  const first=await app.request(request("/api/donations/intent",{amount:"20.50",public:true,name:"Supporter",message:"Test only"},a.cookie));
  const id=(await first.json() as {id:string}).id;
  const feed=async()=>await (await app.request(request("/api/donations/public"))).json() as {rankings:{amountMinor:number}[];recent:unknown[];totals:{amountMinor:number}};
  expect((await feed()).rankings).toHaveLength(0);
  expect((await app.request(request(`/api/donations/admin/${id}/review`,{action:"confirm",amount:"20.50",reference:"fixture-bank-001"},a.cookie))).status).toBe(403);
  const confirm=()=>app.request(request(`/api/donations/admin/${id}/review`,{action:"confirm",amount:"20.50",reference:"fixture-bank-001"},owner));
  expect((await confirm()).status).toBe(200);expect((await confirm()).status).toBe(409);expect((await feed()).rankings[0].amountMinor).toBe(2050);
  expect((await app.request(request(`/api/donations/${id}/privacy`,{public:false},b.cookie))).status).toBe(404);
  await app.request(request(`/api/donations/${id}/privacy`,{public:false},a.cookie));expect((await feed()).recent).toHaveLength(0);expect((await feed()).totals.amountMinor).toBe(2050);
  await app.request(request(`/api/donations/${id}/privacy`,{public:true},a.cookie));
  const second=await app.request(request("/api/donations/intent",{amount:"8",public:true,name:"Other",message:""},b.cookie));const other=(await second.json() as {id:string}).id;
  expect((await app.request(request(`/api/donations/admin/${other}/review`,{action:"confirm",amount:"8",reference:"fixture-bank-001"},owner))).status).toBe(409);
  await app.request(request(`/api/donations/admin/${id}/review`,{action:"refund"},owner));expect((await feed()).totals.amountMinor).toBe(0);expect((await feed()).rankings).toHaveLength(0);
});
it("validates exact decimal amounts and rejects cross-origin identity changes",async()=>{
  const {app}=setup();for(const amount of ["0.1","1e4","20.001","100000.01",1,null,"-20"])expect(amountMinor(amount)).toBeNull();expect(amountMinor("12.30")).toBe(1230);
  expect((await app.request(request("/api/account/register",{username:"alpha",password:"fixture-password-123"},"","https://evil.test"))).status).toBe(403);
  expect((await app.request(request("/api/account/register",{username:"ab",password:"short"}))).status).toBe(400);
});
it("serves only the configured bounded PNG receipt code and refuses other file contents",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"appgap-qr-test-")),path=join(dir,"qr.png");
  try{
    const {app}=setup(path);
    writeFileSync(path,"NOT_AN_IMAGE=fixture");expect((await app.request(request("/api/donations/qr"))).status).toBe(404);
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=","base64");
    writeFileSync(path,png);const response=await app.request(request("/api/donations/qr"));expect(response.headers.get("content-type")).toBe("image/png");expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    writeFileSync(path,Buffer.alloc(2*1024*1024+1));expect((await app.request(request("/api/donations/qr"))).status).toBe(404);
  }finally{rmSync(dir,{recursive:true});}
});
