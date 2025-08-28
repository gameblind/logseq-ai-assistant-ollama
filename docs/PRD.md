# Logseq AI Assistant Ollama - 产品需求文档 (PRD)

## 项目概述

### 项目名称
Logseq AI Assistant Ollama

### 项目愿景
为 Logseq 用户创建一个强大的 AI 助理，在写笔记的同时应用 AI 技术辅助完成大量工作，提升知识管理和创作效率。

### 核心价值
- **无缝集成**：与 Logseq 深度集成，不打断用户的思维流程
- **多模态支持**：支持文本、图像、音频、视频等多种内容类型
- **本地优先**：支持本地 Ollama 模型，保护用户隐私
- **可扩展性**：通过 MCP 协议支持丰富的第三方服务
- **智能编排**：自动理解用户意图并调度合适的 AI 服务

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Logseq AI Assistant Ollama                  │
├─────────────────────────────────────────────────────────────────┤
│  Logseq 插件层 (Frontend)                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   斜杠命令系统  │  │   选择功能      │  │   设置界面      │ │
│  │   /gpt          │  │   文本处理      │  │   配置管理      │ │
│  │   /gpt-image    │  │   图片处理      │  │   API 设置      │ │
│  │   /gpt-ocr      │  │   OCR 识别      │  │   模型选择      │ │
│  │   /aihey        │  │   智能对话      │  │   桥连服务集成  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                        HTTP API 通信                           │
├─────────────────────────────────────────────────────────────────┤
│  桥连服务层 (Backend) - 核心 AI 助理                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   API 接口层    │  │   意图理解引擎  │  │   任务管理系统  │ │
│  │   RESTful API   │  │   大模型调度    │  │   异步任务队列  │ │
│  │   请求路由      │  │   智能编排      │  │   进度跟踪      │ │
│  │   参数验证      │  │   上下文管理    │  │   结果缓存      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   大模型集成    │  │   MCP 协议支持  │  │   文件处理系统  │ │
│  │   ai.comfly.chat│  │   服务发现      │  │   图片处理      │ │
│  │   阿里百炼 SDK  │  │   工具调用      │  │   格式转换      │ │
│  │   Ollama 本地   │  │   资源管理      │  │   Assets 管理   │ │
│  │   OpenAI 兼容   │  │   动态扩展      │  │   存储策略      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

外部服务集成:
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   MCP 服务生态  │  │   云端大模型    │  │   本地服务      │
│   memory        │  │   GPT-4/Claude  │  │   Ollama        │
│   filesystem    │  │   Qwen/Kling    │  │   本地存储      │
│   time/weather  │  │   TTS/ASR       │  │   本地计算      │
│   custom tools  │  │   图像/视频生成 │  │   隐私保护      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 技术架构

#### 1. Logseq 插件层

**技术栈：**
- TypeScript
- Logseq Plugin API
- Vite (构建工具)
- Tailwind CSS (样式)

**核心模块：**
- **命令处理器** (`slash.ts`): 处理斜杠命令
- **设置管理器** (`settings.ts`): 管理插件配置
- **选择处理器** (`select.ts`): 处理文本选择操作
- **API 接口** (`libs/index.ts`): 与桥连服务通信
- **桥连服务集成**: 智能意图分析和 MCP 工具调用

#### 2. 桥连服务层

**技术栈：**
- Node.js + TypeScript
- Express.js (HTTP 服务)
- MCP TypeScript SDK
- 阿里百炼 SDK (dashscope-node)
- ai.comfly.chat API 集成
- Ollama 本地模型支持
- Joi (配置验证)
- Winston (日志)

**核心模块：**
- **服务器** (`server.ts`): HTTP 服务器和中间件
- **配置管理** (`config/manager.ts`): 配置文件管理
- **MCP 客户端管理** (`mcp/client-manager.ts`): MCP 服务连接管理
- **API 路由** (`api/routes.ts`): RESTful API 实现
- **意图理解引擎**: 智能分析用户输入并路由到合适的服务
- **大模型集成**: 多种 AI 服务提供商支持
- **任务管理系统**: 异步任务处理和状态跟踪
- **文件处理系统**: Logseq Assets 集成和文件管理
- **日志系统** (`utils/logger.ts`): 统一日志管理

## 功能模块详述

### 1. Logseq 插件功能

#### 1.1 斜杠命令系统

**基础对话命令：**
- `/gpt`: 通用 AI 对话和文本处理
  - 支持多轮对话和上下文理解
  - 流式输出，实时显示生成内容
  - 支持 Markdown 格式输出
- `/gpt-block`: 当前块内容总结和分析
  - 智能识别块内容类型（代码、文本、列表等）
  - 提供结构化的总结和要点提取
- `/aihey`: 基于父块内容作为系统提示的智能对话
  - 利用父块作为上下文和指令
  - 支持角色扮演和专业领域对话

**内容生成命令：**
- `/gpt-summary`: 生成当前页面的摘要
  - 分析页面结构和内容层次
  - 生成简洁的要点总结
  - 支持不同摘要长度和风格
- `/gpt-graph`: 基于页面双链和标签的智能问答
  - 分析页面的关联内容和引用关系
  - 基于知识图谱进行智能推理
  - 提供相关页面和概念的建议

**多媒体处理命令：**
- `/gpt-ocr`: 图片文字识别和提取
  - 支持多种图片格式（PNG、JPG、WebP等）
  - 高精度文字识别和格式保持
  - 支持多语言文字识别
- `/gpt-image`: 图像生成和编辑（通过桥连服务）
  - 文本到图像生成
  - 图像编辑和风格转换
  - 支持多种艺术风格和尺寸
- `/gpt-image-edit`: 专业图片编辑
- `/gpt-tts`: 文字转语音
- `/gpt-video`: 视频生成

**命令特性：**
- 支持流式输出和实时反馈
- 上下文感知和智能推理
- 多模态处理能力
- 异步任务管理和进度跟踪

#### 1.2 选择功能

**智能文本处理：**
- 对选中文本进行语法检查、翻译、总结
- 支持代码解释和优化建议
- 自动识别内容类型并提供相应处理选项

**图片智能分析：**
- OCR 文字提取和格式化
- 图片内容描述和分析
- 图表数据提取和结构化

**批量处理：**
- 多个块的批量总结和分析
- 页面级别的内容整理和优化
- 支持自定义处理模板和规则

#### 1.3 设置管理

**AI 服务配置：**
- OpenAI API 配置（GPT-4、GPT-3.5等）
- Ollama 本地模型配置
- 桥连服务集成设置
- 多服务负载均衡和故障转移

**安全管理：**
- API 密钥加密存储
- 访问权限控制
- 使用量监控和限制

**个性化设置：**
- 模型参数调整（温度、最大长度、top-p等）
- 输出格式和风格自定义
- 命令快捷键和别名设置
- 自动保存和备份配置

#### 1.4 用户界面

**交互方式：**
- 斜杠命令触发
- 文本选择操作
- 设置面板配置
- 实时状态反馈

**桥连服务集成：**
- 智能路由：自动分析用户意图并选择最适合的服务
- MCP 工具调用：透明的 MCP 服务集成
- 状态管理：实时服务状态监控和异步任务进度跟踪

### 2. 桥连服务功能

#### 2.1 API 接口服务

**核心端点：**
```
GET  /api/health                    # 服务健康检查和状态报告
GET  /api/services                  # 获取所有 MCP 服务状态和详细信息
GET  /api/services/:serviceId       # 获取特定服务的详细状态
GET  /api/tools                     # 获取所有可用工具的完整列表
POST /api/tools/:serviceId/:toolName # 调用指定工具并处理响应
GET  /api/resources/:serviceId/*    # 读取和访问服务资源
GET  /api/temp-image/:imageId       # 临时图片访问（用于 DashScope API）
```

**配置管理 API：**
```
GET  /api/config                    # 获取当前完整配置信息
PUT  /api/config                    # 动态更新配置（支持热重载）
POST /api/config/reload             # 重新加载配置和重启服务
GET  /api/config/services           # 获取服务配置列表
POST /api/config/validate           # 配置验证和错误检查
```

**智能分析 API：**
```
POST /api/analyze-intent            # 用户意图分析和工具推荐
POST /api/tasks                     # 创建异步任务
GET  /api/tasks/:taskId             # 查询任务状态和进度
DELETE /api/tasks/:taskId           # 取消正在执行的任务
```

**文件处理 API：**
```
POST /api/files/upload              # 文件上传和处理
GET  /api/files/:fileId             # 文件下载和访问
POST /api/files/convert             # 文件格式转换
POST /api/files/process             # 图片处理（裁剪、压缩、格式转换）
```

#### 2.2 意图理解引擎

**语义分析：**
- 自然语言理解和意图识别
- 多语言支持（中文、英文等）
- 上下文感知和对话历史分析
- 实体识别和关系抽取

**任务分类：**
- 文本处理任务（总结、翻译、问答等）
- 图像处理任务（生成、编辑、分析等）
- 工具调用任务（文件操作、数据查询等）
- 复合任务的分解和编排

**智能路由：**
- 基于任务类型的服务选择
- 负载均衡和性能优化
- 故障转移和降级策略
- 成本优化和资源管理

#### 2.3 云端大模型接入

**支持的服务：**
- **ai.comfly.chat**: 主要 AI 服务提供商
  - 支持多种 OpenAI 兼容模型
  - 特殊模型支持（Qwen、Kling 等）
- **阿里百炼 SDK**: 
  - qwen-tts 语音合成
  - qwen-image-edit 图片编辑
  - 其他阿里云 AI 服务

**功能类型：**
- 语言模型对话
- 文字转语音 (TTS)
- 语音转文字 (ASR)
- 文生图 (Text-to-Image)
- 图生图 (Image-to-Image)
- 图片编辑
- 视频生成

#### 2.4 任务管理系统

**异步任务处理：**
- 任务队列管理
- 进度跟踪
- 状态通知
- 错误处理和重试

**支持的异步任务：**
- 图片生成
- 视频生成
- 音乐生成
- 大文件处理
- 批量操作

#### 2.5 文件处理功能

**文件管理：**
- 自动保存到 Logseq assets 目录
- 文件格式转换
- 文件压缩和优化
- 临时文件清理

**支持的文件类型：**
- 图片：PNG, JPG, WebP, SVG
- 音频：MP3, WAV, OGG
- 视频：MP4, WebM
- 文档：PDF, TXT, MD

#### 2.6 MCP 协议集成

**服务管理：**
- 动态服务发现和自动注册
- 服务生命周期管理（启动、停止、重启）
- 健康检查和故障自动恢复
- 服务版本管理和兼容性检查

**工具调用：**
- 标准化工具接口和协议适配
- 参数验证、类型检查和格式转换
- 异步调用支持和超时处理
- 工具链组合和批量操作

**资源管理：**
- 文件和数据资源的统一访问接口
- 智能缓存和性能优化
- 权限控制和安全验证
- 资源使用监控和配额管理

**支持的 MCP 服务类型：**
- stdio: 标准输入输出通信
- SSE: 服务器发送事件
- WebSocket: 双向实时通信

**内置 MCP 服务：**
- 时间服务：获取当前时间和日期信息
- 文件系统服务：安全的文件读写操作
- 内存服务：会话级临时数据存储

### 3. 配置管理系统

#### 3.1 分层配置架构

**默认配置层：**
- 系统内置的基础配置
- 确保服务的基本可用性
- 包含所有必要的默认值

**用户配置层：**
- 用户自定义的配置文件
- 覆盖默认配置的特定设置
- 支持部分配置更新

**环境配置层：**
- 环境变量和运行时配置
- 支持容器化部署
- 敏感信息的安全管理

#### 3.2 配置文件结构

```json
{
  "server": {
    "port": 3000,
    "host": "localhost",
    "logLevel": "info",
    "cors": {
      "origin": ["http://localhost:3001"],
      "credentials": true
    },
    "security": {
      "apiKeyRequired": true,
      "rateLimitEnabled": true,
      "maxRequestsPerMinute": 100
    }
  },
  "mcpServices": {
    "memory": {
      "name": "Memory Service",
      "description": "Persistent memory for conversations",
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-memory"],
      "enabled": true,
      "autoRestart": true,
      "healthCheckInterval": 30000
    },
    "filesystem": {
      "name": "File System Service",
      "description": "File operations and management",
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/allowed/path"],
      "enabled": true
    }
  },
  "ai": {
    "providers": {
      "comfly": {
        "baseUrl": "https://ai.comfly.chat/v1",
        "apiKey": "encrypted:xxxxx",
        "models": {
          "chat": "gpt-4-turbo",
          "image": "dall-e-3",
          "embedding": "text-embedding-3-large"
        },
        "enabled": true
      },
      "dashscope": {
        "apiKey": "encrypted:xxxxx",
        "services": {
          "tts": "qwen-audio-turbo",
          "imageEdit": "qwen-vl-max",
          "video": "kling-v1"
        },
        "enabled": true
      },
      "ollama": {
        "baseUrl": "http://localhost:11434",
        "models": ["llama2", "codellama", "mistral"],
        "enabled": false
      }
    }
  },
  "storage": {
    "tempDir": "/tmp/logseq-ai",
    "assetsDir": "/path/to/logseq/assets",
    "maxFileSize": "100MB",
    "cleanupInterval": "24h",
    "retentionPeriod": "7d"
  },
  "tasks": {
    "maxConcurrent": 5,
    "timeout": "300s",
    "retryAttempts": 3,
    "queueSize": 100
  }
}
```

#### 3.3 安全配置管理

**API 密钥加密：**
- 使用 AES-256 加密存储敏感信息
- 支持环境变量和密钥文件
- 自动密钥轮换和更新

**访问控制：**
- API 密钥验证和权限管理
- IP 白名单和黑名单
- 请求限流和防护

**配置验证：**
- Joi 模式验证：确保配置格式和类型正确
- 业务逻辑验证：检查配置的合理性和兼容性
- 依赖关系检查：验证服务间的依赖配置
- 安全策略验证：确保配置符合安全要求

#### 3.4 动态配置管理

**热重载机制：**
- 无需重启服务即可更新大部分配置
- 智能识别需要重启的配置项
- 渐进式配置更新和验证

**配置版本控制：**
- 自动备份历史配置版本
- 配置变更日志和审计
- 一键回滚到历史版本

**配置同步：**
- 多实例间的配置同步
- 配置变更的实时通知
- 分布式配置一致性保证

## 部署和运行

### 开发环境

```bash
# 安装依赖
npm install

# 启动桥连服务
cd packages/mcp-bridge-service
npm start

# 构建插件
cd packages/logseq-plugin
npm run build
```

### 生产环境

```bash
# 构建所有包
npm run build:all

# 启动服务
npm run start:prod
```

### 配置要求

**系统要求：**
- Node.js 18+
- 可选：Ollama（本地模型）
- 可选：Docker（容器化部署）

**网络要求：**
- 桥连服务端口：3000（可配置）
- 外部 API 访问权限
- Logseq 插件通信权限

## 安全和隐私

### 数据安全
- API 密钥加密存储
- 本地文件访问控制
- 网络请求验证
- 敏感信息脱敏

### 隐私保护
- 支持本地 Ollama 模型
- 可选的云服务使用
- 用户数据不上传
- 临时文件自动清理

## 扩展性设计

### MCP 生态集成
- 标准 MCP 协议支持
- 第三方服务集成
- 插件化架构
- 配置驱动扩展

### API 扩展
- RESTful API 设计
- 版本控制
- 向后兼容
- 文档自动生成

## 监控和维护

### 日志系统
- 结构化日志
- 日志级别控制
- 日志轮转
- 错误追踪

### 性能监控
- API 响应时间
- 资源使用情况
- 错误率统计
- 用户行为分析

### 健康检查
- 服务状态监控
- 依赖服务检查
- 自动恢复机制
- 告警通知

## 版本规划

### 当前版本 (v1.1.3)
- 基础 AI 对话功能
- 图片生成和编辑
- 语音合成
- 基础 MCP 支持

### 下一版本 (v1.2.0)
- 完善的任务管理界面
- 更多 MCP 服务集成
- 性能优化
- 用户体验改进

### 未来版本
- 多语言支持
- 移动端适配
- 企业级功能
- 生态系统扩展

---

**文档版本**: 1.0  
**最后更新**: 2025-01-25  
**维护者**: Logseq AI Assistant Team