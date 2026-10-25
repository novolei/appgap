# appgap.if2.ai 独立部署

目标为 rainplay（`w.rainplay.cn:39859` / SSH 别名 `rainplay`），公开域名 `https://appgap.if2.ai`。此部署与原 `appgap.01mvp.com`、Workers / D1 独立，不迁移或修改原站数据。mybros 的 lobbyd 和端口映射、Mini Tanks 离站备份保持原状。

## 本地验证 / 打包

Node 24.19.0；`pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build:server`、`node scripts/smoke-server.mjs`。源码在 `G:/MyTools/appgap` 的 `codex/rainplay-self-host` 分支；先提交，再按提交哈希命名 release。包只包含 `dist/`、`dist-server/`、`migrations/`、`deploy/` 和 `package.json`，不含凭据、node_modules、原 D1 或本地数据库。

## 主机布局

- `/opt/appgap/runtime/node/`：隔离安装的官方 Node 二进制，下载时校对官方 SHA256，不替换系统 Node。
- `/opt/appgap/releases/<commit>/`、`current`、`previous`：只读应用版本，健康检查失败恢复原链接。
- `/var/lib/appgap/appgap.sqlite`：新站独立数据库，由版本化 SQL 自动迁移；owner appgap，目录 0700。切换旧应用前必须先核对迁移兼容性，当前迁移均为新增表 / 索引。
- `/etc/appgap.env`：root 0600；站点口令仅在此，最少 10 字符；DeepSeek Key 可选，不进入前端或日志。首次 bootstrap 随机生成口令，不显示值。
- `appgap.service`：仅 `127.0.0.1:8790`，非 root、受限文件写入、384 MiB 上限。
- `appgap-ingest.timer`：每周一香港时间 08:30；可用 `systemctl start --no-block appgap-ingest.service` 人工触发。任务最多 55 分钟，数据库锁 60 分钟后过期；不要并发手工绕过。
- `appgap-backup.timer`：每天香港时间 03:20；在线一致性备份到 `/var/backups/appgap/`，保留 30 天。独立于已有 Mini Tanks 备份，当前不冒充异地容灾。

## Cloudflare 与秘密

DNS 继续经 `ssh tx-vgm` 在服务器上读 `/etc/mini-tanks-certs/cloudflare.ini` 调 API；值不离开 TX。该 Token 只有 DNS 编辑权限，没有 Tunnel 管理权限，不能静默扩大权限。新站使用独立隧道时，只暴露 AppGap 回环端口，不改原应用的公网映射。

仓库原来的 `pnpm deploy` 和 `pnpm ingest:prod` 仍指向原 Workers / D1；**本次 VPS 运维不要运行它们**。VPS 只运行 `dist-server/index.js`、`--ingest` 和 `--backup`。

当前部署和公网验收的实际结果在完成后追加；本文件不预先宣称上线成功。
