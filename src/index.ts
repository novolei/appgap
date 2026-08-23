import { isAuthed, loginPage, loginResponse } from "./worker/auth";
import app from "./worker/app";
import type { RuntimeEnv } from "./worker/env";
import { expireStaleIngest, isIngestLocked, runIngest } from "./worker/ingest";

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isLocalhost(url: URL) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

async function canCallIngest(request: Request, env: RuntimeEnv, url: URL): Promise<boolean> {
  if (await isAuthed(request, env)) return true;
  if (isLocalhost(url)) return true;
  const secret = env.INGEST_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("key");
  return given === secret;
}

export default {
  async fetch(request: Request, env: RuntimeEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/login" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { password?: string } | null;
      return loginResponse(String(body?.password || ""), env, request);
    }
    if (url.pathname === "/api/health") {
      return app.fetch(request, env, ctx);
    }
    if (url.pathname === "/api/ingest") {
      if (!(await canCallIngest(request, env, url))) return jsonError("unauthorized", 401);
      return app.fetch(request, env, ctx);
    }
    const authed = await isAuthed(request, env);
    if (!authed) {
      if (url.pathname.startsWith("/api/")) return jsonError("unauthorized", 401);
      return loginPage();
    }
    const response = await app.fetch(request, env, ctx);
    if (response.status === 404 && !url.pathname.startsWith("/api/") && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return response;
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        await expireStaleIngest(env);
        if (await isIngestLocked(env)) return;
        await runIngest(env, { source: `cron:${controller.cron}` });
      })().catch((error) => {
        console.error("cron ingest failed", error);
      }),
    );
  },
} satisfies ExportedHandler<RuntimeEnv>;
