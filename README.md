# AppGap · App 趋势

从 App Store **畅销榜 / 免费榜**里找需求：谁在付钱、谁被骂、哪类玩法正在涨。

线上：https://appgap.01mvp.com（内部工具，需要密码）

## 数据怎么来的

不需要 Sensor Tower / Appfigures 账号。用 Apple 公开接口：

- 畅销榜 / 免费榜 RSS：`itunes.apple.com/{区}/rss/topgrossingapplications/limit=100/genre={品类}/json`
- 评分和评价数：iTunes Lookup `itunes.apple.com/lookup?id=...&country=...`
- 最近评价：`itunes.apple.com/{区}/rss/customerreviews/id={id}/json`

覆盖美国、加拿大、英国、爱尔兰、德国、法国、瑞士、荷兰、瑞典、挪威、澳洲、新西兰、日本、韩国、新加坡、阿联酋、中国、香港、中国台湾。品类是工具、效率、照片、游戏。

## 镜头、筛选、名单

| 功能 | 做什么 |
| --- | --- |
| 赚钱的小工具 / 游戏 | 已经排进畅销榜 |
| 差评可替换 | 畅销但评分掉在 4 以下 |
| 新上榜 / 同类扎堆 / 小工作室 / 别国没有 | 其它需求发现镜头 |
| 按国家 | 只看该国本期榜上的 App，台湾显示为「中国台湾」 |
| 候选 | 先收藏看着，还没决定做。存在线上 D1 |
| 立项 | 准备动手。存在线上 D1 |
| 复制给 Codex | 把当前 App 或本页清单复制成 Markdown |
| DeepSeek 分析 | 点一次，用 DeepSeek v4 Flash 写需求笔记。API Key 只在 Cloudflare Worker，不进前端 |

## 本地开发

```bash
pnpm install
pnpm cf-typegen
npx wrangler d1 migrations apply appgap --local
pnpm dev:worker   # :8787
pnpm dev          # :5173，/api 会转到 Worker
```

本地密钥放在 `.dev.vars`（已 gitignore）：

```
SITE_PASSWORD=...
DEEPSEEK_API_KEY=...
```

## 部署

```bash
pnpm deploy
```

生产密钥用 Wrangler secrets，不要写进仓库：

```bash
npx wrangler secret put SITE_PASSWORD
npx wrangler secret put DEEPSEEK_API_KEY
```

域名：https://appgap.01mvp.com

默认 **每周一 08:30（北京时间）** 扫一次榜，结果写入 D1。打开 https://appgap.01mvp.com 只读这份缓存，不会现场去拉 Apple。

Apple 有时会拦 Cloudflare 机房 IP。Worker 拉失败就保留上一份快照；约 90 分钟后 GitHub Actions 会再用非 Cloudflare IP 补拉一次。本机也可以手动写入：

```bash
pnpm ingest:prod          # 用你这台电脑的 IP 拉榜，写入线上 D1
```
