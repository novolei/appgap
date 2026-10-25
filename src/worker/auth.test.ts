import { afterEach, expect, it, vi } from "vitest";
import { isAuthed, loginResponse } from "./auth";
import type { RuntimeEnv } from "./env";

const env = { SITE_PASSWORD: "test-site-password" } as RuntimeEnv;
const request = new Request("https://appgap.test");
afterEach(() => vi.useRealTimers());

it("expires signed sessions on the server and rejects tampering or a changed password", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  const response = await loginResponse(env.SITE_PASSWORD!, env, request);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const authed = new Request(request, { headers: { cookie } });
  expect(await isAuthed(authed, env)).toBe(true);
  expect(await isAuthed(new Request(request, { headers: { cookie: cookie + "x" } }), env)).toBe(false);
  expect(await isAuthed(authed, { ...env, SITE_PASSWORD: "different" })).toBe(false);
  vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
  expect(await isAuthed(authed, env)).toBe(false);
});
