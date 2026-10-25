import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { expect, it } from "vitest";
import { registerSteamPublisher } from "./steam-publish";

it("authenticates the data capability before reading a large body and rejects foreign origins", async () => {
  const app = new Hono();
  const token = "local-test-steam-data-token-0123456789";
  registerSteamPublisher(app, "unused", token, "https://appgap.test");
  app.use("*", bodyLimit({ maxSize: 8192 }));
  expect(
    (
      await app.request("https://appgap.test/api/steam/publish", {
        method: "POST",
        body: "x".repeat(9000),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await app.request("https://appgap.test/api/steam/publish", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          origin: "https://evil.test",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("https://appgap.test/api/steam/publish", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-length": String(25 * 1024 * 1024),
        },
        body: "x",
      })
    ).status,
  ).toBe(413);
});
