import { countryName, genreLabel } from "./catalog";
import type { AppDetail, ReviewItem } from "./types";
import { chineseName } from "./translate";
import { isGameGenre } from "./what";

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
  chart?: string;
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
  const zhName = chineseName(input.name, input.genreId);
  const free = input.chart === "free";
  const bullets = [
    input.rank > 0 ? `在${countryName(input.country)}的${genreLabel(input.genreId)}${free ? "免费榜" : "畅销榜"}排到第 ${input.rank}。${free ? "这是关注度线索，不能据此推断收入。" : "这是付费需求线索，不代表实际收入数字。"}` : "当前没有上榜记录，不能据此判断需求或收入。",
    ratingText + (input.rating != null && input.rating < 4 ? "。评分低于 4，建议核对近期评价。" : "。"),
  ];
  if (painList.length) {
    bullets.push(`差评里反复出现：${painList.join("、")}。`);
  } else if (input.reviews.some((item) => item.rating != null && item.rating <= 2)) {
    bullets.push("已采到低分评价，样本有限；下面附了关键词整理和原文。");
  }
  const move =
    isGameGenre(input.genreId)
      ? "先围绕一项可验证的玩法差异做小型原型，核对付费方式、核心循环与玩家原文；竞品痛点不能证明玩家会迁移。"
      : painList.includes("订阅 / 扣费不透明") || painList.includes("被骂成诈骗 / 诱导付费")
      ? "可以做功能同样直接、但不靠订阅陷阱赚钱的同类工具。取消订阅、定价和核心成功率先做明白。"
      : "可以做更干净的同类工具：核心功能更稳，话术更老实，收费更清楚。";

  return {
    headline: `${zhName}：榜单与用户反馈摘要`,
    bullets,
    pains: painList,
    move,
  };
}
