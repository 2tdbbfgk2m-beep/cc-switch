# 个人版构建和更新

个人仓库：https://github.com/2tdbbfgk2m-beep/cc-switch

推送或合并代码到 `main` 后，`Personal macOS Release` 会自动检查前端、构建 Apple 芯片 Mac 版本、生成带签名的更新包并发布到 GitHub Releases。也可以在 Actions 页面手动运行该流程。只有构建和更新清单检查通过后才会公开 Release。

版本格式为 `<上游版本>-personal.<工作流运行序号>`。重跑失败的任务沿用序号；手动启动新任务产生新序号。

更新地址：

```text
https://github.com/2tdbbfgk2m-beep/cc-switch/releases/latest/download/latest.json
```

`src-tauri/tauri.personal.conf.json` 保存个人更新地址和公钥，构建时覆盖上游配置。发布私钥保存在仓库 Actions Secret `TAURI_SIGNING_PRIVATE_KEY` 中，不能提交到 Git。请妥善备份私钥，后续更新必须保持公钥和私钥匹配。

此流程只发布 macOS ARM64。应用使用临时代码签名，没有 Apple Developer ID 公证；Tauri 更新包使用独立密钥签名并在安装前校验。首次需手动安装个人版，此后可在应用中一键更新。

## 合并作者更新

```bash
git remote add upstream https://github.com/farion1231/cc-switch.git # 已存在则跳过
git fetch upstream
git switch main
git merge upstream/main
# 解决可能的冲突并测试，再推送
git push origin main
```

合并上游后不要恢复官方 updater 地址、公钥或在个人流水线中调用官方发布流程。上游内置的 Release / R2 / 定时维护流程在此 Fork 中停用；使用本仓库的 `Personal macOS Release`。

## 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev:personal
# 本地打包需要同一发布私钥（或仅在开发时关闭更新包生成）
pnpm build:personal
```

保留上游 MIT 许可证与版权声明。第三方下载不会携带本机账号、供应商密钥或个人数据库。

## Command Code 直连与桌面凭据同步

Command Code 只保留原生 BYOK 直连，不再提供 CC Switch 本地路由和模型槽。
升级时只移除可确认由旧版本生成的本地 `router` 供应商；不改默认模型、会话或真实供应商。
历史槽位数据库表保留，便于回退，已不参与运行。

本机桌面登录适配的 LaunchAgent 每分钟调用
`~/.commandcode/desktop/sync-auth.mjs`。脚本的受版本管理副本位于
`scripts/commandcode-sync-auth.mjs`，可在已有桌面适配环境安装：

```bash
install -m 600 scripts/commandcode-sync-auth.mjs ~/.commandcode/desktop/sync-auth.mjs
node ~/.commandcode/desktop/sync-auth.mjs
```

它同步 API 密钥的新增、修改和删除，并清理改用环境变量/命令引用后残留的本地 API 密钥。
已管理供应商的标识记录在 `~/.commandcode/desktop/auth-sync-state.json`，不包含密钥。
只接管实际同步过的 API 凭据，不根据供应商定义删除桌面独有密钥。
本地登录字段、OAuth 凭据和无关供应商保留；输入损坏时拒绝写入。
脚本只服务已配置的本地桌面适配，不安装或更改 LaunchAgent、官方登录与会话。

回归检查：

```bash
node --test tests/scripts/commandcodeSyncAuth.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib commandcode_config::tests -- --test-threads=1
```
