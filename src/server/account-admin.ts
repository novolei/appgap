import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authenticatedUser } from "../worker/auth";
import type { RuntimeEnv } from "../worker/env";
import type { AdminUsers,AdminUser } from "../shared/community";

export function accountAdminRoutes(env:RuntimeEnv){
  const app=new Hono();
  app.use("*",async(c,next)=>{
    c.header("Cache-Control","no-store");
    const actor=await authenticatedUser(c.req.raw,env);
    if(!actor)throw new HTTPException(401,{message:"请先登录。"});
    if(actor.role!=="admin")throw new HTTPException(403,{message:"仅管理员可以查看注册用户。"});
    await next();
  });
  app.get("/users",async c=>{
    const q=(c.req.query("q")||"").trim(),rawPage=c.req.query("page")||"1";
    if(q.length>64||!/^[1-9]\d{0,5}$/.test(rawPage))throw new HTTPException(400,{message:"搜索最多 64 个字符，页码须为正整数。"});
    const where="instr(lower(u.username),lower(?))>0 OR instr(lower(u.display_name),lower(?))>0 OR u.id=?";
    const total=(await env.DB.prepare(`SELECT count(*) AS n FROM users u WHERE ${where}`).bind(q,q,q).first<{n:number}>())!.n;
    const pageSize=25,page=Math.min(Number(rawPage),Math.max(1,Math.ceil(total/pageSize))),now=new Date().toISOString(),week=new Date(Date.now()-7*86400000).toISOString();
    const summary=(await env.DB.prepare(`SELECT count(CASE WHEN role='member' THEN 1 END) AS registered,
      count(CASE WHEN role='member' AND created_at>=? THEN 1 END) AS newThisWeek,
      count(CASE WHEN role='member' AND last_login_at>=? THEN 1 END) AS loggedInThisWeek,
      count(CASE WHEN role='admin' THEN 1 END) AS admins FROM users`).bind(week,week).first<AdminUsers["summary"]>())!;
    const items=await env.DB.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.role,u.created_at AS createdAt,u.last_login_at AS lastLoginAt,
      (SELECT count(*) FROM user_pools WHERE user_id=u.id AND pool='watch') AS watchCount,
      (SELECT count(*) FROM user_pools WHERE user_id=u.id AND pool='build') AS buildCount,
      (SELECT count(*) FROM research_history WHERE user_id=u.id) AS researchCount,
      (SELECT count(*) FROM user_sessions WHERE user_id=u.id AND expires_at>?) AS activeSessions,
      (SELECT COALESCE(sum(amount_minor),0) FROM donations WHERE user_id=u.id AND status='confirmed') AS donatedMinor
      FROM users u WHERE ${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).bind(now,q,q,q,pageSize,(page-1)*pageSize).all<AdminUser>();
    return c.json({items:items.results,total,page,pageSize,summary} satisfies AdminUsers);
  });
  return app;
}
