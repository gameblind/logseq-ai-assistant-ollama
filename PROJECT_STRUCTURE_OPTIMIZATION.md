# 项目结构优化方案

## 当前问题分析

当前项目结构存在以下问题：
1. **混合架构**：Logseq插件和MCP桥接服务都在同一个根目录下
2. **依赖冲突**：两个项目使用不同的TypeScript版本和构建工具
3. **职责不清**：前端插件和后端服务的边界模糊
4. **部署复杂**：无法独立部署和版本管理

## 优化后的目录结构

```
logseq-ai-assistant-ollama/
├── README.md                    # 项目总体说明
├── .gitignore                   # 全局Git忽略规则
├── LICENSE                      # 许可证
├── CHANGELOG.md                 # 变更日志
├── MCP_ARCHITECTURE.md          # MCP架构文档
├── docs/                        # 项目文档
│   ├── plugin-development.md    # 插件开发指南
│   ├── bridge-service.md        # 桥接服务文档
│   └── deployment.md            # 部署指南
├── packages/                    # 包管理目录
│   ├── logseq-plugin/           # Logseq插件（前端）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── libs/
│   │   │   ├── prompt/
│   │   │   ├── select/
│   │   │   └── slash.ts
│   │   ├── libs/
│   │   │   ├── lang/
│   │   │   └── openai.ts
│   │   ├── assets/
│   │   └── dist/                # 构建输出
│   └── mcp-bridge-service/      # MCP桥接服务（后端）
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md
│       ├── config.example.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── server.ts
│       │   ├── api/
│       │   ├── config/
│       │   ├── mcp/
│       │   └── utils/
│       ├── public/              # 配置管理界面
│       ├── logs/
│       ├── config.json
│       └── dist/                # 构建输出
├── scripts/                     # 构建和部署脚本
│   ├── build-all.sh            # 构建所有包
│   ├── dev-setup.sh             # 开发环境设置
│   └── release.sh               # 发布脚本
├── archive/                     # 归档文件
└── .github/                     # GitHub配置
```

## 优化优势

### 1. 清晰的前后端分离
- **packages/logseq-plugin/**: 专注于Logseq插件开发，包含UI组件、插件逻辑
- **packages/mcp-bridge-service/**: 专注于MCP服务桥接，包含API服务、配置管理

### 2. 独立的依赖管理
- 每个包有自己的`package.json`，避免依赖冲突
- 插件使用Vite + React生态
- 桥接服务使用Node.js + Express生态

### 3. 独立的构建和部署
- 插件可以独立构建为Logseq插件包
- 桥接服务可以独立部署为后端服务
- 支持不同的版本发布策略

### 4. 更好的开发体验
- 清晰的项目边界
- 独立的开发服务器
- 更好的IDE支持

## 迁移步骤

1. **创建新的目录结构**
2. **移动插件相关文件到packages/logseq-plugin/**
3. **移动桥接服务文件到packages/mcp-bridge-service/**
4. **更新配置文件**
5. **创建构建脚本**
6. **测试新结构**

## 配置文件调整

### 插件配置
- 保持现有的Vite + React配置
- 调整路径引用
- 更新构建输出路径

### 桥接服务配置
- 保持现有的Node.js + TypeScript配置
- 调整API端点配置
- 更新日志和配置文件路径

## 开发工作流

### 插件开发
```bash
cd packages/logseq-plugin
npm run dev    # 启动开发服务器
npm run build  # 构建插件
```

### 桥接服务开发
```bash
cd packages/mcp-bridge-service
npm run dev    # 启动开发服务器
npm run build  # 构建服务
npm start      # 启动生产服务
```

### 全项目构建
```bash
./scripts/build-all.sh  # 构建所有包
```