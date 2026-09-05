<p align="center">
  <img src="./app-icon.png" width="112" alt="Codex Portal Logo" />
</p>

<h1 align="center">Codex Portal</h1>

<p align="center">
  基于 Tauri 2 的 macOS 桌面管理工具，集中管理 Codex 官方账号、订阅额度、本地配置、会话与 Skill。
</p>

<p align="center">
  <a href="https://github.com/kohlarnhin/CodexPortal/releases/latest">下载最新版本</a> ·
  <a href="https://github.com/kohlarnhin/CodexPortal/issues">反馈问题</a>
</p>

## 下载安装

从 [GitHub Releases](https://github.com/kohlarnhin/CodexPortal/releases/latest) 下载适合本机的 DMG，打开后将 **Codex Portal** 拖入 **Applications**。

| Mac 类型 | 安装包名称 |
| --- | --- |
| Apple Silicon（M 系列芯片） | `CodexPortal_<版本号>_arm64.dmg` |
| Intel | `CodexPortal_<版本号>_x64.dmg` |

已安装的生产版本可在“关于”页面检查、下载并安装更新。当前仓库版本为 **0.2.2**，正式发布流程提供上述两种 macOS 架构的安装包。

## 支持范围

目前面向 **OpenAI 官方订阅账号**，不提供第三方模型服务商、代理 Base URL 或 API Key 接入表单。应用读取本机 Codex 数据；使用 Codex 本身仍需安装相应的 CLI 或桌面应用。

“Codex 信息”分别检测独立安装的 **Codex CLI** 和 **ChatGPT / Codex 桌面应用内置的 Codex 引擎**，未检测到时分别显示“未安装”，也可以手动重新检测。桌面项展示的是内置引擎版本。

## 功能

### 账号与订阅额度

- **多账号管理**：通过 Personal Access Token（PAT）、Refresh Token 或 OAuth 登录添加账号；识别邮箱与订阅类型，支持备注、编辑、删除和按订阅筛选。
- **本地账号切换**：具备 PAT 的账号可设为当前账号，并将认证写入 `~/.codex/auth.json`。仅通过 Refresh Token / OAuth 添加、尚未补充 PAT 的账号可管理额度，但不能切换本地认证。
- **首次自动导入**：账号库为空时尝试从 `~/.codex/auth.json` 导入 PAT 或 Refresh Token 账号。
- **额度概览**：展示服务端返回的短周期、长周期剩余百分比与重置时间，支持手动刷新；不再根据 Token 消耗反推订阅窗口总额。
- **会话感知同步**：后台每 5 分钟增量同步本地会话，利用其中的 `rate_limits` 更新账号额度；按活跃时段归属账号，并防止旧快照覆盖较新的额度。
- **重置后刷新**：应用启动时补刷到期账号；短周期重置后等待 1 分钟主动刷新，即使额度尚未用完也会触发。失败后每 5 分钟重试，最多额外重试 3 次。
- **账号测试**：发送实际模型请求，流式展示回复并更新额度；测试会消耗该账号的可用额度。
- **重置卡**：为支持该功能的 Team 账号配置 Access Token 后，查看可用重置次数与明细，并请求使用重置卡；是否可用以服务端返回为准。

### 配置与扩展

- **可视化配置**：编辑模型、推理强度、审批策略、沙盒模式与功能开关，直接读写 `~/.codex/config.toml`。
- **高级 TOML 编辑**：查看并编辑完整原文，保存前校验格式、预览差异；原文保存保留注释与排版。可视化保存会重新序列化配置，可能调整格式和注释。
- **外部修改保护**：配置页读取本地文件变化；保存时合并未冲突的可视化修改，检测到冲突则提示重新载入，避免覆盖其他程序刚保存的内容。
- **MCP 管理**：新增、编辑、启用、停用或删除 STDIO / SSE 配置，管理命令、参数、环境变量与 URL；与配置页共用同一份 `config.toml`。
- **Skill 管理**：浏览 `~/.agents/skills`，以 Markdown 查看 `SKILL.md`，从本地目录添加或删除 Skill，支持软链接。

### 会话与 Token 用量

- **项目会话浏览**：同步 `~/.codex/sessions` 历史会话，按项目浏览与搜索，查看标题、模型、消息、完整内容及 Token 消耗。
- **继续工作**：复制会话恢复命令，或在 Finder 中定位项目目录。
- **用量统计**：按日期范围查看输入、缓存命中、输出与推理 Token，按项目和模型汇总，并展示缓存命中率。
- **金额参考**：根据内置模型价格表，按 API 标准短上下文的输入、缓存输入和输出单价估算。推理 Token 已包含在输出中，不重复计费；未知价格模型不计入总额。

金额估算仅用于参考，**不代表官方订阅的实际扣费，也不能换算为剩余订阅额度**；目前未计入长上下文、Fast 模式与缓存写入溢价。

### 应用设置

- 邮箱脱敏默认开启，可在“设置”中调整。
- 开机自启动默认开启，可在“设置”中关闭。
- 生产版本启动及每小时检查更新；关闭某版本的更新提醒后，不再重复弹出该版本提示。

## 界面导航

| 页面 | 用途 |
| --- | --- |
| 当前账号 | 当前认证账号、订阅类型、剩余额度、重置时间与手动刷新 |
| 账号管理 | 添加、编辑、筛选、切换账号，测试请求与管理重置卡 |
| 配置管理 | 可视化配置、高级 TOML 编辑与保存差异预览 |
| 会话管理 | 按项目查找会话、查看内容、复制恢复命令 |
| Token 用量 | 日期范围统计、项目与模型分布、金额参考 |
| MCP 配置 | 管理本地命令与远程地址形式的 MCP 配置 |
| Skill 管理 | 本地 Skill 列表、详情、添加与删除 |
| Codex 信息 | 独立 CLI 与桌面内置引擎版本检测 |
| 设置 / 关于 | 应用偏好、版本信息与更新安装 |

## 数据、网络与隐私

账号库、会话与应用状态保存在本机。Codex Portal 不向项目服务器上传完整账号库、配置或会话内容。

| 数据 | 保存位置或访问行为 |
| --- | --- |
| 账号认证、额度缓存、活跃时段、会话与 Token 统计、更新记录 | Tauri 应用数据目录中的 `database.sqlite`；macOS 默认位于 `~/Library/Application Support/com.codex.portal/` |
| 当前账号认证 | 切换 PAT 账号时写入 `~/.codex/auth.json` |
| Codex 与 MCP 配置 | 直接读写 `~/.codex/config.toml`，不再维护数据库配置副本；支持已有配置文件软链接 |
| 会话源文件 | 读取 `~/.codex/sessions`，完整会话内容会同步到本机数据库 |
| Skill 文件 | `~/.agents/skills` |
| 邮箱脱敏、自启动等界面偏好 | 应用本地存储，与 Codex 配置分开保存 |
| 登录、令牌续期、额度查询、账号测试与重置卡 | 使用相应账号凭据访问 OpenAI 服务 |
| 应用更新 | 访问 GitHub Releases，下载安装包与更新资源 |

账号认证内容以明文保存在本地数据库，邮箱脱敏只影响界面显示。切换账号会覆盖本地 `auth.json`；请妥善保管设备与备份，不要在 Issue、日志、截图或 Git 提交中包含真实 Token、认证文件或数据库。

从旧版本升级时，会清理已停用的窗口消费统计表与数据库中的 Codex / MCP 配置副本；账号、额度缓存、会话用量以及本地 `config.toml` 继续保留。

## 本地开发

技术栈：**Tauri 2、Rust、SQLite（rusqlite）、React 18、TypeScript、Vite 6、Tailwind CSS 4、smol-toml**。

准备 Node.js 24（与发布工作流一致）、npm、Rust stable，以及 [Tauri 2 所需的系统依赖](https://v2.tauri.app/start/prerequisites/)。当前正式发布和 DMG 脚本面向 macOS。

```bash
git clone https://github.com/kohlarnhin/CodexPortal.git
cd CodexPortal
npm ci
npm run tauri dev
```

也可以运行 `./start_dev.sh`，脚本会执行 `npm install` 后启动 Tauri 开发环境。`npm run dev` 仅启动前端，完整功能依赖 Tauri 本地命令。

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端开发服务器 |
| `npm run tauri dev` | 启动完整桌面开发环境 |
| `npm run build` | TypeScript 检查并构建前端 |
| `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --locked` | 检查 Rust 所有目标 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 运行 Rust 测试 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 检查 Rust 格式 |
| `npm run tauri build` | 构建桌面应用与更新资源 |
| `./build_dmg.sh` | 在 macOS 上构建应用并生成 DMG |

本地 DMG 脚本的产物位于 `src-tauri/target/release/bundle/macos/CodexPortal_Installer.dmg`。

## 项目结构

```text
CodexPortal/
├── src/
│   ├── components/              # 页面与通用组件
│   ├── hooks/                   # 状态、配置、更新与 Tauri 调用
│   ├── types/                   # TypeScript 类型
│   └── utils/                   # 配置合并、额度格式化与模型价格表
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs               # 应用启动、共享状态初始化与命令注册
│   │   ├── accounts/            # 账号、额度、重置卡与刷新调度
│   │   ├── auth/                # PAT、Refresh Token 与 OAuth
│   │   ├── sessions/            # 会话解析、同步与用量统计
│   │   ├── codex/               # 配置文件与 CLI / 桌面版本检测
│   │   ├── db.rs                # 数据库初始化与迁移
│   │   ├── state.rs             # 共享运行状态
│   │   ├── http.rs              # 公共 HTTP 客户端
│   │   ├── time.rs              # 时间工具
│   │   ├── skills.rs            # Skill 文件管理
│   │   └── updates.rs           # 更新记录
│   ├── capabilities/           # Tauri 权限
│   └── tauri.conf.json          # 应用与更新配置
├── .github/workflows/release.yml
├── .codex/skills/codex-portal-release/SKILL.md
├── build_dmg.sh
└── start_dev.sh
```

Rust 按业务模块组织，测试放在所属模块中。开发约定与发布流程见 [项目 SKILL.md](.codex/skills/codex-portal-release/SKILL.md)。

## 发布流程

1. 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 与 `src-tauri/tauri.conf.json` 的应用版本。
2. 完成检查，将目标改动提交并推送到 `main`。
3. 在 GitHub Actions 手动运行 **Release Codex Portal**，选择 `main` 并填写发布说明。
4. 工作流构建 Apple Silicon / Intel 应用、签名自动更新资源、上传 DMG，并在两个架构均成功后发布 GitHub Release。

版本标签与 Release 由工作流创建，无需手动创建同名标签或 Release。
