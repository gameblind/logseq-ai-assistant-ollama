#!/bin/bash

# 开发环境设置脚本

set -e

echo "🛠️  设置 Logseq AI Assistant 开发环境..."

# 安装插件依赖
echo "📦 安装 Logseq 插件依赖..."
cd packages/logseq-plugin
npm install
echo "✅ Logseq 插件依赖安装完成"

# 安装桥接服务依赖
echo "🌉 安装 MCP 桥接服务依赖..."
cd ../mcp-bridge-service
npm install
echo "✅ MCP 桥接服务依赖安装完成"

cd ../..
echo "🎉 开发环境设置完成！"

echo ""
echo "🚀 开发命令:"
echo "  插件开发:"
echo "    cd packages/logseq-plugin"
echo "    npm run dev    # 启动开发服务器"
echo ""
echo "  桥接服务开发:"
echo "    cd packages/mcp-bridge-service"
echo "    npm run dev    # 启动开发服务器"
echo "    npm start      # 启动生产服务"
echo ""
echo "  全项目构建:"
echo "    ./scripts/build-all.sh"