# appgap.if2.ai 独立部署

目标为 rainplay（`w.rainplay.cn:39859` / SSH 别名 `rainplay`），公开域名 `https://appgap.if2.ai`。此部署与原 `appgap.01mvp.com`、Workers / D1 独立，不迁移或修改原站数据。mybros 的 lobbyd 和端口映射、Mini Tanks 离站备份保持原状。

## 本地验证 / 打包

Node 24.19.0；`pnpm install --frozen-lockfile`、`pnpm test`、`python -m unittest discover -s scripts/steam -p 'test_*.py'`、`pnpm build:server`、`node scripts/smoke-server.mjs`。源码在 `G:/MyTools/appgap` 的 `codex/rainplay-self-host` 分支；先提交，再按提交哈希命名 release。包只包含 `dist/`、`dist-server/`、`migrations/`、`deploy/`、`scripts/steam/`、`docs/` 和 `package.json`，不含凭据、node_modules、原 D1 或本地数据库。研究报告和冻结数据仅在私有仓库及受站点登录保护的静态目录保存，不进公开源码提交。

## 主机布局

- `/opt/appgap/runtime/node/`：隔离安装的官方 Node 二进制，下载时校对官方 SHA256，不替换系统 Node。
- `/opt/appgap/releases/<commit>/`、`current`、`previous`：只读应用版本，健康检查失败恢复原链接。
- `/var/lib/appgap/appgap.sqlite`：新站独立数据库，由版本化 SQL 自动迁移；owner appgap，目录 0700。切换旧应用前必须先核对迁移兼容性，当前迁移均为新增表 / 索引。
- `/etc/appgap.env`：root 0600；站点口令仅在此，最少 10 字符；DeepSeek Key 可选，不进入前端或日志。首次 bootstrap 随机生成口令，不显示值。
- `appgap.service`：仅 `127.0.0.1:8790`，非 root、受限文件写入、768 MiB 上限（含有大小限制的导入子进程）。
- `appgap-ingest.timer`：每周一香港时间 08:30；可用 `systemctl start --no-block appgap-ingest.service` 人工触发。任务最多 55 分钟，数据库锁 60 分钟后过期；不要并发手工绕过。
- `appgap-backup.timer`：每天香港时间 03:20；在线一致性备份到 `/var/backups/appgap/`，主库保留 30 天，Steam 快照 / 历史保留 7 天。独立于已有 Mini Tanks 备份，当前不冒充异地容灾。
- Steam 游戏列表图片按需缓存于 `/var/lib/appgap/steam/images/`，独立于 release；上游仅允许快照中匹配 appId 的 Steam 图片 CDN 地址，禁止重定向。图片按源 URL 版本存储，7 天后后台刷新；故障时复用旧图，无图显示名称首字。总量最多 32 MiB / 1,000 文件，单张 256 KiB，同时下载 2 张、最多排队 64 个不同请求；同图合并请求，失败退避 10 分钟。写入时淘汰最旧文件并清理 30 天旧项；原子替换暂存额外占用至多一张图片。浏览器私有缓存 7 天、ETag 支持 304；API 仍要求登录。图片可重建，不加入主库 / Steam 备份；不增加 Actions 存储或 DeepSeek 调用。

## Cloudflare 与秘密

DNS 继续经 `ssh tx-vgm` 在服务器上读 `/etc/mini-tanks-certs/cloudflare.ini` 调 API；值不离开 TX。该 Token 只有 DNS 编辑权限，没有 Tunnel 管理权限，不能静默扩大权限。新站使用独立隧道时，只暴露 AppGap 回环端口，不改原应用的公网映射。

仓库原来的 `pnpm deploy` 和 `pnpm ingest:prod` 仍指向原 Workers / D1；**本次 VPS 运维不要运行它们**。VPS 只运行 `dist-server/index.js`、`--ingest` 和 `--backup`。

## 已上线与数据交付（2026-10-25）

`appgap.if2.ai` 已通过独立 Cloudflare Tunnel `appgap-rainplay` → 回环端口上线；官方 cloudflared 运行在专用非登录用户下，token 仅在 root 0600 文件中经 systemd Credential 提供。DNS 经 TX API 先建再绑定；Cloudflare 边缘 TLS，无需改变原游戏域名、80 / 443 映射或全机网络配置。

Steam 管线在私有仓库 `novolei/appgap-steam-data` 每日香港时间 09:13 运行。先归档，再更新只存最新产物的 `snapshot` 分支，随后用独立发布令牌 POST `/api/steam/publish`。该令牌仅存服务器环境文件与 GitHub Actions Secret；它不能 SSH 登录、读取原站或调用 Cloudflare。默认 Python User-Agent 曾被边缘拒绝，改用明确标识 AppGap 的 User-Agent 后成功，未降低 WAF 或认证保护。原 VPS 拉取方案及只读部署密钥撤销。

首个成功端到端运行：[40183693736](https://github.com/novolei/appgap-steam-data/actions/runs/40183693736)。首份完整快照：430 款游戏、29 地区、3,045 条去重榜单记录、422 / 422 评论目标成功、887 份源响应。采集完成于香港时间 2026-10-25 16:45:44；分析版本 `2026-10-25.3`。本次完整周榜基线为 10 月 6 日，明确不参与当前动量评分。

导入请求最多 24 MiB；每个压缩产物最多 8 MiB；解压 JSON / SQLite 最多 25 / 128 MiB，至少保留 1 GiB 空余磁盘。完整 payload 保留两期、紧凑历史保留 400 天，原始响应留私有 Artifacts 7 天（单次最多 32 MiB）。网站失败时保留旧数据。私有 Actions 使用账号共享分钟数和存储配额，未改变预算或计费设置。

初次部署已验证受保护的新站 App Store / Steam 页面、真实采集、GitHub Actions HTTPS 交付、Node → Python → SQLite 导入与重复包幂等。App Store 新站首次采集得到 3,818 款应用、15,166 条榜单和 560 个机会。当时未运行付费 DeepSeek 生成；后续完整真实验收见下方更新，持续趋势仍需 14–28 天同口径历史。

收尾验证：新版源码的 [40184884997](https://github.com/novolei/appgap-steam-data/actions/runs/40184884997) 以 `bootstrap` 模式成功完成真实 Steam 探测、已有完整样本归档和 HTTPS 重复包交付；该运行没有重新扫描所有游戏评论，日常定时模式仍为 `collect`。首份完整批次通过开发电脑 OpenClash 网络采集，不将交付验证冒充完整 Actions 扫描。

移除旧采集 raw、Git 镜像、临时拉取目录和旧发布归档后，Steam 在线目录约 21 MiB；VPS 根盘约 11 / 30 GiB，剩余约 19 GiB。AppGap 备份约 13 MiB，已于 UTC 10:28 实际解压恢复主库 / Steam 历史并通过 `quick_check`，历史 payload 与 JSON 一致。旧 GitHub Deploy Key 已删除，VPS 上对应私钥 / known-hosts 和两组旧采集单元均移除；保留当前、上一版及少量最近应用版本。mybros 仍为原 PID 2577971、启动时间 10-23 06:50 UTC，Mini Tanks 原 cron 未改。未登录访问研究报告返回登录页，不能只看其 HTTP 200 判断泄露。

离线 Notebook 的 8 个代码单元已执行通过；另在临时空目录仅使用私有仓库的压缩输入重新运行 8 个单元也通过。冻结输入 SHA256 `f77f9c512a79f41271384606d40461bffc2d46d9810525b38575db7f0b62d948` 与线上快照相同。

## 后续全量与共享研究更新

完整 Actions 运行、快照 #4、真实 Steam / App Store / 自定义模型调用及缓存证据见 [verification-2026-10-25.md](verification-2026-10-25.md)。现在实时快照已更新，前段的 430 款及 SHA 仅指首批冻结样本。手工 Actions 已统一完整采集，移除会把新快照与旧 raw 配对的 bootstrap 测试入口，归档增加源响应逐份校验。

AI 新增迁移 `0007_ai_cache.sql`，详见 [ai-cache.md](ai-cache.md)：App Store 与 Steam 共享持久缓存、并发协调和每日 20 次新请求额度。标准报告 7 天，自定义内容按签名会话隔离 24 小时；读取缓存不调用模型，旧报告明确标记数据日期。标签支持输入补全、文字匹配及 `+` 组合。现有访问口令不变，注册与捐赠只给出方案，未开启。
