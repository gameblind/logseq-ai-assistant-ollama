// MCP 工具定义
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any; // JSON Schema
  logseqCommand?: string; // 对应的 Logseq 命令
}

// MCP 资源定义
export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// MCP 提示词定义
export interface MCPPrompt {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
}

// MCP 服务配置
export interface MCPServiceConfig {
  id: string;
  name: string;
  description?: string;
  type: 'stdio' | 'sse' | 'websocket';
  enabled: boolean;
  
  // stdio 类型配置
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  
  // 网络类型配置 (sse, websocket)
  url?: string;
  headers?: Record<string, string>;
  
  // 预定义的工具、资源、提示词
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
}

// API 配置
export interface APIConfig {
  imageApiAddress: string;
  imageApiKey: string;
  imageModel: string;
  imageEditModel: string;
  imageEditQuality: string;
  imageEditResponseFormat: string;
  imageEditSize: string;
  imageEditCount: string;
  ttsApiAddress: string;
  ttsApiKey: string;
  ttsModel: string;
  ttsVoice: string;
  ttsResponseFormat: string;
  ttsSpeed: string;
  requestTimeout: number;
  dashscopeApiKey?: string;
  qwenTtsModel: string;
  qwenTtsVoice: string;
  qwenTtsFormat: string;
  // Qwen 视频生成配置
  qwenVideoT2VModel: string;
  qwenVideoI2VModel: string;
  qwenVideoResolution: string;
  qwenVideoPromptExtend: boolean;
}

// 桥接服务配置
export interface BridgeConfig {
  server: {
    port: number;
    host: string;
    logLevel: string;
    cors: {
      origin: string[];
      credentials: boolean;
    };
  };
  api: APIConfig;
  services: MCPServiceConfig[];
}

// MCP 客户端连接状态
export interface MCPClientConnection {
  id: string;
  config: MCPServiceConfig;
  client: any; // MCP Client instance
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  connectedAt?: Date;
  lastError?: string;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
}

// 工具调用请求
export interface ToolCallRequest {
  serviceId: string;
  toolName: string;
  arguments: Record<string, any>;
}

// 工具调用响应
export interface ToolCallResponse {
  success: boolean;
  result?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// 资源请求
export interface ResourceRequest {
  serviceId: string;
  uri: string;
}

// 资源响应
export interface ResourceResponse {
  success: boolean;
  content?: any;
  mimeType?: string;
  error?: string;
  metadata?: Record<string, any>;
}