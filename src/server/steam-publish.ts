import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

export function registerSteamPublisher(
  app: Hono,
  directory: string,
  secret: string | undefined,
  origin: string,
) {
  let publishing = false;
  app.post(
    "/api/steam/publish",
    async (c, next) => {
      if (!secret || secret.length < 32)
        return c.json({ error: "publisher disabled" }, 404);
      const given =
        c.req.header("authorization")?.replace(/^Bearer /, "") || "";
      if (
        !/^[A-Za-z0-9_-]{32,128}$/.test(given) ||
        given.length !== secret.length ||
        !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
      )
        return c.json({ error: "unauthorized" }, 401);
      if (c.req.header("origin") && c.req.header("origin") !== origin)
        return c.json({ error: "forbidden origin" }, 403);
      if (publishing)
        return c.json({ error: "snapshot import already running" }, 429);
      publishing = true;
      try {
        await next();
      } finally {
        publishing = false;
      }
    },
    bodyLimit({ maxSize: 24 * 1024 * 1024 }),
    async (c) => {
      const body = await c.req.text();
      try {
        const result = await new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"),
            ["deploy/receive-steam.py", directory],
            {
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
              env: {
                PATH: process.env.PATH,
                PYTHONUTF8: "1",
                ...(process.env.LOCALAPPDATA ? { LOCALAPPDATA: process.env.LOCALAPPDATA } : {}),
                ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {}),
                ...(process.env.SystemRoot
                  ? { SystemRoot: process.env.SystemRoot }
                  : {}),
              },
            },
          );
          let output = "",
            error = "";
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("import timed out"));
          }, 45000);
          child.stdout.on("data", (chunk) => {
            output += String(chunk);
            if (output.length > 8192) child.kill("SIGKILL");
          });
          child.stderr.on("data", (chunk) => {
            error = (error + String(chunk)).slice(-2048);
          });
          child.on("error", (problem) => {
            clearTimeout(timer);
            reject(problem);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(output.trim().split("\n").at(-1) || "{}");
            else reject(new Error(error || "import process failed"));
          });
          child.stdin.on("error", () => {});
          child.stdin.end(body);
        });
        return c.json(JSON.parse(result));
      } catch (error) {
        console.error(
          "Steam import failed",
          error instanceof Error ? error.message : "unknown",
        );
        return c.json(
          { error: "Steam snapshot import failed; previous data retained" },
          502,
        );
      }
    },
  );
}
