import { countryName } from "./catalog";
import { describeApp, isGameGenre } from "./what";

const NAME_GLOSSARY: Array<[RegExp, string]> = [
  [/qr\s*code/gi, "二维码"],
  [/qrコード/gi, "二维码"],
  [/qr\s*コード/gi, "二维码"],
  [/バーコード/g, "条形码"],
  [/barcode/gi, "条形码"],
  [/スキャナーアプリ/g, "扫描"],
  [/スキャナー/g, "扫描"],
  [/スキャンナ/g, "扫描"],
  [/scanner/gi, "扫描"],
  [/reader/gi, "识别"],
  [/読み取り/g, "识别"],
  [/cleaner/gi, "清理"],
  [/cleanup/gi, "清理"],
  [/クリーンアップストレージ/g, "存储清理"],
  [/クリーンアップ/g, "清理"],
  [/クリーン/g, "清理"],
  [/storage/gi, "存储"],
  [/ストレージ/g, "存储"],
  [/phone/gi, "手机"],
  [/authenticator/gi, "验证器"],
  [/2fa|mfa/gi, "两步验证"],
  [/vpn/gi, "VPN"],
  [/mirror(ing)?/gi, "投屏"],
  [/cast/gi, "投屏"],
  [/chromecast/gi, "投屏"],
  [/security/gi, "安全"],
  [/セキュリ[テテ]ィ/g, "安全"],
  [/web protect(ion)?/gi, "网页防护"],
  [/antivirus/gi, "杀毒"],
  [/pdf/gi, "PDF"],
  [/widget/gi, "小组件"],
  [/calendar/gi, "日历"],
  [/planner/gi, "日程"],
  [/photo/gi, "照片"],
  [/camera/gi, "相机"],
  [/カメラ/g, "相机"],
  [/写真/g, "照片"],
  [/video/gi, "视频"],
  [/動画/g, "视频"],
  [/translator?/gi, "翻译"],
  [/翻訳/g, "翻译"],
  [/keyboard/gi, "输入法"],
  [/file\s*manager/gi, "文件管理"],
  [/cloud/gi, "云盘"],
  [/saver/gi, "保存"],
  [/app\.?$/gi, ""],
  [/アプリ/g, ""],
  [/application/gi, ""],
  [/[℠™®©]/g, ""],
];

const KIND_NAME: Array<{ re: RegExp; zh: string }> = [
  { re: /qr|barcode|二维码|バーコード|扫描|scanner/i, zh: "二维码扫描" },
  { re: /clean|清理|クリーン|storage cleanup/i, zh: "手机清理" },
  { re: /vpn/i, zh: "VPN" },
  { re: /authenti|2fa|两步|验证器/i, zh: "两步验证器" },
  { re: /mirror|cast|投屏/i, zh: "手机投屏" },
  { re: /security|安全|防护|norton|360/i, zh: "手机安全" },
  { re: /pdf/i, zh: "PDF 工具" },
  { re: /widget|小组件/i, zh: "桌面小组件" },
  { re: /calendar|planner|日历|日程/i, zh: "日历日程" },
  { re: /photo|相机|滤镜|カメラ/i, zh: "照片工具" },
  { re: /video|视频|動画/i, zh: "视频工具" },
  { re: /cloud|网盘|box/i, zh: "云盘" },
  { re: /translate|翻译/i, zh: "翻译" },
];

const REVIEW_GLOSSARY: Array<[RegExp, string]> = [
  [/詐欺アプリ/g, "诈骗应用"],
  [/詐欺です/g, "这是诈骗"],
  [/詐欺/g, "诈骗"],
  [/騙された/g, "被骗了"],
  [/課金される/g, "会被扣费"],
  [/課金の仕組み/g, "扣费规则"],
  [/課金/g, "扣费"],
  [/サブスクリプション/g, "订阅"],
  [/引き落/g, "扣款"],
  [/解約/g, "取消订阅"],
  [/返金/g, "退款"],
  [/使えなくなった/g, "突然不能用了"],
  [/使えない/g, "没法用"],
  [/動かない/g, "打不开"],
  [/アンインストール/g, "卸载"],
  [/削除方法/g, "怎么删除"],
  [/削除/g, "删除"],
  [/広告/g, "广告"],
  [/最悪/g, "太差了"],
  [/高すぎ/g, "太贵"],
  [/わかりにくい/g, "说明不清楚"],
  [/突然/g, "突然"],
  [/インストール/g, "安装"],
  [/スキャン/g, "扫描"],
  [/読み取/g, "识别"],
  [/ありがとうございます/g, "谢谢"],
  [/とても良い/g, "挺好用"],
  [/絶対にダメ/g, "绝对不行"],
  [/ダメ/g, "不行"],
  [/絶対/g, "绝对"],
  [/良い/g, "不错"],
  [/subscription/gi, "订阅"],
  [/charged?|billing/gi, "扣费"],
  [/scam|fraud/gi, "诈骗"],
  [/uninstall/gi, "卸载"],
  [/doesn't work|doesnt work|not working/gi, "不好用"],
  [/사기/g, "诈骗"],
  [/결제/g, "扣费"],
  [/구독/g, "订阅"],
  [/삭제/g, "删除"],
  [/광고/g, "广告"],
];

export function hasForeignScript(text: string): boolean {
  return /[\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

export function looksChinese(text: string): boolean {
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (text.match(/[A-Za-z\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return han >= 2 && han >= letters;
}

function applyPairs(text: string, pairs: Array<[RegExp, string]>): string {
  let out = text;
  for (const [re, zh] of pairs) out = out.replace(re, zh);
  return out.replace(/[·・＊*|]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
}

function latinCount(text: string): number {
  return (text.match(/[A-Za-z]/g) || []).length;
}

function hanCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length;
}

export function chineseName(name: string, genreId?: string | null, description?: string | null): string {
  if (isGameGenre(genreId)) return name;
  const described = describeApp(name, description, genreId);
  if (described.kindId) return described.nameZh;
  const cleaned = applyPairs(name, NAME_GLOSSARY).replace(/[()（）[\]{}]/g, " ").replace(/\s{2,}/g, " ").trim();
  if (cleaned && !hasForeignScript(cleaned) && hanCount(cleaned) >= 2 && hanCount(cleaned) >= latinCount(cleaned)) {
    return cleaned.replace(/\s+/g, " ");
  }
  if (looksChinese(name) && !hasForeignScript(name)) return name;
  if (described.what !== "实用小工具") return described.nameZh;
  return described.nameZh === name ? name : described.what;
}

export function chineseOneLiner(input: {
  name: string;
  oneLiner?: string | null;
  description?: string | null;
  genreId?: string | null;
  country?: string | null;
  rank?: number | null;
}): string {
  const described = describeApp(input.name, input.description ?? input.oneLiner, input.genreId);
  const bits = [described.what];
  if (input.rank === 1 && input.country) bits.push(`${countryName(input.country)}畅销第一`);
  else if (input.rank === 2 && input.country) bits.push(`${countryName(input.country)}畅销第二`);
  return [...new Set(bits.filter(Boolean))].join(" · ");
}

export function chineseReview(text: string): string {
  const out = applyPairs(text, REVIEW_GLOSSARY);
  if (!out.trim()) return "";
  if (!hasForeignScript(out)) return out.replace(/\s{2,}/g, " ").trim();
  const leftover = out
    .replace(/[\u3040-\u30ff]+/g, " ")
    .replace(/[\uac00-\ud7af]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return leftover || "差评（原文见下）";
}

export function localizeRegions(text: string): string {
  return text
    .replaceAll("日区", "日本")
    .replaceAll("韩区", "韩国")
    .replaceAll("美区", "美国")
    .replaceAll("英区", "英国")
    .replaceAll("台区", "中国台湾")
    .replaceAll("德区", "德国")
    .replaceAll("法区", "法国")
    .replaceAll("澳区", "澳洲");
}
