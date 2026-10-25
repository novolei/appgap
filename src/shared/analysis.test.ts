import { expect, it } from "vitest";
import { analyzeApp } from "./analysis";

it("does not present a free chart position as proof of revenue or bad reviews", () => {
  const analysis = analyzeApp({ name: "Scanner", country: "us", chart: "free", rank: 2, genreId: "6002", rating: 4.8, ratingCount: 1000, reviews: [] });
  expect(analysis.bullets[0]).toContain("免费榜");
  expect(analysis.bullets[0]).toContain("不能据此推断收入");
  expect(analysis.headline).not.toContain("不是口碑");
});

it("gives a game prototype recommendation without tool classification", () => {
  const result = analyzeApp({ name: "Clean Up Board Game", country: "us", chart: "grossing", rank: 1, genreId: "6014", rating: 4, ratingCount: 10, reviews: [] });
  expect(result.headline).toContain("Clean Up Board Game");
  expect(result.move).toContain("玩法");
  expect(result.move).not.toContain("工具");
});
