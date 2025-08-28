# Logseq AI Assistant with MCP Integration

一个集成了 Model Context Protocol (MCP) 的 Logseq AI 助手项目，采用前后端分离架构。

## 项目架构

本项目采用 **前后端分离** 的架构设计：

- **前端**: Logseq 插件 (`packages/logseq-plugin/`)
- **后端**: MCP 桥接服务 (`packages/mcp-bridge-service/`)

```
┌─────────────────┐    HTTP API    ┌──────────────────┐    MCP Protocol    ┌─────────────────┐
│   Logseq 插件   │ ──────────────► │   MCP 桥接服务   │ ─────────────────► │   MCP 服务器    │
│   (前端)        │                │   (后端)         │                    │   (AI工具)      │
└─────────────────┘                └──────────────────┘                    └─────────────────┘
```

## 快速开始

### 1. 环境设置

```bash
# 设置开发环境（安装所有依赖）
./scripts/dev-setup.sh
```

### 2. 开发模式

**启动桥接服务（后端）:**
```bash
cd packages/mcp-bridge-service
npm run dev    # 开发模式
# 或
npm start      # 生产模式
```

**开发插件（前端）:**
```bash
cd packages/logseq-plugin
npm run dev    # 启动开发服务器
```

### 3. 构建发布

```bash
# 构建所有包
./scripts/build-all.sh
```

## 项目结构

```
logseq-ai-assistant-ollama/
├── packages/
│   ├── logseq-plugin/           # Logseq 插件（前端）
│   │   ├── src/                 # 插件源代码
│   │   ├── libs/                # 插件库文件
│   │   ├── assets/              # 静态资源
│   │   ├── package.json         # 插件依赖
│   │   └── dist/                # 构建输出
│   └── mcp-bridge-service/      # MCP 桥接服务（后端）
│       ├── src/                 # 服务源代码
│       ├── public/              # 配置管理界面
│       ├── config.json          # 服务配置
│       ├── package.json         # 服务依赖
│       └── dist/                # 构建输出
├── docs/                        # 项目文档
├── scripts/                     # 构建和部署脚本
├── archive/                     # 归档文件
└── .github/                     # GitHub 配置
```

## 功能特性

### Logseq 插件（前端）
- 🎯 AI 助手对话界面
- 🔧 智能工具调用
- 📝 笔记增强功能
- 🎨 现代化 UI 设计
- 🎬 **视频生成功能**
  - 📝 **文生视频 (T2V)**: 通过文本描述生成视频
  - 🖼️ **图生视频 (I2V)**: 基于图片生成动态视频
  - 💾 自动保存到 Logseq assets 目录
  - ⏱️ 智能任务状态轮询

### MCP 桥接服务（后端）
- 🌉 MCP 协议桥接
- 🔌 多种连接方式（StdIO、SSE、WebSocket）
- ⚙️ 可视化配置管理
- 📊 实时状态监控
- 🛡️ 安全性和错误处理
- 🎬 **视频生成 API 支持**
  - 🔗 通义千问视频生成 API 集成
  - 📊 任务状态管理和轮询
  - 📁 视频文件下载和存储

## 开发指南

### 插件开发
详见：[packages/logseq-plugin/README.md](packages/logseq-plugin/README.md)

### 桥接服务开发
详见：[packages/mcp-bridge-service/README.md](packages/mcp-bridge-service/README.md)

### MCP 架构文档
详见：[docs/MCP_ARCHITECTURE.md](docs/MCP_ARCHITECTURE.md)

### 视频生成功能指南
详见：[docs/VIDEO_GENERATION_GUIDE.md](docs/VIDEO_GENERATION_GUIDE.md)

## 部署

### 插件部署
1. 构建插件：`cd packages/logseq-plugin && npm run build`
2. 将 `dist/` 目录作为插件安装到 Logseq

### 桥接服务部署
1. 构建服务：`cd packages/mcp-bridge-service && npm run build`
2. 启动服务：`npm start`
3. 访问配置界面：http://localhost:3000/ui

## 🔄 配置迁移

**重要提醒**: 由于项目结构重构，如果您之前使用过此插件，需要重新加载插件并迁移配置。

### 插件目录变化
- **之前**: `logseq-ai-assistant-ollama/`
- **现在**: `logseq-ai-assistant-ollama/packages/logseq-plugin/`

### 迁移步骤
1. **备份配置**: 详见 [配置迁移指南](PLUGIN_CONFIG_MIGRATION.md)
2. **移除旧插件**: 在 Logseq 设置中移除旧版本
3. **加载新插件**: 选择 `packages/logseq-plugin/` 目录
4. **恢复配置**: 重新填入之前的设置

### 自动化工具
我们提供了配置备份脚本来简化迁移过程：
- 📋 **详细指南**: [PLUGIN_CONFIG_MIGRATION.md](PLUGIN_CONFIG_MIGRATION.md)
- 🛠️ **备份脚本**: [scripts/backup-plugin-config.js](scripts/backup-plugin-config.js)

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)