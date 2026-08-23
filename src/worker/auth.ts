import type { RuntimeEnv } from "./env";

const COOKIE = "appgap_session";
const PAYLOAD = "appgap-ok-v1";

function encoder() {
  return new TextEncoder();
}

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder().encode(text));
  return [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function passwordOf(env: RuntimeEnv): string | undefined {
  return env.SITE_PASSWORD;
}

export async function isAuthed(request: Request, env: RuntimeEnv): Promise<boolean> {
  const secret = passwordOf(env);
  if (!secret) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match?.[1]) return false;
  const expected = await hmac(secret, PAYLOAD);
  return timingEqual(match[1], expected);
}

export async function loginResponse(password: string, env: RuntimeEnv, request: Request): Promise<Response> {
  const secret = passwordOf(env);
  if (!secret || !timingEqual(password, secret)) {
    return new Response(JSON.stringify({ error: "密码不对" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const token = await hmac(secret, PAYLOAD);
  const secure = new URL(request.url).protocol === "https:";
  const cookie = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`;
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": cookie,
    },
  });
}

export function loginPage(): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AppGap</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3eee4;font-family:"PingFang SC","Noto Sans SC",sans-serif;color:#1c1915}
    form{width:min(360px,calc(100% - 40px))}
    h1{font-family:Georgia,"Songti SC",serif;font-weight:600;margin:0 0 8px}
    p{color:#6a6358;margin:0 0 18px}
    input,button{font:inherit;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #1c1915;background:#fbf7ef}
    button{margin-top:10px;background:#1c1915;color:#fbf7ef;cursor:pointer}
    .err{color:#b42318;margin-top:10px;min-height:1.2em}
  </style>
</head>
<body>
  <form id="f">
    <h1>AppGap</h1>
    <p>内部工具，输入密码后继续。</p>
    <input name="password" type="password" autocomplete="current-password" placeholder="密码" autofocus />
    <button type="submit">进入</button>
    <div class="err" id="e"></div>
  </form>
  <script>
    document.getElementById("f").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = event.target.password.value;
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) location.reload();
      else document.getElementById("e").textContent = "密码不对";
    });
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
