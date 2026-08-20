# AppGap · App 趋势

从 App Store **畅销榜**里找机会：用户在付钱，评分却很差。

线上：https://appgap.01mvp.com

## 数据怎么来的

不需要 Sensor Tower / Appfigures 账号。用 Apple 公开接口：

- 畅销榜 / 免费榜 RSS：`itunes.apple.com/{区}/rss/topgrossingapplications/limit=100/genre={品类}/json`
- 评分和评价数：iTunes Lookup `itunes.apple.com/lookup?id=...&country=...`
- 最近评价：`itunes.apple.com/{区}/rss/customerreviews/id={id}/json`

覆盖日 / 美 / 英 / 韩 / 台 / 德 / 法 / 澳，品类是工具、效率、照片（刻意排除游戏，否则畅销榜会被买量游戏淹没）。

## 四个镜头

| 镜头 | 怎么筛 |
| --- | --- |
| 赚钱但被骂 | 畅销榜上，评分 &lt; 4.0，评价足够多 |
| 小团队爆款 | 打进免费榜或畅销榜，开发者不是 Google / 政府 / 超大厂 |
| 跨地域缺口 | 一两个区很靠前，其他区几乎看不到 |
| 单一市场霸主 | 只在一个区的榜上很靠前 |

立项池 / 候选池存在浏览器本地，不经过服务器。

## 本地开发

```bash
pnpm install
pnpm cf-typegen
npx wrangler d1 migrations apply appgap --local
pnpm dev:worker   # :8787
pnpm dev          # :5173，/api 会转到 Worker
```

第一次打开页面如果库是空的，Worker 会自己拉一次榜。也可以：

```bash
curl -X POST http://127.0.0.1:8787/api/ingest
```

## 部署

```bash
pnpm deploy
```

域名：https://appgap.01mvp.com

Apple 会拦 Cloudflare 机房 IP（RSS 返回 403），所以线上 Worker 自己拉榜经常失败。日常更新走两条路（数据仍写进 Cloudflare D1，网站才能读）：

```bash
pnpm ingest:prod          # 用你这台电脑的 IP 拉榜，写入线上 D1
```

这台 Mac 已经挂了 launchd：每天 08:30 自动跑。日志在 `~/Library/Logs/appgap-ingest.log`。

GitHub Actions 每天 08:30（北京时间）也会试一次；如果 GitHub 的 IP 也被 Apple 拦，就靠本机那条。

没有新数据时，网站继续展示上一份快照。
