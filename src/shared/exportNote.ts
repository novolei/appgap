import { countryLabel, genreLabel } from "./catalog";
import type { AppDetail, OpportunityRow } from "./types";

export function buildListMarkdown(input: {
  lensLabel: string;
  countryName: string;
  hint: string;
  items: OpportunityRow[];
}): string {
  const lines = input.items.map((item, index) => {
    const title = item.nameZh && item.nameZh !== item.name ? `${item.name} — ${item.nameZh}` : item.name;
    const pos = item.rank ? `${countryLabel(item.country)} 第 ${item.rank}` : "已离开榜单";
    const rating = item.rating != null ? item.rating.toFixed(1) : "无评分";
    return `${index + 1}. ${title}
   ${item.oneLiner}
   ${item.artistName} · ${pos} · ${rating} · ${item.ratingCount ?? "—"} 条评价`;
  });
  return `# AppGap 导出 · ${input.lensLabel}${input.countryName ? ` · ${input.countryName}` : ""}

${input.hint}

请根据下面这份 App Store 榜单材料，帮我做需求发现和下一步分析。不要编造下载量和收入。

${lines.join("\n\n") || "（这一页是空的）"}
`;
}

export function buildExportMarkdown(detail: AppDetail, ai?: string | null): string {
  const positions = detail.positions
    .map((pos) => `- ${countryLabel(pos.country)} ${genreLabel(pos.genreId)} 第 ${pos.rank}`)
    .join("\n");
  const reviews = detail.reviews
    .slice(0, 8)
    .map((item) => {
      const zh = `${item.rating ?? "?"} 星 ${item.title} ${item.content}`.trim();
      const orig = item.contentOriginal || item.titleOriginal;
      return orig ? `- ${zh}\n  原文：${orig}` : `- ${zh}`;
    })
    .join("\n");
  const title = detail.app.nameZh && detail.app.nameZh !== detail.app.name ? `${detail.app.name} — ${detail.app.nameZh}` : detail.app.name;
  return `# ${title}

- 开发者：${detail.app.artistName}
- 干什么：${detail.app.oneLiner}
- 价格：${detail.app.formattedPrice ?? "未知"}
- 商店：${detail.app.trackViewUrl ?? ""}

## 上榜
${positions || "（无）"}

## 现有判断
${detail.analysis.headline}
${detail.analysis.bullets.map((item) => `- ${item}`).join("\n")}
${detail.analysis.move}

## 最近评价
${reviews || "（无）"}

## DeepSeek 分析
${ai?.trim() || "（还没有跑 AI）"}
`;
}
