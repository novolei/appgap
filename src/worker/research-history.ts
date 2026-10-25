import type { RuntimeEnv } from "./env";

export async function accountOwner(env: RuntimeEnv) {
  if(!env.ACCOUNTS_ACTIVE || !env.USER) return "";
  const raw=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`account:${env.USER.id}`));
  return [...new Uint8Array(raw)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function rememberResearch(env: RuntimeEnv,key: string,title: string) {
  if(!env.ACCOUNTS_ACTIVE || !env.USER) return;
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO research_history VALUES(?,?,?,?)").bind(env.USER.id,key,title.slice(0,120),new Date().toISOString()),
    env.DB.prepare("DELETE FROM research_history WHERE user_id=? AND cache_key NOT IN (SELECT cache_key FROM research_history WHERE user_id=? ORDER BY created_at DESC LIMIT 200)").bind(env.USER.id,env.USER.id),
  ]);
}
