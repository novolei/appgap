import { describe, expect, it } from "vitest";
import { countryLabel, isCountryId } from "./catalog";
import { buildExportMarkdown, buildListMarkdown } from "./exportNote";
import type { AppDetail, OpportunityRow } from "./types";

const row: OpportunityRow = {
  lens: "paid_tools",
  appId: "1",
  name: "Cleaner Pro",
  nameZh: "清理重复照片",
  artistName: "Acme",
  iconUrl: null,
  oneLiner: "日本畅销榜上的清理工具",
  country: "tw",
  chart: "grossing",
  genreId: "6002",
  rank: 4,
  rating: 3.2,
  ratingCount: 1200,
  rankChange: null,
  consecutiveDays: 1,
  trackViewUrl: "https://apps.apple.com",
  score: 10,
  positions: [{ country: "tw", chart: "grossing", genreId: "6002", rank: 4 }],
  reasons: [],
};

describe("country labels", () => {
  it("calls Taiwan 中国台湾", () => {
    expect(countryLabel("tw")).toBe("中国台湾");
    expect(isCountryId("tw")).toBe(true);
  });
});

describe("export notes", () => {
  it("includes the list country and a Codex prompt", () => {
    const text = buildListMarkdown({
      lensLabel: "赚钱的小工具",
      countryName: "中国台湾",
      hint: "有人付钱",
      items: [row],
    });
    expect(text).toContain("中国台湾");
    expect(text).toContain("Cleaner Pro — 清理重复照片");
    expect(text).toContain("不要编造下载量和收入");
  });

  it("leaves a placeholder when AI has not run", () => {
    const detail: AppDetail = {
      app: {
        id: "1",
        name: "Cleaner Pro",
        nameZh: "清理重复照片",
        artistName: "Acme",
        artistId: null,
        iconUrl: null,
        description: null,
        oneLiner: "清理工具",
        genreName: "Utilities",
        formattedPrice: "免费",
        trackViewUrl: "https://apps.apple.com",
      },
      positions: [{ country: "tw", chart: "grossing", genreId: "6002", rank: 4, rating: 3.2, ratingCount: 1200 }],
      history: [],
      reviews: [],
      analysis: { headline: "需求还在", bullets: ["评分偏低"], pains: [], move: "做一个不烦人的版本" },
      ai: null,
    };
    const text = buildExportMarkdown(detail, null);
    expect(text).toContain("（还没有跑 AI）");
    expect(text).toContain("中国台湾");
  });
});
