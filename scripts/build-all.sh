#!/bin/bash

# 构建所有包的脚本

set -e

echo "🚀 开始构建 Logseq AI Assistant 项目..."

# 构建插件
echo "📦 构建 Logseq 插件..."
cd packages/logseq-plugin
npm install
npm run build
echo "✅ Logseq 插件构建完成"

# 构建桥接服务
echo "🌉 构建 MCP 桥接服务..."
cd ../mcp-bridge-service
npm install
npm run build
echo "✅ MCP 桥接服务构建完成"

cd ../..
echo "🎉 所有包构建完成！"

echo ""
echo "📋 构建结果:"
echo "  - Logseq 插件: packages/logseq-plugin/dist/"
echo "  - MCP 桥接服务: packages/mcp-bridge-service/dist/"
echo ""
echo "🚀 使用方法:"
echo "  1. 安装 Logseq 插件: 将 packages/logseq-plugin/dist/ 目录作为插件安装到 Logseq"
echo "  2. 启动桥接服务: cd packages/mcp-bridge-service && npm start"