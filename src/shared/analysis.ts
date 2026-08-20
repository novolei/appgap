import { countryLabel, genreLabel } from "./catalog";
import type { AppDetail, ReviewItem } from "./types";

const PAIN_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /订阅|訂閱|課金|subscription|charge|billing|cancel|退订|引き落|課金される/i, label: "订阅 / 扣费不透明" },
  { re: /詐欺|骗|scam|fraud|騙/i, label: "被骂成诈骗 / 诱导付费" },
  { re: /广告|廣告|ads|advert/i, label: "广告太多" },
  { re: /crash|闪退|落ちる|バグ|bug|動かない|doesn't work|doesnt work|不能用/i, label: "不稳定 / 根本不好用" },
  { re: /删除|削除|uninstall|cancel.*sub/i, label: "卸载也停不掉" },
  { re: /scan|読み取|识别|识别不了|不准/i, label: "核心功能不准" },
];

export function analyzeApp(input: {
  name: string;
  country: string;
  rank: number;
  genreId: string;
  rating: number | null;
  ratingCount: number | null;
  reviews: ReviewItem[];
}): AppDetail["analysis"] {
  const pains = new Set<string>();
  for (const review of input.reviews) {
    if (review.rating != null && review.rating > 2) continue;
    const hay = `${review.title}\n${review.content}`;
    for (const rule of PAIN_RULES) {
      if (rule.re.test(hay)) pains.add(rule.label);
    }
  }
  const painList = [...pains];
  const ratingText =
    input.rating != null
      ? `评分 ${input.rating.toFixed(1)}${input.ratingCount ? `，${input.ratingCount.toLocaleString("en-US")} 条评价` : ""}`
      : "评分数据不足";
  const bullets = [
    `${countryLabel(input.country)}${genreLabel(input.genreId)}畅销榜第 ${input.rank} 名，说明真有人在付钱。`,
    ratingText + (input.rating != null && input.rating < 4 ? "，口碑撑不住这个名次。" : "。"),
  ];
  if (painList.length) {
    bullets.push(`差评里反复出现：${painList.join("、")}。`);
  } else if (input.reviews.some((item) => item.rating != null && item.rating <= 2)) {
    bullets.push("最近差评不少，但槽点比较散，适合自己再翻一遍原文。");
  }
  const move =
    painList.includes("订阅 / 扣费不透明") || painList.includes("被骂成诈骗 / 诱导付费")
      ? "做一个功能同样直接、但不靠订阅陷阱赚钱的同类工具。先把取消订阅、定价和核心成功率做明白。"
      : "做一个体验更干净的同类工具：核心功能更稳，话术更老实，收费更清楚。";

  return {
    headline: `${input.name} 能排到第 ${input.rank}，靠的是需求不是口碑。`,
    bullets,
    pains: painList,
    move,
  };
}
