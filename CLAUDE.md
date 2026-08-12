# Codex Portal 项目规则

## 工作方式（强制）

- **不自行启动项目**：不要运行 `npm run tauri dev`、`npm run dev`、`npm start` 或任何启动应用的命令。你只需要完成代码，无需启动项目。
- 验证通过静态检查完成：`cargo test` / `cargo check`（src-tauri 目录）、`npx tsc --noEmit`、`npm run build`。

## 项目级 Skills

- 项目需要的 skills 写在当前项目的 `.claude/skills/` 目录，不要写进全局 `~/.claude/skills/`。

## 技术栈

- Tauri 2 + React 18 + TypeScript + Tailwind CSS 4 + SQLite (rusqlite)。
- 后端命令注册在 `src-tauri/src/lib.rs` 的 `invoke_handler`。
- 前端页面组件位于 `src/components/`，hooks 位于 `src/hooks/`。
- 会话（~/.codex/sessions）按项目入库 SQLite，解析逻辑见 `src-tauri/src/lib.rs` 的 sessions 模块。
