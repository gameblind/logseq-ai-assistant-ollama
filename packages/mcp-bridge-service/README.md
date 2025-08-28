# Logseq MCP Bridge Service

这是一个桥接服务，用于连接 Logseq 插件与 MCP (Model Context Protocol) 服务器，绕过 Logseq 插件沙盒环境的限制。

## 架构概述

```
┌─────────────────┐    HTTP/REST    ┌─────────────────┐    MCP Protocol    ┌─────────────────┐
│   Logseq 插件   │ ──────────────► │   桥接服务      │ ──────────────────► │   MCP 服务器    │
│   (沙盒环境)    │                 │  (本地服务)     │                    │   (外部服务)    │
└─────────────────┘                 └─────────────────┘                    └─────────────────┘
```

## 功能特性

- **绕过沙盒限制**: 通过本地桥接服务，Logseq 插件可以间接访问 MCP 服务
- **配置驱动**: 通过 JSON 配置文件管理 MCP 服务，无需编写代码
- **多协议支持**: 支持 stdio、SSE、WebSocket 等多种 MCP 连接方式
- **RESTful API**: 提供标准的 HTTP API 供 Logseq 插件调用
- **实时管理**: 支持动态添加、删除、配置 MCP 服务
- **错误处理**: 完善的错误处理和日志记录
- **安全性**: CORS 配置确保只有授权的来源可以访问

## 快速开始

### 1. 安装依赖

```bash
cd mcp-bridge-service
npm install
```

### 2. 配置服务

复制示例配置文件：

```bash
cp config.example.json config.json
```

编辑 `config.json` 文件，配置你的 MCP 服务：

```json
{
  "server": {
    "port": 3001,
    "host": "localhost",
    "logLevel": "info"
  },
  "services": [
    {
      "id": "my-search-service",
      "name": "搜索服务",
      "description": "提供搜索功能的 MCP 服务",
      "type": "stdio",
      "enabled": true,
      "command": "node",
      "args": ["path/to/your/mcp-server.js"],
      "tools": [
        {
          "name": "search",
          "description": "搜索功能",
          "logseqCommand": "/search"
        }
      ]
    }
  ]
}
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start

# 使用自定义配置文件
npm start -- /path/to/your/config.json
```

### 4. 验证服务

访问健康检查端点：

```bash
curl http://localhost:3001/api/health
```

## API 文档

### 服务管理

#### 获取所有服务状态
```http
GET /api/services
```

#### 获取特定服务详情
```http
GET /api/services/{serviceId}
```

#### 连接服务
```http
POST /api/services/{serviceId}/connect
```

#### 断开服务
```http
POST /api/services/{serviceId}/disconnect
```

### 工具调用

#### 获取所有可用工具
```http
GET /api/tools
```

#### 调用工具
```http
POST /api/tools/{serviceId}/{toolName}
Content-Type: application/json

{
  "arguments": {
    "query": "搜索内容",
    "limit": 10
  }
}
```

### 资源访问

#### 读取资源
```http
GET /api/resources/{serviceId}/{resourceUri}
```

### 配置管理

#### 获取配置
```http
GET /api/config
```

#### 更新配置
```http
PUT /api/config
Content-Type: application/json

{
  "server": {
    "logLevel": "debug"
  }
}
```

#### 添加服务
```http
POST /api/config/services
Content-Type: application/json

{
  "id": "new-service",
  "name": "新服务",
  "type": "stdio",
  "enabled": true,
  "command": "node",
  "args": ["server.js"]
}
```

## 配置说明

### 服务器配置

```json
{
  "server": {
    "port": 3001,           // 服务端口
    "host": "localhost",    // 绑定地址
    "logLevel": "info",     // 日志级别: error, warn, info, debug
    "cors": {
      "origin": ["http://localhost:3000"],  // 允许的来源
      "credentials": true
    }
  }
}
```

### MCP 服务配置

#### stdio 类型服务
```json
{
  "id": "my-service",
  "name": "我的服务",
  "description": "服务描述",
  "type": "stdio",
  "enabled": true,
  "command": "node",
  "args": ["server.js"],
  "env": {
    "API_KEY": "your-key"
  }
}
```

#### SSE 类型服务
```json
{
  "id": "sse-service",
  "name": "SSE 服务",
  "type": "sse",
  "enabled": true,
  "url": "http://localhost:3002/mcp",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

#### WebSocket 类型服务
```json
{
  "id": "ws-service",
  "name": "WebSocket 服务",
  "type": "websocket",
  "enabled": true,
  "url": "ws://localhost:3003/mcp"
}
```

### 工具配置

```json
{
  "tools": [
    {
      "name": "search",
      "description": "搜索功能",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "搜索查询"
          }
        },
        "required": ["query"]
      },
      "logseqCommand": "/search"  // 对应的 Logseq 命令
    }
  ]
}
```

## 开发指南

### 项目结构

```
mcp-bridge-service/
├── src/
│   ├── api/           # API 路由
│   ├── config/        # 配置管理
│   ├── mcp/          # MCP 客户端管理
│   ├── utils/        # 工具函数
│   ├── server.ts     # 主服务器
│   └── index.ts      # 入口文件
├── config.example.json
├── package.json
├── tsconfig.json
└── README.md
```

### 添加新的 MCP 服务类型

1. 在 `src/config/types.ts` 中添加新的服务类型
2. 在 `src/mcp/client-manager.ts` 中实现对应的客户端
3. 更新配置验证逻辑

### 扩展 API

在 `src/api/routes.ts` 中添加新的路由处理器。

## 故障排除

### 常见问题

1. **服务无法启动**
   - 检查端口是否被占用
   - 验证配置文件格式
   - 查看日志文件

2. **MCP 服务连接失败**
   - 确认 MCP 服务器正在运行
   - 检查网络连接
   - 验证认证信息

3. **Logseq 插件无法访问**
   - 检查 CORS 配置
   - 确认插件使用正确的 API 端点
   - 查看浏览器控制台错误

### 日志查看

日志文件位置：
- 开发环境：控制台输出
- 生产环境：`logs/` 目录

### 调试模式

设置环境变量启用调试：

```bash
NODE_ENV=development npm start
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Logseq](https://logseq.com/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)