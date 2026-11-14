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

## Command Code 桌面版 DS4.1F 偏好学习

这是一项可选的个人 Mod，使用 Command Code 的原生 Mods 生命周期和 `createLearner`，
不使用 MCP、本地路由或额外守护进程，也不修改 Command Code 应用包。
只在桌面版的 `localOnly` 环境生效；独立安装的 CLI 保持原行为。

在已有 OpenCode Go 供应商的环境安装：

```bash
node scripts/install-commandcode-taste.mjs
```

安装器只添加 `~/.commandcode/mods/cc-switch-taste.mjs`，不会改写模型、登录、MCP、
供应商、学习开关或会话配置。更新自己的旧 Mod 时留存独占备份；同名外来文件拒绝覆盖。
桌面版重新加载 Mods 或新建会话后生效，无需重启正在进行的聊天。
每个个人 Release 同时附带这两个脚本；安装器和 Mod 文件须放在同一目录。
CC Switch 的应用更新与此可选 Mod 的安装是两个独立步骤。

流程：新一轮对话结束 → 复制本轮新增的用户/助手文本 → 后台调用 Go 的
`deepseek-v4.1-flash` → 原生 learner 使用受限制的 Taste 文件工具 → 后续对话由原生
Taste 机制读取偏好。现有 `taste` 工具在此环境下由 Mod 接管，返回“后台待学习”，
不会在尚未写入时声称已经保存。

接入固定读取 `providers.json` 中的 `cc-switch-open-code-go` 和 `auth.json` 中该项的
现有 API 密钥，每次请求重读，因此无需复制、硬编码或提交密钥。使用 Chat Completions
流式工具调用，以及诚实的 User-Agent 和每会话稳定的 `x-opencode-session`。
供应商或密钥不可用时停止本次学习，不切换到其他服务；失败通过提示展示，不中断主对话。

学习遵守现有用户和项目 Taste 开关；只处理当前新一轮，不导入、回扫或修改旧会话。
保留原生 Taste 格式和项目目录 `.commandcode/taste/`，不在安装时改写已有偏好。
工具输出、图片、助手推理和模型生成的 `taste` 指令不作为新偏好证据。
已知认证秘密会从请求正文中替换，但这不构成通用敏感信息识别保证。
启用后的新增对话文本及必要的既有 Taste 内容会发送到你的 Go 接口，并消耗其额度。

同一桌面进程对同项目学习串行处理。写入限制在项目 Taste 目录内，拒绝符号链接，
采用临时文件原子替换；检测到已有文件被外部修改时取消本次写入。
单次最多六轮工具调用、九十秒；未完成的流式工具调用不会执行。
如果上游移除所需 Mod API，插件提示加载失败，保留原程序和会话。

停用可使用原有 Taste 学习开关；卸载只删除这个 Mod 文件并重新加载 Mods。
已有 Taste 文件保留，CLI、账号适配和其他 Mod 不受影响。

回归检查：

```bash
node --test tests/scripts/commandcode*.test.mjs
```

本机另外使用桌面版 0.1.61 实际附带的 harness、原生 Mod 发现和隔离虚构会话，
验证真实 DS4.1F 的创建、更新、下一轮读取、旧历史排除、无关规则保留、一次性要求不写入、
学习开关和模拟鉴权失败。测试不上传真实会话，也不在真实项目中创建测试偏好。
