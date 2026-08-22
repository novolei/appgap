import { countryLabel } from "../shared/catalog";

export function formatRating(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(1);
}

export function ratingTone(value: number | null): "bad" | "warn" | "ok" {
  if (value == null) return "ok";
  if (value <= 3.2) return "bad";
  if (value < 4) return "warn";
  return "ok";
}

export function formatCount(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US");
}

export function positionText(country: string, rank: number): string {
  if (!rank) return "已离开榜单";
  return `${countryLabel(country)} · 第 ${rank} 名`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "尚未同步";
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return "尚未同步";
  const minutes = Math.round(delta / 60000);
  if (minutes < 2) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前扫描`;
  const days = Math.round(hours / 24);
  return `${days} 天前扫描`;
}
