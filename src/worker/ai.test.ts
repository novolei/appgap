import { afterEach, expect, it, vi } from "vitest";
import { generateAnalysis } from "./ai";
import type { DataEnv } from "./env";

afterEach(() => vi.unstubAllGlobals());

it("requests bounded non-thinking output and refuses to cache a truncated answer", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({
    choices: [{ finish_reason: "stop", message: { content: " 可核查分析 " } }],
  })).mockResolvedValueOnce(Response.json({
    choices: [{ finish_reason: "length", message: { content: "不完整" } }],
  }));
  vi.stubGlobal("fetch", request);
  const env = { DEEPSEEK_API_KEY: "fixture-key" } as DataEnv & { DEEPSEEK_API_KEY: string };
  expect(await generateAnalysis(env, "fixture")).toBe("可核查分析");
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
    model: "deepseek-flash", max_tokens: 8000, thinking: { type: "disabled" },
  });
  await expect(generateAnalysis(env, "fixture")).rejects.toThrow("不完整");
});
it("rejects oversized material before transmission and keeps provider error bodies out of logs", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ error: "private input and fixture-key" }, { status: 401 }));
  vi.stubGlobal("fetch", request);
  const env = { DEEPSEEK_API_KEY: "fixture-key" } as DataEnv & { DEEPSEEK_API_KEY: string };
  await expect(generateAnalysis(env, "x".repeat(128 * 1024 + 1))).rejects.toThrow("过长");
  expect(request).not.toHaveBeenCalled();
  await expect(generateAnalysis(env, "private input")).rejects.toThrow("HTTP 401");
  await expect(generateAnalysis(env, "private input")).rejects.not.toThrow("fixture-key");
});
