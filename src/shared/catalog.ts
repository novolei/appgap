export const COUNTRIES = [
  { id: "cn", label: "中国", name: "中国" },
  { id: "hk", label: "香港", name: "香港" },
  { id: "jp", label: "日本", name: "日本" },
  { id: "us", label: "美国", name: "美国" },
  { id: "gb", label: "英国", name: "英国" },
  { id: "kr", label: "韩国", name: "韩国" },
  { id: "tw", label: "台湾", name: "台湾" },
  { id: "de", label: "德国", name: "德国" },
  { id: "fr", label: "法国", name: "法国" },
  { id: "au", label: "澳洲", name: "澳洲" },
] as const;

export const GENRES = [
  { id: "6002", label: "工具", name: "Utilities" },
  { id: "6007", label: "效率", name: "Productivity" },
  { id: "6008", label: "照片", name: "Photo & Video" },
  { id: "6014", label: "游戏", name: "Games" },
] as const;

export const GAME_GENRE_ID = "6014";

export function isGameGenre(genreId: string | null | undefined): boolean {
  return genreId === GAME_GENRE_ID;
}

export const CHARTS = [
  { id: "grossing", rss: "topgrossingapplications", label: "畅销榜" },
  { id: "free", rss: "topfreeapplications", label: "免费榜" },
] as const;

export type CountryId = (typeof COUNTRIES)[number]["id"];
export type GenreId = (typeof GENRES)[number]["id"];
export type ChartId = (typeof CHARTS)[number]["id"];
export type LensId = "paid_tools" | "paid_games" | "money_hated" | "fresh" | "cluster" | "indie_viral" | "geo_gap";
export type PoolId = "watch" | "build";

export const LENSES: Array<{
  id: LensId;
  label: string;
  hint: string;
}> = [
  {
    id: "paid_tools",
    label: "赚钱的小工具",
    hint: "工具 / 效率 / 照片类已经排进畅销榜。不看口碑，只看有没有人付钱——这是需求还在的信号。",
  },
  {
    id: "paid_games",
    label: "赚钱的游戏",
    hint: "游戏畅销榜。大厂买量会很多，仍能看出哪类玩法正在收钱。",
  },
  {
    id: "money_hated",
    label: "差评可替换",
    hint: "同样在畅销榜上，但评分掉在 4 以下。需求被验证了，缺一个不惹人厌的版本。",
  },
  {
    id: "fresh",
    label: "新上榜",
    hint: "这次扫描才第一次见到。可能是新需求刚起来，值得每周扫一眼。",
  },
  {
    id: "cluster",
    label: "同类扎堆",
    hint: "同一类小工具同时挤进畅销榜，比如一堆扫码、清理、投屏。品类被验证了，未必非要抄第一名。",
  },
  {
    id: "indie_viral",
    label: "小工作室",
    hint: "不是大厂也不是政府机关，却挤进免费榜或畅销榜。一个人也能做起来的规模。",
  },
  {
    id: "geo_gap",
    label: "别国没有",
    hint: "在某一两个国家很靠前，换个市场几乎没有。可以把玩法搬过去，或做本地化更深的替代。",
  },
];

export const DATA_SOURCE = {
  title: "数据来源",
  summary: "每周一扫描 Apple 公开榜单，不是全量 App Store。",
  bullets: [
    "接口来自 Apple 公开 RSS 和 iTunes Lookup，不经过 Sensor Tower、七麦或 App Store Connect。",
    "每次扫描：10 个市场 × 工具/效率/照片/游戏 × 畅销榜+免费榜，每份最多 100 名。去重后大约一千多个 App。",
    "市场含中国、香港、日本、美国、英国、韩国、台湾、德国、法国、澳洲。",
    "没有官方下载量和收入数字。畅销榜大致按付费+内购排序，免费榜大致按下载排序。",
    "Apple 没有官方「限免」榜。AppRaven 这类产品有限免列表，但没有稳定公开 API，所以还没接入。",
    "定时任务跑在 GitHub Actions（每周一）。Cloudflare 机房 IP 会被 Apple 拦，失败就保留上一份快照。",
  ],
};

export function countryLabel(id: string): string {
  return COUNTRIES.find((item) => item.id === id)?.label ?? id.toUpperCase();
}

export function countryName(id: string): string {
  return COUNTRIES.find((item) => item.id === id)?.name ?? id.toUpperCase();
}

export function genreLabel(id: string): string {
  return GENRES.find((item) => item.id === id)?.label ?? "应用";
}

export function chartLabel(id: string): string {
  return CHARTS.find((item) => item.id === id)?.label ?? id;
}

export function lensById(id: string) {
  return LENSES.find((item) => item.id === id) ?? LENSES[0];
}
