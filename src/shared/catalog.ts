export const COUNTRIES = [
  { id: "jp", label: "日区", name: "日本" },
  { id: "us", label: "美区", name: "美国" },
  { id: "gb", label: "英区", name: "英国" },
  { id: "kr", label: "韩区", name: "韩国" },
  { id: "tw", label: "台区", name: "台湾" },
  { id: "de", label: "德区", name: "德国" },
  { id: "fr", label: "法区", name: "法国" },
  { id: "au", label: "澳区", name: "澳洲" },
] as const;

export const GENRES = [
  { id: "6002", label: "工具", name: "Utilities" },
  { id: "6007", label: "效率", name: "Productivity" },
  { id: "6008", label: "照片", name: "Photo & Video" },
] as const;

export const CHARTS = [
  { id: "grossing", rss: "topgrossingapplications", label: "畅销榜" },
  { id: "free", rss: "topfreeapplications", label: "免费榜" },
] as const;

export type CountryId = (typeof COUNTRIES)[number]["id"];
export type GenreId = (typeof GENRES)[number]["id"];
export type ChartId = (typeof CHARTS)[number]["id"];
export type LensId = "money_hated" | "indie_viral" | "geo_gap" | "local_king";
export type PoolId = "watch" | "build";

export const LENSES: Array<{
  id: LensId;
  label: string;
  hint: string;
  icon: "coin" | "rocket" | "globe" | "crown";
}> = [
  {
    id: "money_hated",
    label: "赚钱但被骂",
    hint: "它们在畅销榜上（用户在付钱），评分却很差（用户不满意）。做一个体验更好的同类工具，就是最直接的机会。点一行打开详情和我们的分析。",
    icon: "coin",
  },
  {
    id: "indie_viral",
    label: "小团队爆款",
    hint: "不是 Google / 政府机关那种大机构，却能打进免费榜或畅销榜。说明这个品类一个人也能做起来，值得看他们靠什么功能涨上去。",
    icon: "rocket",
  },
  {
    id: "geo_gap",
    label: "跨地域缺口",
    hint: "某个市场已经有人靠这个品类赚钱，但其他区几乎看不到同一款 App。要么把那边的玩法搬过来，要么去做本地化更好的替代。",
    icon: "globe",
  },
  {
    id: "local_king",
    label: "单一市场霸主",
    hint: "只在一个区的榜上很靠前，别处几乎没有存在感。说明需求是本地的，或本地化做得极深——适合研究它到底卡住了哪一块。",
    icon: "crown",
  },
];

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
