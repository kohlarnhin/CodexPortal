<p align="center">
  <img src="./app-icon.png" width="112" alt="Codex Portal Logo" />
</p>

<h1 align="center">Codex Portal</h1>

<p align="center">
  macOS / Windows 上的 Codex 桌面管理工具，支持智能账号调度、实时额度、配置、MCP、Skill 与会话管理。
</p>

<p align="center">
  <a href="https://github.com/kohlarnhin/CodexPortal/releases/latest">下载最新版本</a> ·
  <a href="https://github.com/kohlarnhin/CodexPortal/issues">反馈问题</a>
</p>

## 解决什么问题

将 Codex 的账号、额度、配置和会话集中管理，减少手动换账号、修改配置和查找会话的操作。

| 使用中的问题 | Codex Portal 提供的功能 |
| --- | --- |
| 当前订阅账号额度用完 | 核对实时额度后自动切换至可用订阅账号 |
| 剩余额度与重置时间不直观 | 实时展示短周期、长周期额度 |
| 配置与扩展管理分散 | 可视化管理配置、MCP 和 Skill |
| 多项目会话难查找 | 活跃项目展示、历史会话搜索与用量统计 |

**智能账号调度**在当前订阅账号额度耗尽时复核额度，优先使用最早到期的可用额度。切换会更新本地 `auth.json` 并重启 app-server。支持恢复的客户端可自动重连并继续符合恢复条件的任务。

**本项目提供本地管理功能，不涉及模型接口反代或第三方 API 中转。**

## 下载安装

从 [GitHub Releases](https://github.com/kohlarnhin/CodexPortal/releases/latest) 下载适合本机的文件。macOS 打开 DMG 后将 **Codex Portal** 拖入 **Applications**；Windows 将便携 EXE 保存到有写入权限的目录，直接运行。

| 系统 / 架构 | 下载文件 |
| --- | --- |
| macOS Apple Silicon（M 系列芯片） | `CodexPortal_<版本号>_arm64.dmg` |
| macOS Intel | `CodexPortal_<版本号>_x64.dmg` |
| Windows x64 | `CodexPortal_<版本号>_windows_x64.exe` |

当前仓库版本为 **0.5.1**。可在“关于”页面检查、下载并安装更新。Windows 便携版会替换原 EXE 并重新启动。

## 支持范围

支持 **OpenAI 官方订阅账号**和**官方 API Key 账号**，兼容独立安装的 **Codex CLI** 与带本地 Codex 功能的 **ChatGPT 桌面版**。可安装其中之一或同时安装，Portal 会分别探测引擎并尝试连接可用服务。

按原方式启动 Codex TUI，或在 ChatGPT 桌面版中发起本地 Codex 会话。当前账号额度会随本地会话同步更新；实时额度推送与活跃会话需要客户端提供可接入的本地 app-server 控制入口；任务恢复还需要客户端支持相应功能。

可在“Codex 信息”分别查看 CLI 与 ChatGPT 桌面内置引擎版本。连接异常时，“实时日志”会显示引擎来源与失败阶段，便于区分安装位置、命令兼容和服务连接问题。

## 功能

### 账号与订阅额度

- **多账号管理**支持 PAT、Refresh Token 和 OAuth 登录，以及启用、禁用、备注和 OAuth 重新授权。列表可按认证方式、订阅和状态筛选，并按剩余额度、重置时间、名称或添加时间排序。首次启动会尝试导入本机 Codex 登录，也可在“账号管理”中手动导入。
- **API Key 账号**可在“账号管理”中添加官方 API Key 或导入本机 API Key 登录。可单独发送测试消息，请求按 OpenAI API 用量计费。
- **额度速览**：侧边栏底部常驻当前账号与各周期剩余额度，任意页面都能查看。
- **实时额度**：展示短周期、长周期剩余额度和重置时间。当前账号额度随本地会话同步更新，接入 app-server 时同时接收官方实时推送，并以最新观测结果为准；支持手动刷新。
- **连接兼容**：自动探测 CLI 与 ChatGPT 桌面内置引擎的已有服务，支持连接回退及不同版本的会话订阅参数。
- **智能调度**适用于已启用且可查询额度的订阅账号。在“当前账号”和“账号管理”可查看预计接替账号，全部额度耗尽时可查看最早恢复时间。
- **额度窗口激活**按启用订阅账号的短周期重置时间安排，也可从账号卡片手动发起。激活通过测试消息触发，会消耗账号额度。
- **重置卡**：支持的 Team 账号可查看重置次数、明细并使用重置卡。

### 配置与扩展

- **可视化配置**：编辑模型、推理强度、审批策略、沙盒模式与功能开关；选择完整主机访问或免审批等高风险选项时给出提示。
- **高级 TOML 编辑**：带行号编辑完整配置，语法错误定位到行，预览保存差异，提示外部修改冲突。
- **MCP 管理**：新增、编辑、启停、删除与复制 MCP 配置，支持 STDIO / HTTP，并支持将旧版 `disabled` 字段一键迁移为 `enabled = false`。
- **内置 MCP 服务**可在“设置”的“MCP 服务”中一键安装到 Codex 或 Claude Code。新开的会话可以查询账号额度、请求智能切换。其他支持 STDIO 的客户端可将已安装的 Portal 可执行文件配置为命令，传入参数 `mcp`。调用时需保持 Portal 运行。
- **Skill 管理**：浏览本地 Skill，查看说明，从本地目录添加或删除。

### 会话与 Token 用量

- **活跃项目**：展示活跃会话总数，以及最近活跃的最多 3 个项目和各自的会话数量。
- **空闲自动移出**：空闲超过 5 分钟后移出统计，发送新消息后自动恢复。
- **历史会话**：按项目浏览、搜索会话，查看内容与 Token 消耗，复制恢复命令或打开项目目录。
- **用量统计**：按日期查看输入、缓存命中、输出与推理 Token。用量趋势、项目分布、模型分布三个视图切换展示：趋势按天 / 周 / 月自动聚合，项目与模型以堆叠趋势图展示前 5 名，也可切换为完整排行列表。
- **金额参考**：提供 API 价格估算，**不代表订阅实际扣费或剩余额度**。

### 实时日志

- 实时查看额度、会话、账号切换等运行日志，支持自动滚动。
- 查看 CLI / ChatGPT 引擎来源以及服务探测、握手与会话订阅失败提示。
- 窗口展示最新 **100 条**，历史日志仍保留在文件中，可直接打开文件位置。

### 应用设置

- 支持在“设置”中切换浅色、深色或跟随系统主题，并与窗口外观同步。
- 邮箱脱敏、开机自启动默认开启，可在“设置”中调整。
- 系统托盘可查看当前账号、额度和账号列表，也可打开账号管理。应用支持后台运行。
- 免打扰时段推迟到期的自动额度刷新与窗口激活，默认开启，时段为 19:00–次日 09:00，可调整或关闭。
- 支持自动检查更新、下载安装新版本；侧边栏显示当前版本号，发现新版本时提示。

## 数据、网络与隐私

- 账号、配置、会话、用量与日志保存在本机，不向项目服务器上传。
- 登录、额度查询和 API 测试访问 OpenAI 服务，应用更新通过 GitHub Releases 获取。
- 内置 MCP 服务通过本机连接读取额度与调度状态。一键安装到 Codex 或 Claude Code 时，会分别在 `~/.codex/config.toml` 或 `~/.claude.json` 中写入 Portal 的 MCP 配置。
- 切换账号会覆盖本地 `auth.json`；配置与 MCP 直接读写 `~/.codex/config.toml`。
- 认证信息以明文保存在本地数据库，请勿公开 Token、认证文件或数据库。

## 本地开发

技术栈：**Tauri 2、Rust、React、TypeScript、SQLite**。

准备 Node.js 24、npm、Rust stable，以及 [Tauri 2 所需的系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/kohlarnhin/CodexPortal.git
cd CodexPortal
npm ci
npm run tauri dev
```

也可运行 `./start_dev.sh`。macOS 上可用 `npm run install:local` 构建并安装自用版本，命令会替换并重新打开 `/Applications/Codex Portal.app`。

开发约定与发布流程见 [项目 SKILL.md](.codex/skills/codex-portal-release/SKILL.md)。
