import { describe, expect, it } from "vitest";
import { buildOneLiner } from "./oneLiner";

describe("buildOneLiner", () => {
  it("tags QR scanners that charge by subscription", () => {
    expect(
      buildOneLiner({
        name: "QRコード & バーコードスキャナーアプリ",
        description: "Weekly subscription unlocks unlimited scans.",
        country: "jp",
        rank: 1,
      }),
    ).toContain("二维码");
  });

  it("tags cleaners", () => {
    expect(
      buildOneLiner({
        name: "Cleaner ・クリーンアップストレージ",
        description: "Duplicate photos and storage cleanup.",
      }),
    ).toContain("清理重复照片");
  });
});
