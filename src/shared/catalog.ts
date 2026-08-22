export const COUNTRIES = [
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
    label: "差评却在赚钱",
    hint: "已经排进畅销榜，说明有人付钱；分数却掉在 4 以下。同类需求被验证了，缺的是一个不惹人厌的版本。",
    icon: "coin",
  },
  {
    id: "indie_viral",
    label: "小工作室上榜",
    hint: "不是大厂、也不是政府机关，却挤进免费榜或畅销榜。一个人或小团队就能把这个品类做起来。",
    icon: "rocket",
  },
  {
    id: "geo_gap",
    label: "别的国家没有",
    hint: "在某一两个国家很靠前，换个市场几乎搜不到。可以把那边的玩法搬过来，或做本地化更深的替代。",
    icon: "globe",
  },
  {
    id: "local_king",
    label: "只在一地称王",
    hint: "只在一个国家的榜上很靠前。需求可能是本地的，或本地化做到了别人做不到的深度。",
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
