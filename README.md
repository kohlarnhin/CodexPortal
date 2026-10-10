<p align="center">
  <img src="./app-icon.png" width="112" alt="Codex Portal Logo" />
</p>

<h1 align="center">Codex Portal</h1>

<p align="center">
  macOS / Windows 上的 Codex 桌面管理工具，支持无感账号切换、实时额度、配置、MCP、Skill 与会话管理。
</p>

<p align="center">
  <a href="https://github.com/kohlarnhin/CodexPortal/releases/latest">下载最新版本</a> ·
  <a href="https://github.com/kohlarnhin/CodexPortal/issues">反馈问题</a>
</p>

## 解决什么问题

将 Codex 的账号、额度、配置和会话集中管理，减少手动换账号、修改配置和查找会话的操作。

| 使用中的问题 | Codex Portal 提供的功能 |
| --- | --- |
| 额度不足，需要手动换账号 | 按额度阈值自动切换，继续原会话 |
| 剩余额度与重置时间不直观 | 实时展示短周期、长周期额度 |
| 配置与扩展管理分散 | 可视化管理配置、MCP 和 Skill |
| 多项目会话难查找 | 活跃项目展示、历史会话搜索与用量统计 |

**无感自动切换**：达到额度阈值后自动换号，替换本地 `auth.json` 并重启 app-server。支持恢复的官方 Codex 会自动重连、继续符合恢复条件的任务，无需手动重启 CLI。

**本项目提供本地管理功能，不涉及模型接口反代或第三方 API 中转。**

## 下载安装

从 [GitHub Releases](https://github.com/kohlarnhin/CodexPortal/releases/latest) 下载适合本机的文件。macOS 打开 DMG 后将 **Codex Portal** 拖入 **Applications**；Windows 将便携 EXE 保存到有写入权限的目录，直接运行。

| 系统 / 架构 | 下载文件 |
| --- | --- |
| macOS Apple Silicon（M 系列芯片） | `CodexPortal_<版本号>_arm64.dmg` |
| macOS Intel | `CodexPortal_<版本号>_x64.dmg` |
| Windows x64 | `CodexPortal_<版本号>_windows_x64.exe` |

当前仓库版本为 **0.3.6**。生产版本可在“关于”页面检查、下载并安装更新；Windows 更新后替换原 EXE 并重新启动。

## 支持范围

面向 **OpenAI 官方订阅账号**，需安装 Codex CLI 或桌面应用。实时额度、活跃会话与任务恢复需要官方 Codex 支持相应的 app-server 功能。

按原方式启动 Codex TUI 并发起对话即可；可在“Codex 信息”查看 CLI 与桌面内置引擎版本。

## 功能

### 账号与订阅额度

- **多账号管理**：支持 PAT、Refresh Token 与 OAuth 登录，提供备注、编辑、删除、订阅筛选与首次本地账号导入。
- **一键切换**：从界面或系统托盘切换当前账号。
- **实时额度**：展示官方推送的短周期、长周期剩余额度和重置时间，支持手动刷新。
- **自动切换**：总开关默认开启，每个账号可设置 0%–100% 的剩余额度阈值，默认 0%。例如设为 5%，任一窗口剩余 ≤ 5% 时自动切换。
- **优先切换**：在可用账号中选择短周期下一次重置时间最近的账号。
- **账号测试与窗口激活**：查看模型回复、刷新额度，支持自动激活；此类请求会消耗账号额度。
- **重置卡**：支持的 Team 账号可查看重置次数、明细并使用重置卡。

### 配置与扩展

- **可视化配置**：编辑模型、推理强度、审批策略、沙盒模式与功能开关。
- **高级 TOML 编辑**：编辑完整配置，预览保存差异，提示外部修改冲突。
- **MCP 管理**：新增、编辑、启停、删除与复制 MCP 配置，支持 STDIO / SSE。
- **Skill 管理**：浏览本地 Skill，查看说明，从本地目录添加或删除。

### 会话与 Token 用量

- **活跃项目**：展示活跃会话总数，以及最近活跃的最多 3 个项目和各自的会话数量。
- **空闲自动移出**：空闲超过 5 分钟后移出统计，发送新消息后自动恢复。
- **历史会话**：按项目浏览、搜索会话，查看内容与 Token 消耗，复制恢复命令或打开项目目录。
- **用量统计**：按日期查看输入、缓存命中、输出与推理 Token，以及项目、模型分布。
- **金额参考**：提供 API 价格估算，**不代表订阅实际扣费或剩余额度**。

### 实时日志

- 实时查看额度、会话、账号切换等运行日志，支持自动滚动。
- 窗口展示最新 **100 条**，历史日志仍保留在文件中，可直接打开文件位置。

### 应用设置

- 邮箱脱敏、开机自启动默认开启，可在“设置”中调整。
- 系统托盘支持查看、切换账号和后台运行。
- 额度刷新免打扰默认开启，时段为 19:00–次日 09:00，可调整或关闭。
- 支持自动检查更新、下载安装新版本。

## 数据、网络与隐私

- 账号、配置、会话、用量与日志保存在本机，不向项目服务器上传。
- 登录与额度查询访问 OpenAI 服务，应用更新通过 GitHub Releases 获取。
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

也可运行 `./start_dev.sh`。开发约定与发布流程见 [项目 SKILL.md](.codex/skills/codex-portal-release/SKILL.md)。
