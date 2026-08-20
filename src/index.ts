import app from "./worker/app";
import { runIngest } from "./worker/ingest";

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => {
    ctx.waitUntil(runIngest(env, { source: `cron:${event.cron}` }));
  },
} satisfies ExportedHandler<Env>;
