import { countryLabel, genreLabel } from "./catalog";

type KindRule = {
  re: RegExp;
  line: string;
};

const KIND_RULES: KindRule[] = [
  { re: /qr|barcode|二维码|條碼|バーコード|スキャン|スキャンナ|scanner/i, line: "扫二维码 / 条形码" },
  { re: /cleaner|cleanup|clean.?up|クリーン|清理|重複写真|重复照片|photo.?clean|duplicate.?photo|storage cleanup|phone storage/i, line: "清理重复照片、腾手机空间" },
  { re: /vpn|proxy/i, line: "VPN / 网络加速" },
  { re: /antivirus|virus|malware|adblock|ad.?block|安全|セキュ|norton|360|拦截|危險網站/i, line: "手机安全 / 拦截危险网站" },
  { re: /mirror|cast|投屏|mirroring|tv.?cast|screen.?mirror/i, line: "把手机画面投到电视" },
  { re: /pdf|scan.?doc|document.?scan|スキャナー.*pdf/i, line: "PDF / 文档扫描" },
  { re: /translate|翻译|翻訳/i, line: "翻译工具" },
  { re: /keyboard|输入法|キーボード/i, line: "输入法" },
  { re: /widget|小组件|ウィジェット/i, line: "桌面小组件" },
  { re: /recorder|录音|録音/i, line: "录音 / 备忘" },
  { re: /password|密码|パスワード|authenticator/i, line: "密码 / 验证器" },
  { re: /file.?manager|文件管理|ファイル/i, line: "文件管理" },
  { re: /flashlight|手电|ライト/i, line: "手电筒 / 实用小工具" },
  { re: /calendar|日历|カレンダー/i, line: "日历 / 提醒" },
  { re: /note|笔记|メモ|notepad/i, line: "笔记工具" },
  { re: /photo|相机|カメラ|filter|编辑|編集|retouch/i, line: "照片编辑 / 滤镜" },
  { re: /video|视频|動画/i, line: "视频剪辑 / 压缩" },
];

function detectKind(name: string, description: string): string | null {
  for (const rule of KIND_RULES) {
    if (rule.re.test(name)) return rule.line;
  }
  const descRules = KIND_RULES.filter((rule) => !/photo|video|storage|file.?manager|widget/i.test(rule.re.source));
  for (const rule of descRules) {
    if (rule.re.test(description.slice(0, 280))) return rule.line;
  }
  return null;
}

function detectSubscription(description: string): boolean {
  return /subscription|subscribe|订阅|訂閱|課金|premium|pro plan|weekly|monthly|年額|月額/i.test(
    description,
  );
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const cut = cleaned.split(/(?<=[。！？.!?])\s/)[0] ?? cleaned;
  return cut.length > 36 ? `${cut.slice(0, 34)}…` : cut;
}

export function buildOneLiner(input: {
  name: string;
  description?: string | null;
  country?: string | null;
  rank?: number | null;
  genreId?: string | null;
}): string {
  const description = input.description ?? "";
  const kind = detectKind(input.name, description);
  const bits: string[] = [];

  if (kind) {
    bits.push(kind);
    if (detectSubscription(description) && /扫二维码|清理/.test(kind)) {
      bits[0] = `${kind}，靠订阅收费`;
    }
  } else {
    const sentence = firstSentence(description);
    if (sentence) bits.push(sentence);
    else bits.push(`${genreLabel(input.genreId ?? "")}类工具`);
  }

  if (input.rank === 1 && input.country) {
    bits.push(`${countryLabel(input.country)}畅销第一`);
  } else if (input.rank === 2 && input.country) {
    bits.push(`${countryLabel(input.country)}畅销第二`);
  }

  return bits.filter(Boolean).join("，");
}
