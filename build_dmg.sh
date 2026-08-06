#!/bin/bash
set -e

echo "🚀 开始构建 Codex Portal 生产版本..."
echo "这可能需要几分钟时间，请耐心等待。"

# 1. 运行 tauri build（现在只生成 .app 文件，避开 Tauri 官方有 Bug 的 dmg 生成器）
npm run tauri build

APP_PATH="src-tauri/target/release/bundle/macos/Codex Portal.app"
DMG_PATH="src-tauri/target/release/bundle/macos/CodexPortal_Installer.dmg"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ 打包失败，找不到编译好的 .app 文件: $APP_PATH"
    exit 1
fi

echo "📦 .app 编译成功！正在为你手动打包最终的 DMG 镜像..."
# 清理旧的 DMG
rm -f "$DMG_PATH"

# 创建一个临时的打包目录
STAGING_DIR=$(mktemp -d)
# 把 App 放进去
cp -a "$APP_PATH" "$STAGING_DIR/"
# 创建一个指向系统 Applications 文件夹的快捷方式，方便用户拖拽安装
ln -s /Applications "$STAGING_DIR/Applications"

# 使用 macOS 自带的 hdiutil 命令行工具直接制作 DMG，安全又可靠
hdiutil create -volname "Codex Portal" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH" > /dev/null

# 清理临时目录
rm -rf "$STAGING_DIR"

echo ""
echo "✅ 构建打包成功！"
echo "📦 你的 DMG 安装包最终存放位置为: $DMG_PATH"
echo "你可以直接把这个 .dmg 文件发给别人安装使用啦！"
