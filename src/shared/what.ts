export type AppKind = {
  id: string;
  nameZh: string;
  what: string;
  re: RegExp;
};

export const APP_KINDS: AppKind[] = [
  { id: "qr", nameZh: "二维码扫描", what: "扫描或生成二维码 / 条形码", re: /qr|barcode|二维码|條碼|バーコード|スキャン|scanner/i },
  { id: "caller", nameZh: "来电识别", what: "识别骚扰电话 / 来电显示", re: /whoscall|truecaller|来电|骚扰电话|caller.?id|caller id/i },
  { id: "cleaner", nameZh: "手机清理", what: "清理重复照片、腾出存储空间", re: /cleaner|cleanup|clean.?up|クリーン|清理|重複|duplicate.?photo|storage cleanup|phone storage|flush/i },
  { id: "vpn", nameZh: "VPN", what: "VPN / 网络加速", re: /\bvpn\b|proxy|pandavpn|nordvpn/i },
  { id: "auth", nameZh: "两步验证器", what: "两步验证 / 一次性密码", re: /authenti|2fa|mfa|otp|验证器/i },
  { id: "cast", nameZh: "手机投屏", what: "把手机画面投到电视", re: /mirror|cast|投屏|mirroring|chromecast|tv.?cast/i },
  { id: "security", nameZh: "手机安全", what: "拦截危险网站、杀毒或网页防护", re: /security|antivirus|virus|malware|adblock|norton|protectme|网页防护|危险网站|セキュ/i },
  { id: "cctv", nameZh: "远程监控", what: "远程看家用摄像头", re: /cctv|ipcam|egloo|eagle|monitor|nvr|看家|监控|check in on|live video tracker|grec/i },
  { id: "remote", nameZh: "远程控制", what: "远程控制电脑或设备", re: /oslink|remote access|rdp|vnc|远程控制|remote desktop/i },
  { id: "cloud", nameZh: "云盘网盘", what: "云盘存储、备份文件", re: /cloud|mybox|terabox|网盘|百度网盘|dropbox|drive/i },
  { id: "pdf", nameZh: "PDF 工具", what: "扫描、转换或阅读 PDF", re: /pdf|scan.?doc|document.?scan/i },
  { id: "calendar", nameZh: "日历日程", what: "日历、日程和提醒", re: /calendar|planner|timeblocks|日历|日程|カレンダー/i },
  { id: "widget", nameZh: "桌面小组件", what: "桌面小组件 / 时钟", re: /widget|小组件|floating clock|ウィジェット/i },
  { id: "photo", nameZh: "照片滤镜", what: "修图、拼贴或复古滤镜", re: /photo|collage|filter|retouch|相机|カメラ|vintage|修图/i },
  { id: "video", nameZh: "视频工具", what: "视频剪辑、压缩或录制", re: /video|视频|動画|tracker/i },
  { id: "translate", nameZh: "翻译", what: "翻译文字或口语", re: /translate|翻译|翻訳/i },
  { id: "keyboard", nameZh: "输入法", what: "输入法", re: /keyboard|输入法|キーボード/i },
  { id: "notes", nameZh: "笔记", what: "笔记和备忘", re: /note|memo|笔记|メモ|notepad/i },
  { id: "dating", nameZh: "恋爱互动", what: "恋爱互动 / 情侣工具", re: /hope|戀愛|恋爱|dating|emotion companion/i },
  { id: "files", nameZh: "文件管理", what: "管理手机文件", re: /file.?manager|文件管理/i },
  { id: "ai-chat", nameZh: "AI 助手", what: "聊天机器人 / AI 助手", re: /chatbot|ai assistant|chatgpt|claude/i },
  { id: "moba", nameZh: "MOBA 对战", what: "多人实时对战手游", re: /王者荣耀|honor of kings|wild rift|mobile legends|moba/i },
  { id: "gacha", nameZh: "卡牌抽卡", what: "抽卡 / 养成手游", re: /gacha|抽卡|原神|崩坏|明日方舟|fgo|genshin/i },
  { id: "puzzle", nameZh: "益智消除", what: "消除、解谜或排序休闲游戏", re: /puzzle|sudoku|match.?3|sort|消除|解谜|数独/i },
  { id: "idle", nameZh: "放置挂机", what: "放置 / 挂机游戏", re: /idle|afk|放置|挂机/i },
  { id: "sports-game", nameZh: "体育游戏", what: "球类或赛事手游", re: /soccer|football|baseball|野球|篮球|fifa|mlb|nba/i },
];

export function isGameGenre(genreId?: string | null): boolean {
  return genreId === "6014";
}
const GAME_KINDS = new Set(["moba", "gacha", "puzzle", "idle", "sports-game"]);

export function detectKind(name: string, description = "", genreId?: string | null): AppKind | null {
  const hay = `${name}\n${description.slice(0, 400)}`;
  const kinds = isGameGenre(genreId) ? APP_KINDS.filter((item) => GAME_KINDS.has(item.id)) : APP_KINDS;
  return kinds.find((item) => item.re.test(name)) ?? kinds.find((item) => item.re.test(hay)) ?? null;
}

export function describeApp(name: string, description?: string | null, genreId?: string | null): { nameZh: string; what: string; kindId: string | null } {
  const kind = detectKind(name, description ?? "", genreId);
  if (isGameGenre(genreId)) return { nameZh: name, what: kind?.what || "游戏，玩法以商店介绍为准", kindId: kind?.id || null };
  if (kind) return { nameZh: kind.nameZh, what: kind.what, kindId: kind.id };
  const desc = (description ?? "").replace(/\s+/g, " ").trim();
  if (/[\u4e00-\u9fff]/.test(desc)) {
    const cut = desc.split(/[。！？\n]/)[0]?.slice(0, 22) || desc.slice(0, 22);
    return { nameZh: cut, what: cut, kindId: null };
  }
  return { nameZh: name.replace(/\s+/g, " ").trim() || "小工具", what: "实用小工具", kindId: null };
}
