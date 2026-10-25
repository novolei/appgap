import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import { authenticatedUser } from "../worker/auth";
import type { RuntimeEnv } from "../worker/env";
import { analysisCache } from "../worker/analysis-cache";
import { cookie, hash, limited, ownerHash, passwordHash, passwordMatches, passwordValid, secret, session } from "./account-security";

type Credentials = { username: string; password: string; displayName?: string; recoveryCode?: string; newPassword?: string };
export function accountRoutes(env: RuntimeEnv,origin: string) {
  const app=new Hono();
  const actor=(request: Request) => authenticatedUser(request,env);
  app.onError((error,c) => c.json({error:error instanceof HTTPException ? error.message : "操作未完成，请稍后重试。"},error instanceof HTTPException ? error.status : 503));
  app.use("*",async(c,next) => {
    if (c.req.method!=="GET" && (c.req.header("origin") && c.req.header("origin")!==origin || c.req.header("sec-fetch-site")==="cross-site")) throw new HTTPException(403,{message:"请求来源不受信任。"});
    await next();
  });
  async function credentials(c: Parameters<typeof session>[0]): Promise<Credentials> {
    if (!c.req.header("content-type")?.startsWith("application/json")) throw new HTTPException(400,{message:"请提交 JSON。"});
    const body=await c.req.json().catch(()=>null);
    if (!body || typeof body!=="object" || Array.isArray(body)) throw new HTTPException(400,{message:"内容格式错误。"});
    return body;
  }
  async function gate(c: Parameters<typeof session>[0],name: string) {
    const ip=c.req.header("cf-connecting-ip") || "local";
    if (!await limited(env,`auth-ip:${ip}`,12) || !await limited(env,`auth-name:${name}`,8)) throw new HTTPException(429,{message:"尝试过于频繁，请 15 分钟后再试。"});
  }
  app.get("/me",async c => {
    const user=await actor(c.req.raw);
    if (!user) return c.json({user:null});
    const stored=await env.DB.prepare("SELECT id,username,display_name AS displayName,role,created_at AS createdAt FROM users WHERE id=?").bind(user.id).first();
    return c.json({user:stored || user});
  });
  app.post("/register",async c => {
    const body=await credentials(c);
    const username=typeof body.username==="string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(username) || !passwordValid(body.password)) throw new HTTPException(400,{message:"用户名为 3–24 位字母、数字、下划线或短横线；密码为 12–128 个字符。"});
    const name=typeof body.displayName==="string" ? body.displayName.trim() : username;
    if (!name || name.length>32 || /[\u0000-\u001f\u007f]/.test(name)) throw new HTTPException(400,{message:"昵称为 1–32 个可见字符。"});
    await gate(c,username);
    const registrations=await env.DB.prepare("SELECT count(*) AS n FROM users WHERE created_at>?").bind(new Date(Date.now()-86400000).toISOString()).first<{n:number}>();
    if((registrations?.n||0)>=100)throw new HTTPException(429,{message:"今日注册名额已满，请明天再来。"});
    const id=randomUUID(),recoveryCode=secret(),stored=await passwordHash(body.password);
    const result=await env.DB.prepare("INSERT INTO users(id,username,display_name,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(username) DO NOTHING")
      .bind(id,username,name,stored,hash(recoveryCode),new Date().toISOString()).run();
    if (!result.meta.changes) throw new HTTPException(409,{message:"这个用户名暂不可用，请换一个。"});
    await session(c,env,id);
    return c.json({ok:true,recoveryCode},201);
  });
  app.post("/login",async c => {
    const body=await credentials(c),username=typeof body.username==="string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(username) || typeof body.password!=="string" || body.password.length>128) throw new HTTPException(400,{message:"请检查用户名和密码。"});
    await gate(c,username);
    const user=await env.DB.prepare("SELECT id,password_hash AS passwordHash FROM users WHERE username=?").bind(username).first<{id:string;passwordHash:string|null}>();
    if (!await passwordMatches(body.password,user?.passwordHash || null)) throw new HTTPException(401,{message:"用户名或密码不正确。"});
    await session(c,env,user!.id);
    return c.json({ok:true});
  });
  app.post("/recover",async c => {
    const body=await credentials(c),username=typeof body.username==="string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(username) || typeof body.recoveryCode!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(body.recoveryCode) || !passwordValid(body.newPassword)) throw new HTTPException(400,{message:"请填写用户名、有效恢复码和至少 12 字符的新密码。"});
    await gate(c,username);
    const user=await env.DB.prepare("SELECT id FROM users WHERE username=? AND recovery_hash=?").bind(username,hash(body.recoveryCode)).first<{id:string}>();
    if (!user) throw new HTTPException(401,{message:"账号或恢复码不正确，或恢复码已使用。"});
    const newCode=secret(),newHash=await passwordHash(body.newPassword);
    const changed=await env.DB.prepare("UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?").bind(newHash,hash(newCode),user.id,hash(body.recoveryCode)).run();
    if (!changed.meta.changes) throw new HTTPException(409,{message:"恢复码已使用。"});
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id=?").bind(user.id).run();
    await session(c,env,user.id);
    return c.json({ok:true,recoveryCode:newCode});
  });
  app.post("/logout",async c => {
    const token=c.req.header("cookie")?.match(/(?:^|;\s*)appgap_user=([^;]+)/)?.[1];
    if(token) await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash=?").bind(hash(token)).run();
    cookie(c,"appgap_user","",0);cookie(c,"appgap_session","",0);
    return c.json({ok:true});
  });
  app.use("*",async(c,next) => { if(!await actor(c.req.raw)) throw new HTTPException(401,{message:"请先登录。"});await next(); });
  app.get("/dashboard",async c => {
    const user=(await actor(c.req.raw))!;
    const pools=await env.DB.prepare("SELECT pool,count(*) AS n FROM user_pools WHERE user_id=? GROUP BY pool").bind(user.id).all();
    const history=await env.DB.prepare(`SELECT h.cache_key AS id,h.title,h.created_at AS visitedAt,a.created_at AS createdAt,a.expires_at AS expiresAt,a.visibility
      FROM research_history h JOIN ai_result_cache a ON a.cache_key=h.cache_key WHERE h.user_id=? AND (a.owner_hash='' OR a.owner_hash=?) ORDER BY h.created_at DESC LIMIT 30`).bind(user.id,ownerHash(user.id)).all();
    const sessions=await env.DB.prepare("SELECT count(*) AS n FROM user_sessions WHERE user_id=? AND expires_at>?").bind(user.id,new Date().toISOString()).first<{n:number}>();
    const day=(await analysisCache(env.DB).budget()).day;
    const used=await env.DB.prepare("SELECT count(*) AS n FROM ai_call_ledger WHERE day=? AND owner_hash=?").bind(day,ownerHash(user.id)).first<{n:number}>();
    return c.json({user,pools:pools.results,history:history.results,sessions:sessions?.n||0,personalRemaining:Math.max(0,5-(used?.n||0)),budget:await analysisCache(env.DB).budget()});
  });
  app.get("/research/:id",async c => {
    const user=(await actor(c.req.raw))!;
    const result=await env.DB.prepare(`SELECT a.markdown,h.title,a.created_at AS createdAt,a.expires_at AS expiresAt FROM research_history h
      JOIN ai_result_cache a ON a.cache_key=h.cache_key WHERE h.user_id=? AND h.cache_key=? AND (a.owner_hash='' OR a.owner_hash=?) AND a.expires_at>?`)
      .bind(user.id,c.req.param("id"),ownerHash(user.id),new Date().toISOString()).first();
    if(!result) throw new HTTPException(404,{message:"报告已过期或无权访问。"});return c.json(result);
  });
  app.post("/profile",async c => {
    const user=(await actor(c.req.raw))!,body=await credentials(c);
    const name=typeof body.displayName==="string" ? body.displayName.trim() : "";
    if(!name || name.length>32 || /[\u0000-\u001f\u007f]/.test(name)) throw new HTTPException(400,{message:"昵称为 1–32 个可见字符。"});
    await env.DB.prepare("UPDATE users SET display_name=? WHERE id=?").bind(name,user.id).run();return c.json({ok:true});
  });
  app.post("/password",async c => {
    const user=(await actor(c.req.raw))!,body=await credentials(c);
    if(typeof body.password!=="string" || body.password.length>128 || !passwordValid(body.newPassword)) throw new HTTPException(400,{message:"新密码至少 12 个字符。"});
    await gate(c,user.username);
    const stored=await env.DB.prepare("SELECT password_hash AS passwordHash FROM users WHERE id=?").bind(user.id).first<{passwordHash:string|null}>();
    if(!await passwordMatches(body.password,stored?.passwordHash||null)) throw new HTTPException(401,{message:"当前密码不正确。"});
    const recoveryCode=secret(),newHash=await passwordHash(body.newPassword);
    const updated=await env.DB.prepare("UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND password_hash=?").bind(newHash,hash(recoveryCode),user.id,stored!.passwordHash).run();
    if(!updated.meta.changes)throw new HTTPException(409,{message:"密码已变化，请重新登录。"});
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id=?").bind(user.id).run();
    await session(c,env,user.id);return c.json({ok:true,recoveryCode});
  });
  app.post("/revoke-sessions",async c => {
    const user=(await actor(c.req.raw))!;
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id=?").bind(user.id).run();
    cookie(c,"appgap_user","",0);cookie(c,"appgap_session","",0);return c.json({ok:true});
  });
  return app;
}
