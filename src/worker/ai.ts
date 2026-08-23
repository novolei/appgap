import { countryLabel, genreLabel } from "../shared/catalog";
import type { AppDetail } from "../shared/types";

type EnvAi = Env & { DEEPSEEK_API_KEY?: string };

export async function runDeepseekAnalysis(env: EnvAi, detail: AppDetail): Promise<string> {
  const key = env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("未配置 DEEPSEEK_API_KEY");
  const reviews = detail.reviews
    .slice(0, 8)
    .map((item) => `${item.rating ?? "?"}星 ${item.title} ${item.content}`.slice(0, 180))
    .join("\n");
  const positions = detail.positions
    .slice(0, 8)
    .map((pos) => `${countryLabel(pos.country)} ${genreLabel(pos.genreId)} 第${pos.rank}`)
    .join("；");
  const user = `请用简体中文给独立开发者写一份需求发现笔记，不要客套。

App 原名：${detail.app.name}
中文：${detail.app.nameZh}
开发者：${detail.app.artistName}
一句话：${detail.app.oneLiner}
价格：${detail.app.formattedPrice ?? "未知"}
榜单：${positions || "未知"}
现有判断：${detail.analysis.headline}
${detail.analysis.bullets.join("\n")}
建议：${detail.analysis.move}
最近评价：
${reviews || "（没有评价）"}

输出结构：
## 这是什么
## 为什么有人付钱
## 用户在骂什么
## 可以做什么替代
## 风险与注意
每段 3–6 句，具体、可执行。`;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      temperature: 0.4,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content: "你是做 App 独立开发的产品搭档。只根据给定材料分析，不要编造下载量和收入数字。",
        },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${err.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("模型没有返回内容");
  return text;
}
