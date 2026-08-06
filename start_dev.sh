#!/bin/bash
# 启动 Codex Portal 开发环境

# 获取当前脚本所在目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=================================="
echo "    启动 Codex Portal 开发环境    "
echo "=================================="
echo ""

echo "[1/2] 正在检查并安装前端依赖..."
npm install

echo ""
echo "[2/2] 正在启动 Tauri 开发服务器..."
echo "注意: 首次编译 Rust 代码可能需要几分钟时间，请耐心等待。"
echo ""
npm run tauri dev
