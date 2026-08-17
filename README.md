<p align="center">
  <img src="./app-icon.png" width="112" alt="Codex Portal Logo" />
</p>

<h1 align="center">Codex Portal</h1>

<p align="center">
  一个基于 Tauri 2 的 Codex 桌面管理工具，用于统一管理本机账号认证、实时额度、核心配置与 MCP 服务器。
</p>

## 功能特性

- **多账号管理**：支持 **Personal Access Token、Refresh Token、OAuth 登录**三种方式添加账号；邮箱与订阅类型（Team / Plus / Pro / Free）自动解析并作为账号铭牌展示。
- **额度测试**：账号卡片一键调用 Codex 模型接口，流式展示回复，测试即消耗该账号额度并自动刷新。
- **重置卡**：Team 账号配置 Access Token 后查看银行式重置额度（可用重置次数与明细），可选中可用重置卡一键请求重置，成功后自动刷新额度。
- **智能更新检查**：启动与每小时自动检查更新；检测到新版本自动记录并跳转"关于"页提醒，关闭弹窗后不再重复打扰，仅发布更新版本时再次提醒。
- **Skill 管理**：管理 `~/.agents/skills` 下的 Skill（列表 / 详情查看 / 本地目录添加 / 删除，支持软链接），详情以 Markdown 渲染 SKILL.md。
- **账号窗口额度**：记录账号活跃时段与切换时间，会话 Token 按账号归属；当前账号实时展示进行中窗口（消耗、剩余额度、窗口总额推算），切换时保存窗口额度快照（含推算的窗口总额）；额度重置自动开启新窗口。
- **会话感知额度**：同步时读取 Codex 每次请求顺带返回的额度（session rate_limits）更新账号剩余额度，无需额外请求；1 小时自动刷新调度不受影响。
- **Codex 桌面应用识别**：兼容仅安装 ChatGPT / Codex 桌面应用（捆绑 CLI）与 standalone 安装（`~/.codex/bin`）的用户。
- **订阅筛选**：账号列表按订阅类型筛选，并显示各类型数量。
- **快速切换账号**：切换活跃账号时自动将认证内容写入 `~/.codex/auth.json`；使用中的账号始终排在列表首位。
- **实时额度同步**：可刷新账号读取最新额度，在当前账号与账号列表展示，并缓存到 SQLite。
- **智能自动刷新**：后端按账号独立调度——额度未用完则 1 小时后刷新，额度用尽则在短周期额度重置时间后 1 分钟刷新；重启后沿用已保存计划，仅对到期账号逐个（间隔 1 分钟）刷新。展示每个账号的下次刷新时间。
- **邮箱隐私保护**：全局邮箱脱敏默认开启，作用于当前账号与账号管理列表。
- **开机自启动**：默认开启，可在“设置”页随时关闭。
- **配置管理**：可视化编辑模型、沙盒模式、审批策略、推理强度、功能开关与自定义模型服务，并支持 TOML 高级编辑与一致性检查。
- **会话管理**：将 `~/.codex/sessions` 全部历史会话按项目入库 SQLite（含完整内容），按项目卡片浏览会话列表，展示标题、消息数、模型、Token 消耗，支持复制恢复命令与 Finder 定位。
- **Token 用量**：同步时自动拆解每个会话的 Token 消耗并按天入库，支持查看当天及任意历史日期的用量，按项目、按模型分布展示；内置 GPT-5.5 / GPT-5.6（Sol/Terra/Luna）官方价格，实时估算消耗金额（区分输入/缓存/输出计费），输入卡片展示缓存命中量与缓存率。
- **自动导入账号**：账号库为空时自动读取 `~/.codex/auth.json`（PAT / Refresh Token 格式）并走与手动添加一致的流程入库，开箱即用。
- **MCP 管理**：新增、编辑、启用、停用或删除 STDIO / SSE 类型 MCP 服务器，并管理参数与环境变量。
- **应用内更新**：生产版本启动后自动检查更新，也可在“关于”页面手动检查、下载、安装并重启应用。
- **环境信息**：展示应用启动时检测并保存的 Codex CLI 版本。
- **本地原生体验**：React 界面 + Rust 本地数据，通过 Tauri 打包为桌面应用。

## 界面模块

| 模块 | 说明 |
| --- | --- |
| 当前账号 | 查看当前生效的账号、备注、额度、订阅铭牌与下次刷新时间，并支持立即刷新 |
| 账号管理 | 通过 PAT / Refresh Token / OAuth 添加账号，编辑、删除、切换，按订阅筛选，展示额度、重置次数与下次刷新时间 |
| 配置管理 | 可视化编辑 Codex 核心配置或直接编辑 TOML |
| 会话管理 | 按项目浏览 `~/.codex/sessions` 历史会话，查看标题、模型与 Token 消耗，查看完整会话内容 |
| Token 用量 | 查看当天与任意历史日期的 Token 用量，按项目、按模型分布 |
| MCP 配置 | 管理 STDIO / SSE MCP 服务器及其参数、环境变量 |
| Skill 管理 | 管理 `~/.agents/skills`：列表、详情查看、本地目录添加、删除 |
| Codex 信息 | 查看应用启动时检测并保存的 Codex CLI 版本 |
| 设置 | 本程序应用级设置：邮箱脱敏、开机自启动 |
| 关于 | 查看应用与 Tauri 版本，检查并安装应用更新 |

## 下载安装

当前稳定版本为 `0.2.0`，可从 [GitHub Releases](https://github.com/kohlarnhin/CodexPortal/releases/tag/v0.2.0) 下载 macOS 安装包：

| Mac 类型 | 安装包 |
| --- | --- |
| Apple Silicon（M 系列芯片） | [CodexPortal_0.2.0_arm64.dmg](https://github.com/kohlarnhin/CodexPortal/releases/download/v0.2.0/CodexPortal_0.2.0_arm64.dmg) |
| Intel | [CodexPortal_0.2.0_x64.dmg](https://github.com/kohlarnhin/CodexPortal/releases/download/v0.2.0/CodexPortal_0.2.0_x64.dmg) |

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端 | React 18、TypeScript、Vite 6 |
| 样式 | Tailwind CSS 4 |
| 本地后端 | Rust |
| 数据存储 | SQLite（rusqlite） |
| 配置解析 | TOML（smol-toml） |

## 开发环境

开始前请安装：

- Node.js 18 或更高版本
- npm
- Rust stable 工具链
- [Tauri 2 所需的系统依赖](https://v2.tauri.app/start/prerequisites/)
- Codex CLI（推荐；“Codex 信息”和实际配置使用依赖系统中的 `codex` 命令）

当前的正式发布流程和 DMG 打包脚本仅适用于 macOS。

## 快速开始

```bash
git clone https://github.com/kohlarnhin/CodexPortal.git
cd CodexPortal
npm install
npm run tauri dev
```

macOS 也可以使用项目脚本完成依赖安装并启动开发环境：

```bash
./start_dev.sh
```

> [!TIP]
> `npm run dev` 只启动前端页面。完整功能依赖 Tauri 的本地命令，请使用 `npm run tauri dev`。

## 构建与打包

构建桌面应用：

```bash
npm run tauri build
```

在 macOS 上生成 DMG 安装包：

```bash
./build_dmg.sh
```

生成结果位于：

```text
src-tauri/target/release/bundle/macos/CodexPortal_Installer.dmg
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 仅启动 Vite 前端开发服务器 |
| `npm run tauri dev` | 启动完整的 Tauri 开发环境 |
| `npm run build` | 执行 TypeScript 检查并构建前端资源 |
| `npm run tauri build` | 构建桌面应用 |
| `npm run preview` | 预览已经构建的前端资源 |
| `./start_dev.sh` | 安装前端依赖并启动 Tauri 开发环境 |
| `./build_dmg.sh` | 在 macOS 上构建 `.app` 和 DMG |

## 数据、网络与隐私

Codex Portal 在本机保存账号与配置数据，不会把完整账号库或 Codex 配置上传到项目服务器。实时额度和应用更新会按以下方式访问网络：

| 数据 | 保存位置 / 行为 |
| --- | --- |
| 账号认证、配置快照与额度缓存 | Tauri 应用数据目录中的 `database.sqlite` |
| 会话数据 | 同步 `~/.codex/sessions` 的历史会话（含完整内容与 Token 统计）到本机 SQLite，按项目入库，仅本机存储 |
| 当前账号认证 | 切换账号时写入 `~/.codex/auth.json` |
| Codex 核心配置 | 读取并写入 `~/.codex/config.toml` |
| 邮箱脱敏偏好 | 保存在应用本地存储中，首次使用默认开启 |
| 额度同步 | 自动或手动刷新时，使用对应账号 Token 通过 HTTPS 请求 OpenAI 认证与额度服务，结果写回本机 SQLite |
| 应用更新 | 生产版本启动后查询 GitHub Releases，也可在“关于”页面手动检查 |

> [!WARNING]
> 账号认证内容会以明文保存在本机 SQLite 数据库中，切换账号还会覆盖 `~/.codex/auth.json`。请仅在可信设备上使用，操作前备份现有配置，并且不要把真实 Token、`auth.json` 或数据库文件提交到 Git。

## 项目结构

```text
CodexPortal/
├── src/                    # React 前端
│   ├── components/         # 页面与通用组件
│   ├── hooks/              # 账号、额度调度、更新、配置状态与 Tauri 调用
│   └── types/              # TypeScript 类型
├── src-tauri/
│   ├── src/                # Rust 命令、本地文件与 SQLite 逻辑
│   ├── capabilities/       # Tauri 权限配置
│   ├── icons/              # 各平台应用图标
│   └── tauri.conf.json     # Tauri 应用配置
├── build_dmg.sh            # macOS DMG 打包脚本
├── start_dev.sh            # 开发环境启动脚本
└── package.json            # 前端依赖与命令
```

## 当前状态

项目当前版本为 `0.2.0`。支持 Personal Access Token、Refresh Token、OAuth 三种账号接入方式，提供实时额度、智能自动刷新、额度测试、重置卡（含一键请求重置）、订阅筛选与账号自动导入（auth.json）等功能；会话管理（按项目浏览 `~/.codex/sessions` 历史会话）与 Token 用量统计（当天与历史日期、按项目/模型分布、内置模型价格估算金额）；Skill 管理（`~/.agents/skills` 列表/详情/添加/删除）；账号窗口额度（活跃时段记录、Token 按账号归属、窗口总额推算、额度重置自动开新窗口）与会话感知额度（随 Codex 请求顺带更新，无需额外请求）；智能更新检查（启动/每小时，入库记录避免重复打扰）。

提交 Issue 或 Pull Request 前，请避免在日志、截图和示例中包含真实认证信息。
