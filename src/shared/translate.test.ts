import { describe, expect, it } from "vitest";
import { chineseName, chineseOneLiner, chineseReview } from "./translate";

describe("chineseName", () => {
  it("translates Japanese QR scanner names", () => {
    expect(chineseName("QRコード & バーコードスキャナーアプリ")).toContain("二维码");
  });
  it("translates English cleaner names", () => {
    expect(chineseName("Cleaner ・Phone Storage Cleanup")).toMatch(/清理|存储/);
  });
  it("names remote camera apps from description", () => {
    expect(chineseName("EGLOO", "6002", "Use the Egloo app to check in on your camera.")).toBe("远程监控");
  });
  it("uses kind for mixed English product names", () => {
    expect(chineseName("TimeBlocks - Mobile Planner")).toBe("日历日程");
  });
});

describe("chineseOneLiner", () => {
  it("does not keep Korean or Japanese sentences", () => {
    const line = chineseOneLiner({
      name: "EGLOO",
      oneLiner: "Use the Egloo app to check in on w...",
      genreId: "6002",
      country: "kr",
      rank: 5,
    });
    expect(line).not.toMatch(/Use the Egloo/);
    expect(line).toMatch(/远程|监控|摄像头|小工具/);
  });
});

describe("chineseReview", () => {
  it("translates common Japanese complaints", () => {
    expect(chineseReview("詐欺アプリ")).toContain("诈骗");
    expect(chineseReview("課金される")).toContain("扣费");
  });
});
