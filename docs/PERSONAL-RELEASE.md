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

Command Code 的推理档位使用原生 `models.<id>.reasoningEfforts` 数组保存，
可选值为 `low`、`medium`、`high`、`xhigh`、`max`。空数组明确关闭档位；
表单开关与数组同步，不再把 MiniMax Code 的 `thinking.effortOptions` 当作原生声明。
导入已知模型时填充精确档位；未知自定义模型初始提供原生默认三档，可在模型详情中调整或关闭。
已有原生数组（含空数组）优先，更新不改变模型选择、会话或凭据。

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
Mod 只在桌面版的 `localOnly` 环境运行。CLI 程序未改；原生读取同一全局 Taste 的
Command Code 客户端也可以使用共享规则。

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

学习分为两个互相隔离的存储范围：

- 全局：`~/.commandcode/taste/taste.md`，保存回答语言、解释长短/深度、语气、回答格式等通用交流习惯，供所有 Command Code 项目使用。
- 项目：`<当前项目>/.commandcode/taste/taste.md`，保存技术栈、依赖/包管理器、代码规范、缩进、命名、代码注释语言、提交/文档语言及构建测试流程；也保存用户明确限定在当前项目的交流例外。

例如“以后中文回答、简短解释；Python 代码四空格”会分成全局交流规则和当前项目代码规则。
技术规则即使说成“所有项目”，也按此个人版策略只保存在当前项目，不扩大为全局。
旧规则不批量搬迁、不重新分类；只有新增对话中的明确证据可以更新相应范围内的记录。
不确定的偏好不应猜测记录。

每轮分别运行两个有明确范围约束的原生 learner；各自的文件运行时只能读写自己的 Taste 根目录。
主模型请求中的 Taste 块按全局/项目标记来源，分类文件引用改成相应范围的绝对路径。
工作区文件工具无法读取项目之外的全局分类文件，因此 Mod 在相同的 Taste 路径限制下
读取根文件引用的全局分类，并直接带入提示词；不放宽工作区权限。
当前用户要求优先；项目的明确例外覆盖全局默认值，但不改变其它项目的规则。
每次请求重新读取，因此 A 项目更新全局习惯后，B 项目下一次请求即可读取新值。
如果把用户主目录本身打开成项目，项目写入会跳过，避免把技术规则写进全局位置。

接入固定读取 `providers.json` 中的 `cc-switch-open-code-go` 和 `auth.json` 中该项的
现有 API 密钥，每次请求重读，因此无需复制、硬编码或提交密钥。使用 Chat Completions
流式工具调用，以及诚实的 User-Agent 和每会话稳定的 `x-opencode-session`。
供应商或密钥不可用时停止本次学习，不切换到其他服务；失败通过提示展示，不中断主对话。

学习遵守现有用户和项目 Taste 开关；只处理当前新一轮，不导入、回扫或修改旧会话。
保留原生 Taste 格式和全局/项目目录，不在安装时改写已有偏好。
工具输出、图片、助手推理和模型生成的 `taste` 指令不作为新偏好证据。
已知认证秘密会从请求正文中替换，但这不构成通用敏感信息识别保证。
启用后的新增对话文本及必要的既有 Taste 内容会发送到你的 Go 接口，并消耗其额度。

同一桌面进程对同用户的两个范围串行处理，避免不同项目同时修改全局规则而丢失更新。
写入限制在该学习轮所属的全局或项目 Taste 目录内，拒绝符号链接，
采用临时文件原子替换；检测到已有文件被外部修改时取消本次写入。
每个范围最多六轮工具调用，整次学习共用九十秒期限；未完成的流式工具调用不会执行。
两个范围分别判断，会比单项目版本多消耗一次或更多 Go 请求；无新增偏好时两轮都不写规则。
如果上游移除所需 Mod API，插件提示加载失败，保留原程序和会话。

停用可使用原有 Taste 学习开关；卸载只删除这个 Mod 文件并重新加载 Mods。
已有 Taste 文件保留，账号适配和其他 Mod 不受影响。卸载 Mod 不会删除已经学到的全局规则。

回归检查：

```bash
node --test tests/scripts/commandcode*.test.mjs
```

本机另外使用桌面版 0.1.61 实际附带的 harness、原生 Mod 发现和隔离虚构会话，
验证真实 DS4.1F 的全局/项目分流、跨项目读取和隔离、项目例外、更新旧规则、下一轮读取、
旧历史排除、无关规则保留、一次性要求不写入、学习开关和模拟鉴权失败。
测试不上传真实会话，也不在真实项目中创建测试偏好。

## Command Code 的 DOCX/PDF 附件（可选）

文档附件补丁 1.0.0 适配 Command Code **0.1.61 的指定构建**，不是 MCP，也不依赖订阅或外部解析服务。
在桌面版附件读取层本地解析，再交给原生附件与消息流程；解析本身不上传文档，发送消息时内容随主模型请求发送。
不改配置、登录、供应商、Taste、MCP 或历史会话。普通文本、图片和目录沿用原生处理。

```bash
pnpm install --frozen-lockfile
pnpm build:commandcode-documents
node scripts/install-commandcode-documents.mjs --dry-run
# 先退出 Command Code，再安装：
node scripts/install-commandcode-documents.mjs
```

发布包 `commandcode-documents-1.0.0.tar.gz` 已包含解析器；解压后在该目录直接运行同一安装命令，无需安装 npm 依赖。
安装器验证完整 renderer 哈希和解析包清单，不认识的桌面版拒绝修改。
备份放在 `~/.commandcode/desktop-backups/documents-0.1.61-*`，记录补丁版本与文件哈希；重复安装同包不重复修改。
仅添加 renderer 模块与修改附件派发，再为原本已 ad-hoc 签名的应用重建外层签名，并验证嵌套签名。
不改 main/preload，不放宽 CSP、不启用 Worker。签名失败自动恢复 renderer、可执行文件和签名资源封印。
Command Code 上游更新可能覆盖补丁；新版本需要重新检查适配，勿强行覆盖。

- DOCX：正文、列表、链接、表格转为 Markdown；合并格保留列位置。文内图片仅显示占位说明，不提取图片内容；页眉、页脚、批注与版式不保证保留。
- PDF：逐页提取文本；没有文本的页面转为图片，交给原生图片附件，需要支持图片的模型。没有调用 OCR 服务；带文本的页面不额外提取页面内图表，复杂排版阅读顺序不保证一致。
- 每份文件最多 20 MB、PDF 最多 100 页、提取文本最多 500 KB、DOCX 解压最多 40 MB/5000 项；加密、损坏、超限会提示失败，不截断伪装成功。
- 每条消息仍最多 8 张图片，扫描 PDF 页图计入此限制；同一批扫描页必须全部添加成功。大文档请拆分。

卸载（先退出桌面版）：

```bash
node scripts/install-commandcode-documents.mjs --remove
```

卸载验证备份和当前补丁归属，只恢复本补丁替换的应用文件，保留所有用户配置和会话。
回归测试包含真实 DOCX 表格、PDF 文本和 JPEG 扫描页渲染、草稿切换、图片容量、原子添加，以及安装失败回滚：

```bash
node --test tests/scripts/commandcode*.test.mjs
pnpm vitest run tests/commandcodeDocumentsHook.test.js
```

### GPT 推理档位默认值（2026-11-16）

Command Code 新增模型现在为已核实的 `gpt-6.1-sol`、`gpt-6.1-terra`、
`gpt-6-sol`、`gpt-6-luna`、`gpt-6-astra` 提供原生
`low / medium / high / xhigh / max` 五档，覆盖预设、新建模型、元数据补全与重新开启推理。
依据 OpenAI 各型号的模型文档；没有按 `gpt-*` 通配猜测未来型号，也不增加桌面版不支持的档位。

已有显式 `reasoningEfforts`（含三档、单档和空列表）、`reasoning: false`、
旧 `thinking.effortOptions` 和 `variants` 限制继续优先；补全失败也可离线使用已核实默认值。
没有全局配置迁移：此前自动生成的三档和用户主动限制成三档无法可靠区分，不能批量扩展。
修复已有条目时，只在用户明确要求的目标模型上补选“极高”和“最高”，不改变当前选中的推理强度。

相关测试全部可离线运行；真实 harness 验证使用模拟响应，不调用模型 API。

### 各应用统一模型能力检查与补全（2026-11-16）

模型配置现在复用一个按供应商接口匹配、逐字段取值的解析器：当前应用同接口预设 →
其他应用的同接口中性参数 → models.dev 同供应商 → 已核实修正 / 原厂 → 内置离线目录。
较低优先级只补缺项，供应商明确不支持推理时不会被原厂档位重新开启。不同端口与不同套餐路径不会混用。
内置 GPT 档位修正也放在公共目录中，不再由 Command Code 补全函数按模型名覆盖解析结果。

- Codex、OpenCode、OpenClaw、Hermes、Pi、OMP、Kimi、Copilot、MCode、DSH、Command Code 的模型区域都有“检查模型配置”。
- Claude Code 和 Gemini / Antigravity 提供同一入口的只读资料核对，由原生客户端管理的能力不写入额外字段。
- 对照当前值、参考值、字段来源，区分缺失、未知及冲突；资料之间有差异时提示，手动较小窗口、关闭状态、档位子集不视为需要扩展。
- 支持单模型及批量补全空字段。只修改当前表单，仍需保存；打开、检查和取消都不迁移旧配置。
- 手动输入或从供应商列表选择模型均走同一补全流程。异步结果在接口、协议、兼容设置改变或表单卸载后失效。
- 各应用按原生格式保存；DSH 档位保留界面名到 wire value 的映射（含 `null`）及其协议、compat 条件。
- Pi / Kimi 的新行自动默认值与用户主动关闭的能力分开处理；未知字段格式保持原样；自动输出上限不超过有效上下文。
- 未识别模型不再假设支持三档推理。公共资料不可达时使用离线参考，查不到的显示未知；用户仍可手动开启并配置。

此流程只读取公共模型目录，不上传密钥、会话或项目代码，不发送模型推理请求。
目录是配置参考，无法证明自定义中转接口的实际实现；没有为此自动发起付费探测。

### Command Code 手动推理档位（2026-11-16）

Command Code 的模型行现在复用 Codex 的多选控件，始终提供
`none / minimal / low / medium / high / xhigh / max / ultra` 候选。
这些是候选值，不代表每个模型支持全部；已核实的模型仍按原资料建议勾选五档或其子集。
新模型只有 reasoning 布尔值、没有档位资料时等待手动选择，不自动虚构三档；旧 boolean-only 配置保留兼容默认。
手动勾选或清空后，自动补全不覆盖；清空后不提供档位，保存为原生 `reasoning:false, reasoningEfforts:[]`；这不是向上游发送 `none`，不承诺关闭模型自身的思考。
列表拉取、手动新增使用相同控件，填写其他字段或取消不会改变原有 provider。
`ultra` 在此是用户自行声明的上游值，不包含 Codex 的自动任务委派，也不会自动映射成 max。

Command Code 0.1.61 及已核验的官方 0.1.62 原生解析器仍只接受五档。
因此额外提供版本及 SHA 限定的桌面端兼容扩展，修改 harness effort 校验及 OpenAI/Anthropic SDK 的 CJS、ESM 校验，允许显式声明的八档进入原生菜单数据与请求体。
不改内置模型的推荐档位，不写用户 providers/auth/config/history；安装前退出桌面版，先备份源码及签名，签名失败回滚。
文档解析和偏好学习使用的应用文件不在此扩展的修改范围。

```bash
node scripts/install-commandcode-reasoning.mjs --check-upstream  # 查官方最新版；未审计版本明确返回 unknown
node scripts/install-commandcode-reasoning.mjs --check           # 当前安装支持状态
node scripts/install-commandcode-reasoning.mjs --dry-run         # 只预检，不改应用
node scripts/install-commandcode-reasoning.mjs                   # 退出 Command Code 后安装
node scripts/test-commandcode-reasoning.mjs                      # 副本上真实 SDK 三协议八档测试，禁止真实网络
node --test tests/scripts/commandcodeReasoning*.test.mjs          # 安装/卸载/回滚/原生支持检测
node scripts/install-commandcode-reasoning.mjs --remove          # 退出后卸载，签名或文件变化时拒绝覆盖
```

官方版本检查只读取公开 GitHub Release 数据，不使用用户模型 API。
若当前原生代码已支持全部候选，安装器跳过补丁；未知版本、布局或校验不符时拒绝修改，需重新核验。
桌面版官方更新会替换应用内扩展；更新后运行 `--check` 和 `--dry-run`，原生已经实现时无需重装扩展。
2026-11-16 核验到的最新版为 [0.1.62](https://github.com/CommandCodeAI/desktop/releases/tag/v0.1.62)，发布说明为 Linux 启动修复，解包确认仍是五档。
