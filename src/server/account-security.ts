import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { RuntimeEnv } from "../worker/env";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const ownerHash = (id: string) => hash(`account:${id}`);
export const secret = () => randomBytes(32).toString("base64url");
export function passwordValid(value: unknown): value is string { return typeof value === "string" && value.length >= 8 && value.length <= 128; }
let hashing = 0;
async function derive(password: string, salt: string) {
  if (hashing >= 2) throw new Error("密码验证繁忙，请稍后再试。");
  hashing++;
  try {
    return await new Promise<Buffer>((resolve,reject) => scrypt(password,salt,64,{ N:131072,r:8,p:1,maxmem:160*1024*1024 },(error,key) => error ? reject(error) : resolve(key)));
  } finally { hashing--; }
}
export async function passwordHash(password: string) {
  const salt=randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password,salt)).toString("hex")}`;
}
export async function passwordMatches(password: string, stored: string | null) {
  const [,salt,key]= (stored || "").split(":");
  const expected=Buffer.from(key || "00".repeat(64),"hex");
  const actual=await derive(password,salt || "00".repeat(16));
  return Boolean(stored) && expected.length===actual.length && timingSafeEqual(expected,actual);
}
export async function limited(env: RuntimeEnv, bucket: string, max=8) {
  const now=Date.now();
  await env.DB.prepare("DELETE FROM account_attempts WHERE expires_at<?").bind(now).run();
  const result=await env.DB.prepare(`INSERT INTO account_attempts VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 WHERE attempts<?`).bind(hash(bucket),now+15*60000,max).run();
  return result.meta.changes > 0;
}
export function cookie(c: Context,name: string,value: string,maxAge=30*86400) {
  c.header("Set-Cookie",`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(c.req.url).protocol==="https:" || c.req.header("x-forwarded-proto")==="https" ? "; Secure" : ""}`,{append:true});
}
export async function session(c: Context,env: RuntimeEnv,id: string) {
  const token=secret(),now=new Date().toISOString();
  await env.DB.prepare("DELETE FROM user_sessions WHERE expires_at<?").bind(now).run();
  await env.DB.prepare("INSERT INTO user_sessions VALUES(?,?,?,?)").bind(hash(token),id,now,new Date(Date.now()+30*86400000).toISOString()).run();
  cookie(c,"appgap_user",token);
}
