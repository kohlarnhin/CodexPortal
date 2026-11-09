#!/bin/bash
# 构建本机自用的正式包，替换 /Applications 中的安装版本并重新打开。
# 不生成 updater 产物，不需要发布私钥，也不上传任何东西。
# 本地验收期间保持版本号等于线上最新版本；发布前不要用本脚本安装 +1 后的版本，
# 否则本地和发布版本相同，updater 不会提示更新。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APP_NAME="Codex Portal"
BUNDLE_ID="com.codex.portal"
SRC="$ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"
STAGE="/Applications/.$APP_NAME.app.new"
BACKUP="/Applications/.$APP_NAME.app.old"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install:local 仅支持 macOS。" >&2
  exit 1
fi

echo "[1/4] 构建本地 .app（不生成 updater 产物）..."
npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'

if [[ ! -d "$SRC" ]]; then
  echo "构建失败：找不到 $SRC" >&2
  exit 1
fi

BUILT_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$SRC/Contents/Info.plist")"
if [[ "$BUILT_ID" != "$BUNDLE_ID" ]]; then
  echo "构建产物 identifier 异常：$BUILT_ID" >&2
  exit 1
fi

echo "[2/4] 退出正在运行的 $APP_NAME..."
APP_PATTERN="^$DEST/Contents/MacOS/codex-portal$"
if pgrep -f "$APP_PATTERN" >/dev/null 2>&1; then
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    pgrep -f "$APP_PATTERN" >/dev/null 2>&1 || break
    sleep 0.25
  done
  if pgrep -f "$APP_PATTERN" >/dev/null 2>&1; then
    pkill -TERM -f "$APP_PATTERN" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      pgrep -f "$APP_PATTERN" >/dev/null 2>&1 || break
      sleep 0.25
    done
  fi
  if pgrep -f "$APP_PATTERN" >/dev/null 2>&1; then
    echo "应用未退出，停止替换。" >&2
    exit 1
  fi
fi

restore_backup() {
  if [[ ! -d "$DEST" && -d "$BACKUP" ]]; then
    mv "$BACKUP" "$DEST"
  fi
}
trap restore_backup EXIT

echo "[3/4] 替换 $DEST..."
rm -rf "$STAGE" "$BACKUP"
ditto "$SRC" "$STAGE"
if [[ -d "$DEST" ]]; then
  mv "$DEST" "$BACKUP"
fi
mv "$STAGE" "$DEST"

echo "[4/4] 重新打开..."
if ! open "$DEST"; then
  echo "启动失败，正在回滚..." >&2
  exit 1
fi

sleep 2
if ! pgrep -f "$APP_PATTERN" >/dev/null 2>&1; then
  echo "应用启动后未检测到进程，正在回滚..." >&2
  rm -rf "$DEST"
  exit 1
fi

trap - EXIT
rm -rf "$BACKUP"

REV="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ -n "$(git status --porcelain)" ]]; then
  REV="$REV-dirty"
fi

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo unknown)"
echo "完成：已安装 $VERSION ($REV) 到 $DEST"
PLIST="$HOME/Library/LaunchAgents/$APP_NAME.plist"
if [[ -f "$PLIST" ]]; then
  TARGET="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$PLIST" 2>/dev/null || true)"
  echo "开机自启动目标：$TARGET"
fi
