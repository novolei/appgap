import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { authenticatedUser } from "../worker/auth";
import type { RuntimeEnv } from "../worker/env";
import { limited } from "./account-security";

export function amountMinor(value: unknown): number | null {
  if(typeof value!=="string" || !/^(?:[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole,part=""]=value.split(".");const result=Number(whole)*100+Number(part.padEnd(2,"0"));
  return result>=100 && result<=10000000 ? result : null;
}
export function donationRoutes(env: RuntimeEnv,origin: string,paymentUrl?: string,qrPath?: string) {
  const app=new Hono();
  const configured=paymentUrl && /^https:\/\//.test(paymentUrl) ? paymentUrl : null;
  const qr=()=>{try{if(!qrPath || statSync(qrPath).size>2*1024*1024)return null;const bytes=readFileSync(qrPath);return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?bytes:null;}catch{return null;}};
  app.onError((error,c)=>c.json({error:error instanceof HTTPException ? error.message : "未能保存支持记录，请稍后再试。"},error instanceof HTTPException ? error.status : 503));
  app.use("*",async(c,next)=>{
    if(c.req.method!=="GET" && (c.req.header("origin") && c.req.header("origin")!==origin || c.req.header("sec-fetch-site")==="cross-site")) throw new HTTPException(403,{message:"请求来源不受信任。"});
    await next();
  });
  app.get("/public",async c=>{
    const rankings=await env.DB.prepare(`SELECT MIN(d.id) AS id,(SELECT public_name FROM donations n WHERE n.user_id=d.user_id AND n.status='confirmed' AND n.public=1 ORDER BY n.confirmed_at DESC,n.id DESC LIMIT 1) AS name,SUM(d.amount_minor) AS amountMinor,COUNT(*) AS times
      FROM donations d WHERE d.status='confirmed' AND d.public=1 GROUP BY d.user_id ORDER BY amountMinor DESC,MIN(d.confirmed_at) ASC LIMIT 30`).all();
    const recent=await env.DB.prepare(`SELECT id,public_name AS name,amount_minor AS amountMinor,message,confirmed_at AS confirmedAt
      FROM donations WHERE status='confirmed' AND public=1 ORDER BY confirmed_at DESC,id DESC LIMIT 20`).all();
    const totals=await env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amountMinor,COUNT(DISTINCT user_id) AS supporters FROM donations WHERE status='confirmed'").first();
    return c.json({currency:"CNY",rankings:rankings.results,recent:recent.results,totals,paymentUrl:configured,qrUrl:qr()?"/api/donations/qr":null,mode:"manual",updatedAt:new Date().toISOString()});
  });
  app.get("/qr",c=>{const bytes=qr();if(!bytes)return c.json({error:"暂未配置收款码。"},404);return new Response(bytes,{headers:{"content-type":"image/png","cache-control":"no-store","x-content-type-options":"nosniff"}});});
  app.use("*",async(c,next)=>{if(!await authenticatedUser(c.req.raw,env))throw new HTTPException(401,{message:"请先登录，再记录支持。"});await next();});
  const user=(request: Request)=>authenticatedUser(request,env);
  async function body(c: Context): Promise<Record<string,unknown>> {
    if(!c.req.header("content-type")?.startsWith("application/json"))throw new HTTPException(400,{message:"请提交 JSON。"});
    const value=await c.req.json().catch(()=>null);
    if(!value || typeof value!=="object" || Array.isArray(value))throw new HTTPException(400,{message:"内容格式错误。"});return value;
  }
  app.get("/mine",async c=>{
    const actor=(await user(c.req.raw))!;
    const rows=await env.DB.prepare("SELECT id,amount_minor AS amountMinor,currency,status,public,public_name AS name,message,created_at AS createdAt,confirmed_at AS confirmedAt FROM donations WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(actor.id).all();
    return c.json({items:rows.results});
  });
  app.post("/intent",async c=>{
    const actor=(await user(c.req.raw))!,input=await body(c),amount=amountMinor(input.amount);
    if(amount===null || typeof input.public!=="boolean" || typeof input.name!=="string" || input.name.trim().length<1 || input.name.length>32 || typeof input.message!=="string" || input.message.length>120 || /[\u0000-\u001f\u007f]/.test(input.name+input.message))throw new HTTPException(400,{message:"金额为 ¥1–100,000，最多两位小数；昵称最多 32 字，留言最多 120 字。"});
    if(!await limited(env,`donation:${actor.id}`,5))throw new HTTPException(429,{message:"支持记录提交过于频繁，请稍后再试。"});
    const pending=await env.DB.prepare("SELECT count(*) AS n FROM donations WHERE user_id=? AND status='pending'").bind(actor.id).first<{n:number}>();
    if((pending?.n||0)>=3)throw new HTTPException(429,{message:"你已有三条待确认记录，请先等待管理员核对。"});
    const id=randomUUID();
    await env.DB.prepare("INSERT INTO donations(id,user_id,amount_minor,public,public_name,message,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(id,actor.id,amount,input.public ? 1:0,input.name.trim(),input.message.trim(),new Date().toISOString()).run();
    return c.json({ok:true,id,status:"pending"},201);
  });
  app.post("/:id/privacy",async c=>{
    const actor=(await user(c.req.raw))!,input=await body(c);
    if(typeof input.public!=="boolean")throw new HTTPException(400,{message:"请明确选择是否公开。"});
    const changed=await env.DB.prepare("UPDATE donations SET public=? WHERE id=? AND user_id=?").bind(input.public ? 1:0,c.req.param("id"),actor.id).run();
    if(!changed.meta.changes)throw new HTTPException(404,{message:"记录不存在。"});return c.json({ok:true});
  });
  app.use("/admin/*",async(c,next)=>{if((await user(c.req.raw))?.role!=="admin")throw new HTTPException(403,{message:"仅管理员可核对到账。"});await next();});
  app.get("/admin/records",async c=>{
    const rows=await env.DB.prepare("SELECT d.*,u.username FROM donations d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 100").all();return c.json({items:rows.results});
  });
  app.post("/admin/:id/review",async c=>{
    const actor=(await user(c.req.raw))!,input=await body(c),id=c.req.param("id");
    if(!["confirm","reject","refund"].includes(String(input.action)))throw new HTTPException(400,{message:"无效的核对动作。"});
    if(input.action==="confirm"){
      const amount=amountMinor(input.amount),reference=typeof input.reference==="string" ? input.reference.trim():"";
      if(amount===null || reference.length<3 || reference.length>120 || /[\u0000-\u001f\u007f]/.test(reference))throw new HTTPException(400,{message:"请填实际到账金额和唯一到账流水号。"});
      const changed=await env.DB.prepare(`UPDATE donations SET amount_minor=?,status='confirmed',payment_reference=?,confirmed_at=?,reviewed_by=?
        WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM donations WHERE payment_reference=?)`)
        .bind(amount,reference,new Date().toISOString(),actor.id,id,reference).run();
      if(!changed.meta.changes)throw new HTTPException(409,{message:"已核对、记录不存在或该流水已入账。"});
    }else{
      const status=input.action==="reject" ? "rejected":"refunded",expected=input.action==="reject" ? "pending":"confirmed";
      const changed=await env.DB.prepare("UPDATE donations SET status=?,reviewed_by=? WHERE id=? AND status=?").bind(status,actor.id,id,expected).run();
      if(!changed.meta.changes)throw new HTTPException(409,{message:"记录状态已变化，请刷新。"});
    }
    return c.json({ok:true});
  });
  return app;
}
