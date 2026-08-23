import { isAuthed, loginPage, loginResponse } from "./worker/auth";
import app from "./worker/app";
import type { RuntimeEnv } from "./worker/env";
import { runIngest } from "./worker/ingest";

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
    const authed = await isAuthed(request, env);
    if (!authed) {
      if (url.pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      return loginPage();
    }
    const response = await app.fetch(request, env, ctx);
    if (response.status === 404 && !url.pathname.startsWith("/api/") && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return response;
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runIngest(env, { source: `cron:${controller.cron}` }));
  },
} satisfies ExportedHandler<RuntimeEnv>;
