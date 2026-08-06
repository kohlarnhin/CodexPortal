<p align="center">
  <img src="./app-icon.png" width="112" alt="Codex Portal Logo" />
</p>

<h1 align="center">Codex Portal</h1>

<p align="center">
  一个基于 Tauri 的 Codex 桌面管理工具，用于统一管理本机账号认证、核心配置与 MCP 服务器。
</p>

## 功能特性

- **多账号管理**：添加、编辑、删除 Codex 账号，并为账号设置名称、备注与额度类型。
- **快速切换账号**：切换活跃账号时，自动将对应认证内容写入 `~/.codex/auth.json`。
- **配置可视化**：管理模型、沙盒模式、审批策略、推理强度、功能开关和自定义模型服务。
- **TOML 高级编辑**：直接查看并编辑 `~/.codex/config.toml`，保存前会校验 TOML 格式。
- **MCP 管理**：新增、编辑、启用、停用或删除 STDIO / SSE 类型的 MCP 服务器。
- **配置一致性检查**：比较应用数据库中的配置与本机 Codex 配置文件。
- **环境信息**：读取本机 `codex --version`，快速确认 Codex CLI 是否可用。
- **本地原生体验**：使用 React 构建界面、Rust 处理本地数据，通过 Tauri 打包为桌面应用。

> [!NOTE]
> 当前版本的“使用情况与限制”数据为 **Mock Data**，仅用于界面展示，不代表账号的实时额度。

## 界面模块

| 模块 | 说明 |
| --- | --- |
| 当前账号 | 查看当前生效的账号、备注和额度类型 |
| 账号管理 | 管理认证信息，并切换写入本机的活跃账号 |
| 配置管理 | 可视化编辑 Codex 核心配置或直接编辑 TOML |
| MCP 配置 | 管理 STDIO / SSE MCP 服务器及其参数、环境变量 |
| Codex 信息 | 查询本机 Codex CLI 版本 |
| 关于 | 查看应用、Tauri 版本等信息 |

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

当前的 DMG 打包脚本仅适用于 macOS。

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

## 数据与配置

Codex Portal 只在本机处理账号和配置数据，不会主动上传这些内容。

| 数据 | 保存位置 / 行为 |
| --- | --- |
| 账号与配置快照 | Tauri 应用数据目录中的 `database.sqlite` |
| 当前账号认证 | 切换账号时写入 `~/.codex/auth.json` |
| Codex 核心配置 | 读取并写入 `~/.codex/config.toml` |

> [!WARNING]
> 账号认证内容会以明文保存在本机 SQLite 数据库中，切换账号还会覆盖 `~/.codex/auth.json`。请仅在可信设备上使用，操作前备份现有配置，并且不要把真实 Token、`auth.json` 或数据库文件提交到 Git。

## 项目结构

```text
CodexPortal/
├── src/                    # React 前端
│   ├── components/         # 页面与通用组件
│   ├── hooks/              # 账号、配置状态与 Tauri 调用
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

项目当前版本为 `0.1.0`，仍处于早期开发阶段。提交 Issue 或 Pull Request 前，请避免在日志、截图和示例中包含真实认证信息。
