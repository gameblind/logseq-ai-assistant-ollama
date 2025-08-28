import express, { Router, Request, Response } from 'express';
import { MCPClientManager } from '../mcp/client-manager';
import { ConfigManager } from '../config/manager';
import { logger } from '../utils/logger';
import { MCPServiceConfig, ToolCallRequest, ResourceRequest } from '../config/types';
import { IntentAnalyzer } from '../services/intent-analyzer';
import { AICapabilitiesService, AICapabilityType } from '../services/ai-capabilities';
import { loggingService } from '../services/logging-service';
import { conditionalLoggingMiddleware, errorLoggingMiddleware } from '../middleware/logging-middleware';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// 临时图片存储，用于DashScope API访问
const tempImageMap = new Map<string, { buffer: Buffer; mimeType: string; createdAt: number }>();

// 清理过期的临时图片（每小时清理一次）
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  for (const [key, value] of tempImageMap.entries()) {
    if (now - value.createdAt > oneHour) {
      tempImageMap.delete(key);
    }
  }
}, 60 * 60 * 1000);
// DashScope SDK will be required dynamically when needed

// 辅助函数：验证URL格式
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// 辅助函数：下载图片
function downloadImage(url: string, maxRedirects: number = 5, timeout: number = 60000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 处理localhost URL，直接从本地文件系统读取
    if (url.includes('localhost:3000/images/')) {
      try {
        const filename = url.split('/images/')[1];
        const localPath = path.join('/tmp', filename);
        
        if (fs.existsSync(localPath)) {
          const buffer = fs.readFileSync(localPath);
          resolve(buffer);
          return;
        } else {
          reject(new Error(`Local file not found: ${localPath}`));
          return;
        }
      } catch (error) {
        reject(new Error(`Failed to read local file: ${error}`));
        return;
      }
    }
    
    const protocol = url.startsWith('https:') ? https : http;
    
    // 设置超时定时器
    const timeoutId = setTimeout(() => {
      reject(new Error('Download timeout'));
    }, timeout);
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        clearTimeout(timeoutId);
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect without location header'));
          return;
        }
        // Follow redirect
        downloadImage(redirectUrl, maxRedirects - 1, timeout).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to download image: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', () => {
        clearTimeout(timeoutId);
        resolve(Buffer.concat(chunks));
      });
      
      response.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
    
    request.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    
    // 设置请求超时
    request.setTimeout(timeout, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// 辅助函数：发送 FormData 请求
function sendFormDataRequest(url: string, formData: any, headers: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        ...headers,
        ...formData.getHeaders()
      }
    };
    
    const req = protocol.request(options, (res) => {
      const chunks: Buffer[] = [];
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const responseData = JSON.parse(responseBody);
            resolve(responseData);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`));
          }
        } else {
          logger.error(`Image API error: ${res.statusCode} ${res.statusMessage}`);
          logger.error(`Error response: ${responseBody}`);
          reject(new Error(`图像生成API调用失败 (${res.statusCode}): ${responseBody}`));
        }
      });
      
      res.on('error', (error) => {
        reject(error);
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    // 发送 FormData
    formData.pipe(req);
  });
}

export function createRoutes(clientManager: MCPClientManager, configManager: ConfigManager): Router {
  const router = Router();
  const intentAnalyzer = new IntentAnalyzer(configManager);
  const aiCapabilities = new AICapabilitiesService(configManager);

  // 图像生成任务存储
  const imageTasksMap = new Map<string, {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    type: 'text-to-image' | 'image-to-image' | 'image-edit';
    prompt: string;
    config: {
      model: string;
      size?: string;
      quality?: string;
      responseFormat?: string;
      imageApiKey: string;
      imageApiAddress: string;
      editModel?: string;
      editQuality?: string;
      editSize?: string;
      editCount?: number;
    };
    inputImages?: string[];
    maskImage?: string;
    logseqPath: string;
    filename: string;
    filePath?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
    // 增强的任务信息
    submissionInfo?: {
      userAgent?: string;
      clientIp?: string;
      requestHeaders?: Record<string, string>;
      submittedAt: number;
    };
    cloudRequestInfo?: {
      apiEndpoint: string;
      requestMethod: string;
      requestHeaders: Record<string, string>;
      requestBody: any;
      sentAt: number;
    };
    processSteps?: Array<{
      step: string;
      status: 'pending' | 'processing' | 'completed' | 'failed';
      startTime: number;
      endTime?: number;
      details?: any;
      error?: string;
    }>;
    cloudResponseInfo?: {
      statusCode: number;
      responseHeaders: Record<string, string>;
      responseBody: any;
      receivedAt: number;
      processingTime: number;
    };
  }>();

  // 应用日志记录中间件
  router.use(conditionalLoggingMiddleware);

  // 健康检查
  router.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  // 临时图片访问端点，用于DashScope API
  router.get('/temp-image/:imageId', (req: Request, res: Response) => {
    const { imageId } = req.params;
    const imageData = tempImageMap.get(imageId);
    
    if (!imageData) {
      return res.status(404).json({ error: 'Image not found or expired' });
    }
    
    res.set('Content-Type', imageData.mimeType);
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(imageData.buffer);
  });

  // 获取所有服务状态
  router.get('/services', (req: Request, res: Response) => {
    try {
      const services = clientManager.getServices().map(conn => ({
        id: conn.id,
        name: conn.config.name,
        description: conn.config.description,
        type: conn.config.type,
        status: conn.status,
        enabled: conn.config.enabled,
        connectedAt: conn.connectedAt,
        lastError: conn.lastError,
        toolsCount: conn.tools.length,
        resourcesCount: conn.resources.length,
        promptsCount: conn.prompts.length
      }));
      
      res.json({ services });
    } catch (error) {
      logger.error('Error getting services:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 获取特定服务详情
  router.get('/services/:serviceId', (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      const connection = clientManager.getService(serviceId);
      
      if (!connection) {
        return res.status(404).json({ error: 'Service not found' });
      }
      
      return res.json({
        id: connection.id,
        name: connection.config.name,
        description: connection.config.description,
        type: connection.config.type,
        status: connection.status,
        enabled: connection.config.enabled,
        connectedAt: connection.connectedAt,
        lastError: connection.lastError,
        config: connection.config,
        tools: connection.tools,
        resources: connection.resources,
        prompts: connection.prompts
      });
    } catch (error) {
      logger.error('Error getting service:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 获取所有可用工具
  router.get('/tools', (req: Request, res: Response) => {
    try {
      const tools = clientManager.getAllTools().map(({ serviceId, tool }) => ({
        serviceId,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        logseqCommand: tool.logseqCommand
      }));
      
      res.json({ tools });
    } catch (error) {
      logger.error('Error getting tools:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 调用工具
  router.post('/tools/:serviceId/:toolName', async (req: Request, res: Response) => {
    try {
      const { serviceId, toolName } = req.params;
      const { arguments: toolArgs = {} } = req.body;
      
      const request: ToolCallRequest = {
        serviceId,
        toolName,
        arguments: toolArgs
      };
      
      logger.info(`Calling tool ${toolName} on service ${serviceId}`, { arguments: toolArgs });
      
      const response = await clientManager.callTool(request);
      
      if (response.success) {
        res.json({
          success: true,
          result: response.result,
          metadata: response.metadata
        });
      } else {
        res.status(400).json({
          success: false,
          error: response.error,
          metadata: response.metadata
        });
      }
    } catch (error) {
      logger.error('Error calling tool:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error' 
      });
    }
  });

  // 读取资源
  router.get('/resources/:serviceId/*', async (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      const uri = req.params[0]; // 获取通配符部分
      
      const request: ResourceRequest = {
        serviceId,
        uri
      };
      
      logger.info(`Reading resource ${uri} from service ${serviceId}`);
      
      const response = await clientManager.readResource(request);
      
      if (response.success) {
        res.set('Content-Type', response.mimeType || 'application/json');
        res.send(response.content);
      } else {
        res.status(400).json({
          success: false,
          error: response.error,
          metadata: response.metadata
        });
      }
    } catch (error) {
      logger.error('Error reading resource:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error' 
      });
    }
  });

  // 配置管理 API
  
  // 获取配置
  router.get('/config', (req: Request, res: Response) => {
    try {
      const config = configManager.getConfig();
      res.json(config);
    } catch (error) {
      logger.error('Error getting config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 更新配置
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const updates = req.body;
      // 配置更新功能暂未实现
      // TODO: 实现配置更新功能
      // 配置自动保存
      
      res.json({ success: true, message: 'Configuration updated' });
    } catch (error) {
      logger.error('Error updating config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 智能意图分析端点
  router.post('/analyze-intent', async (req: Request, res: Response) => {
    try {
      const { userInput, availableTools } = req.body;
      
      if (!userInput || typeof userInput !== 'string') {
        res.status(400).json({ 
          success: false, 
          error: 'userInput is required and must be a string' 
        });
        return;
      }

      // 获取所有可用的MCP工具
       const tools = availableTools || clientManager.getAllTools().map(({ serviceId, tool }: { serviceId: string, tool: { name: string, description: string, inputSchema: any } }) => ({
         serviceId,
         name: tool.name,
         description: tool.description,
         inputSchema: tool.inputSchema
       }));

       // 模拟意图分析函数
       const analyzeMockIntent = (input: string, availableTools: any[]) => {
         const lowerInput = input.toLowerCase();
         
         // 记忆相关关键词
         if (lowerInput.includes('记住') || lowerInput.includes('保存') || lowerInput.includes('记录') || lowerInput.includes('存储')) {
           const memoryTool = availableTools.find(t => t.serviceId === 'memory');
           if (memoryTool) {
             return {
               needsMCP: true,
               recommendedTool: {
                 serviceId: 'memory',
                 toolName: 'store_memory',
                 arguments: { content: input.replace(/记住|保存|记录|存储/g, '').trim() },
                 reasoning: '用户想要保存信息到记忆中'
               }
             };
           }
         }
         
         // 搜索记忆相关关键词
         if (lowerInput.includes('回忆') || lowerInput.includes('查找') || lowerInput.includes('搜索记忆') || lowerInput.includes('之前说过')) {
           const memoryTool = availableTools.find(t => t.serviceId === 'memory');
           if (memoryTool) {
             return {
               needsMCP: true,
               recommendedTool: {
                 serviceId: 'memory',
                 toolName: 'search_memory',
                 arguments: { query: input },
                 reasoning: '用户想要搜索之前的记忆'
               }
             };
           }
         }
         
         // 时间相关关键词
         if (lowerInput.includes('时间') || lowerInput.includes('现在几点') || lowerInput.includes('日期') || lowerInput.includes('今天')) {
           const timeTool = availableTools.find(t => t.serviceId === 'time');
           if (timeTool) {
             return {
               needsMCP: true,
               recommendedTool: {
                 serviceId: 'time',
                 toolName: 'get_current_time',
                 arguments: {},
                 reasoning: '用户询问当前时间或日期'
               }
             };
           }
         }
         
         // 文件操作相关关键词
         if (lowerInput.includes('读取文件') || lowerInput.includes('查看文件') || lowerInput.includes('文件内容')) {
           const fsTool = availableTools.find(t => t.serviceId === 'filesystem');
           if (fsTool) {
             return {
               needsMCP: true,
               recommendedTool: {
                 serviceId: 'filesystem',
                 toolName: 'read_file',
                 arguments: { path: '' }, // 需要用户提供具体路径
                 reasoning: '用户想要读取文件内容'
               }
             };
           }
         }
         
         // 网络请求相关关键词
         if (lowerInput.includes('获取网页') || lowerInput.includes('访问') || lowerInput.includes('http') || lowerInput.includes('请求')) {
           const fetchTool = availableTools.find(t => t.serviceId === 'fetch');
           if (fetchTool) {
             return {
               needsMCP: true,
               recommendedTool: {
                 serviceId: 'fetch',
                 toolName: 'fetch_url',
                 arguments: { url: '' }, // 需要用户提供具体URL
                 reasoning: '用户想要获取网页内容或进行网络请求'
               }
             };
           }
         }
         
         return {
           needsMCP: false,
           reasoning: '用户输入不需要调用特定的MCP工具，可以直接进行对话'
         };
       };

      // 构建意图分析的提示词
      const systemPrompt = `你是一个智能助手，负责分析用户输入并推荐合适的MCP工具。

可用的MCP工具：
${tools.map((tool: any) => `- ${tool.serviceId}/${tool.name}: ${tool.description}`).join('\n')}

请分析用户输入，判断是否需要调用MCP工具。如果需要，请返回JSON格式：
{
  "needsMCP": true,
  "recommendedTool": {
    "serviceId": "服务ID",
    "toolName": "工具名称",
    "arguments": {"参数对象"},
    "reasoning": "选择理由"
  }
}

如果不需要MCP工具，返回：
{
  "needsMCP": false,
  "reasoning": "不需要工具的原因"
}

分析以下用户输入：`;

      const analysisPrompt = `${systemPrompt}\n\n用户输入："${userInput}"`;

      // 使用真实的意图分析引擎
       const userInputObj = { text: userInput, images: [] };
       const mockAnalysis = await intentAnalyzer.analyzeIntent(userInputObj, tools);
      
      res.json({
        success: true,
        analysis: mockAnalysis,
        availableTools: tools.length
      });
    } catch (error) {
       logger.error('Error analyzing intent:', error);
       res.status(500).json({ 
         success: false, 
         error: error instanceof Error ? error.message : 'Intent analysis failed' 
       });
    }
  });

  // 获取服务配置列表
  router.get('/config/services', (req: Request, res: Response) => {
    try {
      const services = configManager.getServices();
      res.json({ services });
    } catch (error) {
      logger.error('Error getting service configs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 添加或更新服务配置
  router.post('/config/services', async (req: Request, res: Response) => {
    try {
      const serviceConfig: MCPServiceConfig = req.body;
      
      configManager.addService(serviceConfig);
      
      // 添加到客户端管理器
      await clientManager.addService(serviceConfig);
      
      res.json({ success: true, message: 'Service added successfully' });
    } catch (error) {
      logger.error('Error adding service:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid service configuration' });
    }
  });

  // 更新服务配置
  router.put('/config/services/:serviceId', async (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      const updates = req.body;
      
      configManager.updateService(serviceId, updates);
      
      // 重新加载服务
      const updatedConfig = configManager.getService(serviceId);
      if (updatedConfig) {
        await clientManager.addService(updatedConfig);
      }
      
      res.json({ success: true, message: 'Service updated successfully' });
    } catch (error) {
      logger.error('Error updating service:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid service configuration' });
      }
    }
  });

  // 删除服务配置
  router.delete('/config/services/:serviceId', async (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      
      configManager.removeService(serviceId);
      await clientManager.removeService(serviceId);
      
      res.json({ success: true, message: 'Service removed successfully' });
    } catch (error) {
      logger.error('Error removing service:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // 服务控制 API
  
  // 连接服务
  router.post('/services/:serviceId/connect', async (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      await clientManager.connectService(serviceId);
      res.json({ success: true, message: 'Service connection initiated' });
    } catch (error) {
      logger.error('Error connecting service:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Connection failed' });
    }
  });

  // 断开服务
  router.post('/services/:serviceId/disconnect', async (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      await clientManager.disconnectService(serviceId);
      res.json({ success: true, message: 'Service disconnected' });
    } catch (error) {
      logger.error('Error disconnecting service:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Disconnection failed' });
    }
  });

  // 获取示例配置
  router.get('/config/example', (req: Request, res: Response) => {
    try {
      const exampleConfig = {
        server: {
          port: 3000,
          host: '0.0.0.0',
          logLevel: 'info',
          cors: {
            origin: ['*'],
            credentials: true
          }
        },
        services: [
          {
            id: 'example-search',
            name: '示例搜索服务',
            description: '一个示例MCP服务',
            type: 'stdio',
            command: 'node',
            args: ['example-server.js'],
            enabled: true,
            tools: [
              {
                name: 'search',
                description: '搜索功能',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' }
                  }
                }
              }
            ]
          }
        ]
      };
      res.json(exampleConfig);
    } catch (error) {
      logger.error('Error getting example config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 文件处理 API
  
  // TTS 任务存储
  const ttsTasksMap = new Map<string, {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    text: string;
    config: {
      model: string;
      voice: string;
      responseFormat?: string;
      speed?: number;
      ttsApiKey: string;
      ttsApiAddress: string;
    };
    logseqPath: string;
    filename: string;
    filePath?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
  }>();

  // 创建异步 TTS 任务
  router.post('/tts/create-task', async (req: Request, res: Response) => {
    try {
      const { text, config, logseqPath, filename } = req.body;
      
      if (!text || !config || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: text, config, logseqPath, filename'
        });
      }
      
      // 生成任务ID
      const taskId = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建任务记录
      const task = {
        id: taskId,
        status: 'pending' as const,
        text,
        config,
        logseqPath,
        filename,
        createdAt: Date.now()
      };
      
      ttsTasksMap.set(taskId, task);
      
      logger.info(`Created TTS task: ${taskId}`);
      
      // 立即开始处理任务（异步）
      processTTSTask(taskId).catch(error => {
        logger.error(`Error processing TTS task ${taskId}:`, error);
        const task = ttsTasksMap.get(taskId);
        if (task) {
          task.status = 'failed';
          task.error = error.message;
        }
      });
      
      return res.json({
        success: true,
        taskId,
        status: 'pending',
        message: 'TTS task created and processing started'
      });
    } catch (error) {
      logger.error('Error creating TTS task:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 查询 TTS 任务状态
  router.get('/tts/task/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = ttsTasksMap.get(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      return res.json({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          filename: task.filename,
          filePath: task.filePath,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt
        }
      });
    } catch (error) {
      logger.error('Error getting TTS task status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Qwen TTS 任务存储
  const qwenTtsTasksMap = new Map<string, {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    text: string;
    config: {
      model: string;
      voice: string;
      responseFormat?: string;
      qwenApiKey: string;
      qwenApiAddress: string;
    };
    logseqPath: string;
    filename: string;
    filePath?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
  }>();

  // Qwen T2V 任务存储
  const qwenT2VTasksMap = new Map<string, {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    prompt: string;
    config: {
      model: string;
      resolution: string;
      promptExtend: boolean;
      qwenApiKey: string;
    };
    logseqPath: string;
    filename: string;
    filePath?: string;
    videoUrl?: string;
    dashscopeTaskId?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
    pollCount?: number;
  }>();

  // Qwen I2V 任务存储
  const qwenI2VTasksMap = new Map<string, {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    prompt: string;
    imageUrl: string;
    config: {
      model: string;
      resolution: string;
      promptExtend: boolean;
      qwenApiKey: string;
    };
    logseqPath: string;
    filename: string;
    filePath?: string;
    videoUrl?: string;
    dashscopeTaskId?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
    pollCount?: number;
  }>();

  // 创建异步 Qwen TTS 任务
  router.post('/qwen-tts/create-task', async (req: Request, res: Response) => {
    try {
      const { text, config, logseqPath, filename } = req.body;
      
      if (!text || !config || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: text, config, logseqPath, filename'
        });
      }
      
      // 生成任务ID
      const taskId = `qwen_tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建任务记录
      const task = {
        id: taskId,
        status: 'pending' as const,
        text,
        config,
        logseqPath,
        filename,
        createdAt: Date.now()
      };
      
      qwenTtsTasksMap.set(taskId, task);
      
      logger.info(`Created Qwen TTS task: ${taskId}`);
      
      // 立即开始处理任务（异步）
      processQwenTTSTask(taskId).catch(error => {
        logger.error(`Error processing Qwen TTS task ${taskId}:`, error);
        const task = qwenTtsTasksMap.get(taskId);
        if (task) {
          task.status = 'failed';
          task.error = error.message;
        }
      });
      
      return res.json({
        success: true,
        taskId,
        status: 'pending',
        message: 'Qwen TTS task created and processing started'
      });
    } catch (error) {
      logger.error('Error creating Qwen TTS task:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 查询 Qwen TTS 任务状态
  router.get('/qwen-tts/task/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = qwenTtsTasksMap.get(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      return res.json({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          filename: task.filename,
          filePath: task.filePath,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt
        }
      });
    } catch (error) {
      logger.error('Error getting Qwen TTS task status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 创建异步 Qwen T2V 任务
  router.post('/qwen-t2v/create-task', async (req: Request, res: Response) => {
    try {
      const { prompt, config, logseqPath, filename } = req.body;
      
      if (!prompt || !config || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: prompt, config, logseqPath, filename'
        });
      }
      
      // 生成任务ID
      const taskId = `qwen_t2v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建任务记录
      const task = {
        id: taskId,
        status: 'pending' as const,
        prompt,
        config,
        logseqPath,
        filename,
        createdAt: Date.now(),
        pollCount: 0
      };
      
      qwenT2VTasksMap.set(taskId, task);
      
      logger.info(`Created Qwen T2V task: ${taskId}`);
      
      // 立即开始处理任务（异步）
      processQwenT2VTask(taskId).catch(error => {
        logger.error(`Error processing Qwen T2V task ${taskId}:`, error);
        const task = qwenT2VTasksMap.get(taskId);
        if (task) {
          task.status = 'failed';
          task.error = error.message;
        }
      });
      
      return res.json({
        success: true,
        taskId,
        status: 'pending',
        message: 'Qwen T2V task created and processing started'
      });
    } catch (error) {
      logger.error('Error creating Qwen T2V task:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 查询 Qwen T2V 任务状态
  router.get('/qwen-t2v/task/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = qwenT2VTasksMap.get(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      return res.json({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          filename: task.filename,
          filePath: task.filePath,
          videoUrl: task.videoUrl,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt
        }
      });
    } catch (error) {
      logger.error('Error getting Qwen T2V task status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 创建异步 Qwen I2V 任务
  router.post('/qwen-i2v/create-task', async (req: Request, res: Response) => {
    try {
      const { prompt, imageUrl, config, logseqPath, filename } = req.body;
      
      if (!prompt || !imageUrl || !config || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: prompt, imageUrl, config, logseqPath, filename'
        });
      }
      
      // 生成任务ID
      const taskId = `qwen_i2v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建任务记录
      const task = {
        id: taskId,
        status: 'pending' as const,
        prompt,
        imageUrl,
        config,
        logseqPath,
        filename,
        createdAt: Date.now(),
        pollCount: 0
      };
      
      qwenI2VTasksMap.set(taskId, task);
      
      logger.info(`Created Qwen I2V task: ${taskId}`);
      
      // 立即开始处理任务（异步）
      processQwenI2VTask(taskId).catch(error => {
        logger.error(`Error processing Qwen I2V task ${taskId}:`, error);
        const task = qwenI2VTasksMap.get(taskId);
        if (task) {
          task.status = 'failed';
          task.error = error.message;
        }
      });
      
      return res.json({
        success: true,
        taskId,
        status: 'pending',
        message: 'Qwen I2V task created and processing started'
      });
    } catch (error) {
      logger.error('Error creating Qwen I2V task:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 查询 Qwen I2V 任务状态
  router.get('/qwen-i2v/task/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = qwenI2VTasksMap.get(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      return res.json({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          filename: task.filename,
          filePath: task.filePath,
          videoUrl: task.videoUrl,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt
        }
      });
    } catch (error) {
      logger.error('Error getting Qwen I2V task status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 异步处理 Qwen TTS 任务的函数
  async function processQwenTTSTask(taskId: string): Promise<void> {
    const task = qwenTtsTasksMap.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    try {
      task.status = 'processing';
      logger.info(`Processing Qwen TTS task: ${taskId}`);
      
      // 构建 DashScope API 请求体
      const requestBody = {
        model: task.config.model,
        input: {
          text: task.text,
          voice: task.config.voice
        }
      };
      
      // 调用 DashScope API
      const response = await fetch(task.config.qwenApiAddress, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${configManager.getConfig().api.dashscopeApiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DashScope API error: ${response.status} ${errorText}`);
      }
      
      const responseData: any = await response.json();
       
       // 检查响应格式并获取音频URL
       let audioUrl = null;
       if (responseData.output && responseData.output.audio && responseData.output.audio.url) {
         audioUrl = responseData.output.audio.url;
       } else {
         throw new Error('响应格式错误：未找到音频URL');
       }
      
      // 下载音频文件
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`音频下载失败: ${audioResponse.status}`);
      }
      
      const audioBuffer = await audioResponse.arrayBuffer();
      
      // 确保 Logseq assets 目录存在
      const assetsDir = path.join(task.logseqPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        logger.info(`Created assets directory: ${assetsDir}`);
      }
      
      // 生成唯一文件名
      const timestamp = Date.now();
      const fileExtension = path.extname(task.filename) || '.mp3';
      const baseName = path.basename(task.filename, fileExtension);
      const uniqueFilename = `${baseName}_${timestamp}${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFilename);
      const relativePath = path.join('assets', uniqueFilename);
      
      // 保存文件
      fs.writeFileSync(filePath, Buffer.from(audioBuffer));
      
      // 更新任务状态
      task.status = 'completed';
      task.filePath = relativePath;
      task.completedAt = Date.now();
      
      logger.info(`Qwen TTS task completed: ${taskId}, file saved to: ${filePath}`);
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Qwen TTS task failed: ${taskId}`, error);
      throw error;
    }
  }

  // 异步处理 Qwen T2V 任务的函数
  async function processQwenT2VTask(taskId: string): Promise<void> {
    const task = qwenT2VTasksMap.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    try {
      task.status = 'processing';
      logger.info(`Processing Qwen T2V task: ${taskId}`);
      
      // 从配置管理器获取 API 密钥
      const config = configManager.getConfig();
      const dashscopeApiKey = config.api.dashscopeApiKey;
      
      if (!dashscopeApiKey) {
        throw new Error('DashScope API key not configured');
      }
      
      // 构建 DashScope API 请求体
      const requestBody: any = {
        model: task.config.model || 'wan2.2-t2v-plus',
        input: {
          prompt: task.prompt
        },
        parameters: {
          size: task.config.resolution || '1920*1080'
        }
      };
      
      // 如果启用提示词扩展
      if (task.config.promptExtend) {
        requestBody.parameters.prompt_extend = true;
      }
      
      // 调用 DashScope API 创建任务
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dashscopeApiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DashScope API error: ${response.status} ${errorText}`);
      }
      
      const responseData: any = await response.json();
      
      // 检查响应格式并获取任务ID
      if (responseData.output && responseData.output.task_id) {
        task.dashscopeTaskId = responseData.output.task_id;
        logger.info(`Qwen T2V task ${taskId} created with DashScope task ID: ${task.dashscopeTaskId}`);
        
        // 开始轮询任务状态
        await pollQwenVideoTaskStatus(taskId, 't2v');
      } else {
        throw new Error('响应格式错误：未找到任务ID');
      }
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Qwen T2V task failed: ${taskId}`, error);
      throw error;
    }
  }

  // 异步处理 Qwen I2V 任务的函数
  async function processQwenI2VTask(taskId: string): Promise<void> {
    const task = qwenI2VTasksMap.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    try {
      task.status = 'processing';
      logger.info(`Processing Qwen I2V task: ${taskId}`);
      
      // 从配置管理器获取 API 密钥
      const config = configManager.getConfig();
      const dashscopeApiKey = config.api.dashscopeApiKey;
      
      if (!dashscopeApiKey) {
        throw new Error('DashScope API key not configured');
      }
      
      // 构建 DashScope API 请求体
      const requestBody: any = {
        model: task.config.model || 'wan2.2-i2v-plus',
        input: {
          prompt: task.prompt,
          img_url: task.imageUrl
        },
        parameters: {
          size: task.config.resolution || '1920*1080'
        }
      };
      
      // 如果启用提示词扩展
      if (task.config.promptExtend) {
        requestBody.parameters.prompt_extend = true;
      }
      
      // 调用 DashScope API 创建任务
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dashscopeApiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DashScope API error: ${response.status} ${errorText}`);
      }
      
      const responseData: any = await response.json();
      
      // 检查响应格式并获取任务ID
      if (responseData.output && responseData.output.task_id) {
        task.dashscopeTaskId = responseData.output.task_id;
        logger.info(`Qwen I2V task ${taskId} created with DashScope task ID: ${task.dashscopeTaskId}`);
        
        // 开始轮询任务状态
        await pollQwenVideoTaskStatus(taskId, 'i2v');
      } else {
        throw new Error('响应格式错误：未找到任务ID');
      }
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Qwen I2V task failed: ${taskId}`, error);
      throw error;
    }
  }

  // 轮询 Qwen 视频任务状态的函数
  async function pollQwenVideoTaskStatus(taskId: string, taskType: 't2v' | 'i2v'): Promise<void> {
    const taskMap = taskType === 't2v' ? qwenT2VTasksMap : qwenI2VTasksMap;
    const task = taskMap.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    const maxAttempts = 120; // 最大轮询次数（约30分钟）
    let attempts = 0;
    
    const poll = async (): Promise<void> => {
      try {
        attempts++;
        task.pollCount = attempts;
        
        // 计算轮询间隔：前1分钟4秒一次，4分钟后15秒一次
        const elapsedTime = Date.now() - task.createdAt;
        let pollInterval: number;
        if (elapsedTime < 60 * 1000) { // 前1分钟
          pollInterval = 4 * 1000; // 4秒
        } else if (elapsedTime < 4 * 60 * 1000) { // 1-4分钟
          pollInterval = 8 * 1000; // 8秒
        } else { // 4分钟后
          pollInterval = 15 * 1000; // 15秒
        }
        
        logger.info(`Polling Qwen ${taskType.toUpperCase()} task ${taskId}, attempt ${attempts}/${maxAttempts}`);
        
        // 查询任务状态
        const config = configManager.getConfig();
        const dashscopeApiKey = config.api.dashscopeApiKey;
        
        const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${task.dashscopeTaskId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${dashscopeApiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Status query failed: ${response.status}`);
        }
        
        const statusData: any = await response.json();
        
        // 添加调试日志
        logger.info(`DashScope API response for task ${taskId}: ${JSON.stringify(statusData, null, 2)}`);
        
        if (statusData.output) {
          if (statusData.output.task_status === 'SUCCEEDED') {
            // 任务成功完成
            if (statusData.output.video_url) {
              const videoUrl = statusData.output.video_url;
              task.videoUrl = videoUrl;
              
              // 下载视频文件
              await downloadVideoFile(taskId, videoUrl, taskType);
              
              task.status = 'completed';
              task.completedAt = Date.now();
              logger.info(`Qwen ${taskType.toUpperCase()} task completed: ${taskId}`);
              return;
            } else {
              logger.error(`Task ${taskId} completed but no video_url found. Response structure: ${JSON.stringify(statusData.output, null, 2)}`);
              throw new Error('任务完成但未找到视频URL');
            }
          } else if (statusData.output.task_status === 'FAILED') {
            // 任务失败
            const errorMsg = statusData.output.message || '视频生成失败';
            throw new Error(errorMsg);
          } else if (statusData.output.task_status === 'PENDING' || statusData.output.task_status === 'RUNNING') {
            // 任务仍在进行中
            if (attempts >= maxAttempts) {
              throw new Error('任务超时：视频生成时间过长');
            }
            
            // 继续轮询
            setTimeout(() => {
              poll().catch(error => {
                task.status = 'failed';
                task.error = error.message;
                logger.error(`Qwen ${taskType.toUpperCase()} polling failed: ${taskId}`, error);
              });
            }, pollInterval);
            return;
          } else {
            throw new Error(`未知任务状态: ${statusData.output.task_status}`);
          }
        } else {
          throw new Error('状态查询响应格式错误');
        }
        
      } catch (error) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Qwen ${taskType.toUpperCase()} task polling failed: ${taskId}`, error);
        throw error;
      }
    };
    
    // 开始轮询
    await poll();
  }

  // 下载视频文件的函数
  async function downloadVideoFile(taskId: string, videoUrl: string, taskType: 't2v' | 'i2v'): Promise<void> {
    const taskMap = taskType === 't2v' ? qwenT2VTasksMap : qwenI2VTasksMap;
    const task = taskMap.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    try {
      logger.info(`Downloading video for ${taskType.toUpperCase()} task: ${taskId}`);
      
      // 下载视频文件
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`视频下载失败: ${videoResponse.status}`);
      }
      
      const videoBuffer = await videoResponse.arrayBuffer();
      
      // 确保 Logseq assets 目录存在
      const assetsDir = path.join(task.logseqPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        logger.info(`Created assets directory: ${assetsDir}`);
      }
      
      // 生成唯一文件名
      const timestamp = Date.now();
      const fileExtension = path.extname(task.filename) || '.mp4';
      const baseName = path.basename(task.filename, fileExtension);
      const uniqueFilename = `${baseName}_${timestamp}${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFilename);
      const relativePath = path.join('assets', uniqueFilename);
      
      // 保存文件
      fs.writeFileSync(filePath, Buffer.from(videoBuffer));
      
      // 更新任务状态
      task.filePath = relativePath;
      
      logger.info(`Video file saved: ${filePath}`);
      
    } catch (error) {
      logger.error(`Error downloading video for task ${taskId}:`, error);
      throw error;
    }
  }

  // 异步处理 TTS 任务的函数
  async function processTTSTask(taskId: string): Promise<void> {
    const task = ttsTasksMap.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    
    try {
      task.status = 'processing';
      logger.info(`Processing TTS task: ${taskId}`);
      
      // 构建请求体
      const requestBody = {
        model: task.config.model,
        input: task.text,
        voice: task.config.voice,
        response_format: task.config.responseFormat,
        speed: task.config.speed
      };
      
      // 调用 TTS API
      const response = await fetch(task.config.ttsApiAddress, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${task.config.ttsApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS API error: ${response.status} ${errorText}`);
      }
      
      // 获取音频数据
      const audioBuffer = await response.arrayBuffer();
      
      // 确保 Logseq assets 目录存在
      const assetsDir = path.join(task.logseqPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        logger.info(`Created assets directory: ${assetsDir}`);
      }
      
      // 生成唯一文件名
      const timestamp = Date.now();
      const fileExtension = path.extname(task.filename) || '.mp3';
      const baseName = path.basename(task.filename, fileExtension);
      const uniqueFilename = `${baseName}_${timestamp}${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFilename);
      const relativePath = path.join('assets', uniqueFilename);
      
      // 保存文件
      fs.writeFileSync(filePath, Buffer.from(audioBuffer));
      
      // 更新任务状态
      task.status = 'completed';
      task.filePath = relativePath;
      task.completedAt = Date.now();
      
      logger.info(`TTS task completed: ${taskId}, file saved to: ${filePath}`);
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`TTS task failed: ${taskId}`, error);
      throw error;
    }
  }

  // 保存 TTS 音频数据到 Logseq 文件夹（保留原有同步方法作为备用）
  router.post('/files/save-tts', async (req: Request, res: Response) => {
    try {
      const { audioData, logseqPath, filename, mimeType } = req.body;
      
      if (!audioData || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: audioData, logseqPath, filename'
        });
      }
      
      logger.info(`Saving TTS audio data to ${logseqPath}`);
      
      // 确保 Logseq assets 目录存在
      const assetsDir = path.join(logseqPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        logger.info(`Created assets directory: ${assetsDir}`);
      }
      
      // 生成唯一文件名（避免冲突）
      const timestamp = Date.now();
      const fileExtension = path.extname(filename) || '.mp3';
      const baseName = path.basename(filename, fileExtension);
      const uniqueFilename = `${baseName}_${timestamp}${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFilename);
      
      // 将 base64 数据转换为 Buffer 并保存
      try {
        const audioBuffer = Buffer.from(audioData, 'base64');
        fs.writeFileSync(filePath, audioBuffer);
        
        const relativePath = path.join('assets', uniqueFilename);
        logger.info(`TTS audio saved successfully: ${filePath}`);
        
        return res.json({
          success: true,
          filePath: relativePath,
          fullPath: filePath,
          filename: uniqueFilename,
          size: audioBuffer.length
        });
      } catch (saveError) {
        logger.error('Error saving audio file:', saveError);
        return res.status(500).json({
          success: false,
          error: 'Failed to save audio file'
        });
      }
    } catch (error) {
      logger.error('Error processing TTS audio:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });
  
  // 下载并保存 TTS 文件到 Logseq 文件夹（保留原有功能作为备用）
  router.post('/files/download-tts', async (req: Request, res: Response) => {
    try {
      const { audioUrl, logseqPath, filename } = req.body;
      
      if (!audioUrl || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: audioUrl, logseqPath, filename'
        });
      }
      
      logger.info(`Downloading TTS file from ${audioUrl} to ${logseqPath}`);
      
      // 确保 Logseq assets 目录存在
      const assetsDir = path.join(logseqPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        logger.info(`Created assets directory: ${assetsDir}`);
      }
      
      // 生成唯一文件名（避免冲突）
      const timestamp = Date.now();
      const fileExtension = path.extname(filename) || '.mp3';
      const baseName = path.basename(filename, fileExtension);
      const uniqueFilename = `${baseName}_${timestamp}${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFilename);
      
      // 下载文件
      const downloadResult = await downloadFile(audioUrl, filePath);
      
      if (downloadResult.success) {
        const relativePath = path.join('assets', uniqueFilename);
        return res.json({
          success: true,
          filePath: relativePath,
          fullPath: filePath,
          filename: uniqueFilename,
          size: downloadResult.size
        });
      } else {
        return res.status(500).json({
          success: false,
          error: downloadResult.error
        });
      }
    } catch (error) {
      logger.error('Error downloading TTS file:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });
  
  // 保存图片数据到 Logseq 文件夹（参考TTS实现）
  router.post('/files/save-image', async (req: Request, res: Response) => {
    try {
      const { imageUrl, logseqPath, filename } = req.body;
      
      if (!imageUrl || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: imageUrl, logseqPath, filename'
        });
      }
      
      logger.info(`Downloading and saving image from ${imageUrl} to ${logseqPath}`);
      
      // 确保 Logseq assets 目录存在
      const assetsDir = path.join(logseqPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
        logger.info(`Created assets directory: ${assetsDir}`);
      }
      
      // 生成唯一文件名（避免冲突）
      const timestamp = Date.now();
      const fileExtension = path.extname(filename) || '.png';
      const baseName = path.basename(filename, fileExtension);
      const uniqueFilename = `${baseName}_${timestamp}${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFilename);
      
      // 下载图片
      try {
        const imageBuffer = await downloadImage(imageUrl, 5, 60000);
        fs.writeFileSync(filePath, imageBuffer);
        
        const relativePath = path.join('assets', uniqueFilename);
        logger.info(`Image saved successfully: ${filePath}`);
        
        return res.json({
          success: true,
          filePath: relativePath,
          fullPath: filePath,
          filename: uniqueFilename,
          size: imageBuffer.length
        });
      } catch (saveError) {
        logger.error('Error downloading/saving image file:', saveError);
        return res.status(500).json({
          success: false,
          error: 'Failed to download or save image file'
        });
      }
    } catch (error) {
      logger.error('Error processing image:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });
  
  // 检查 Logseq 路径是否有效
  router.post('/files/validate-logseq-path', (req: Request, res: Response) => {
    try {
      const { logseqPath } = req.body;
      
      if (!logseqPath) {
        return res.status(400).json({
          success: false,
          error: 'Missing logseqPath parameter'
        });
      }
      
      // 检查路径是否存在且是目录
      const isValid = fs.existsSync(logseqPath) && fs.statSync(logseqPath).isDirectory();
      
      // 检查是否是 Logseq 图谱目录（包含 logseq 文件夹）
      const logseqConfigDir = path.join(logseqPath, 'logseq');
      const isLogseqGraph = fs.existsSync(logseqConfigDir);
      
      return res.json({
        success: true,
        isValid,
        isLogseqGraph,
        path: logseqPath,
        assetsPath: path.join(logseqPath, 'assets')
      });
    } catch (error) {
      logger.error('Error validating Logseq path:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 获取所有任务状态
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const allTasks = [];
      
      // 调试日志
      logger.info(`Task maps sizes - TTS: ${ttsTasksMap.size}, Qwen TTS: ${qwenTtsTasksMap.size}, Image: ${imageTasksMap.size}, T2V: ${qwenT2VTasksMap.size}, I2V: ${qwenI2VTasksMap.size}`);
      logger.info(`Image tasks:`, Array.from(imageTasksMap.keys()));
      logger.info(`T2V tasks:`, Array.from(qwenT2VTasksMap.keys()));
      logger.info(`I2V tasks:`, Array.from(qwenI2VTasksMap.keys()));
      
      // 获取所有 TTS 任务
      for (const [taskId, task] of ttsTasksMap.entries()) {
        allTasks.push({
          id: task.id,
          type: 'TTS',
          status: task.status,
          text: task.text.substring(0, 100) + (task.text.length > 100 ? '...' : ''),
          filename: task.filename,
          filePath: task.filePath,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          duration: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt
        });
      }
      
      // 获取所有 Qwen TTS 任务
      for (const [taskId, task] of qwenTtsTasksMap.entries()) {
        allTasks.push({
          id: task.id,
          type: 'Qwen TTS',
          status: task.status,
          text: task.text.substring(0, 100) + (task.text.length > 100 ? '...' : ''),
          filename: task.filename,
          filePath: task.filePath,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          duration: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt
        });
      }
      
      // 获取所有图像生成任务
      for (const [taskId, task] of imageTasksMap.entries()) {
        allTasks.push({
          id: task.id,
          type: 'Image Generation',
          status: task.status,
          text: task.prompt.substring(0, 100) + (task.prompt.length > 100 ? '...' : ''),
          filename: task.filename,
          filePath: task.filePath,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          duration: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt
        });
      }
      
      // 获取所有 Qwen T2V 任务
      for (const [taskId, task] of qwenT2VTasksMap.entries()) {
        allTasks.push({
          id: task.id,
          type: 'Qwen T2V',
          status: task.status,
          text: task.prompt.substring(0, 100) + (task.prompt.length > 100 ? '...' : ''),
          filename: task.filename,
          filePath: task.filePath,
          videoUrl: task.videoUrl,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          duration: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt
        });
      }
      
      // 获取所有 Qwen I2V 任务
      for (const [taskId, task] of qwenI2VTasksMap.entries()) {
        allTasks.push({
          id: task.id,
          type: 'Qwen I2V',
          status: task.status,
          text: task.prompt.substring(0, 100) + (task.prompt.length > 100 ? '...' : ''),
          filename: task.filename,
          filePath: task.filePath,
          videoUrl: task.videoUrl,
          imageUrl: task.imageUrl,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          duration: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt
        });
      }
      
      // 按创建时间倒序排列
      allTasks.sort((a, b) => b.createdAt - a.createdAt);
      
      return res.json({
        success: true,
        tasks: allTasks,
        summary: {
          total: allTasks.length,
          pending: allTasks.filter(t => t.status === 'pending').length,
          processing: allTasks.filter(t => t.status === 'processing').length,
          completed: allTasks.filter(t => t.status === 'completed').length,
          failed: allTasks.filter(t => t.status === 'failed').length
        }
      });
    } catch (error) {
      logger.error('Error getting tasks:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });
  
  // 任务状态页面
  router.get('/tasks/dashboard', (req: Request, res: Response) => {
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>任务状态监控 - MCP Bridge Service</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8fafc;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            border-left: 4px solid;
        }
        
        .stat-card.total { border-left-color: #6366f1; }
        .stat-card.pending { border-left-color: #f59e0b; }
        .stat-card.processing { border-left-color: #3b82f6; }
        .stat-card.completed { border-left-color: #10b981; }
        .stat-card.failed { border-left-color: #ef4444; }
        
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .stat-label {
            color: #64748b;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .controls {
            padding: 20px 30px;
            background: white;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }
        
        .refresh-btn {
            background: #4f46e5;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }
        
        .refresh-btn:hover {
            background: #4338ca;
        }
        
        .filter-select {
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .tasks-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0;
        }
        
        .tasks-table th,
        .tasks-table td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .tasks-table th {
            background: #f8fafc;
            font-weight: 600;
            color: #374151;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .tasks-table tbody tr:hover {
            background: #f8fafc;
        }
        
        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .status-pending {
            background: #fef3c7;
            color: #92400e;
        }
        
        .status-processing {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .status-completed {
            background: #d1fae5;
            color: #065f46;
        }
        
        .status-failed {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .task-text {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .task-type {
            font-weight: 600;
            color: #4f46e5;
        }
        
        .duration {
            color: #64748b;
            font-size: 0.9rem;
        }
        
        .error-text {
            color: #dc2626;
            font-size: 0.9rem;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #64748b;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #64748b;
        }
        
        .empty-state h3 {
            margin-bottom: 10px;
            color: #374151;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .stats {
                grid-template-columns: repeat(2, 1fr);
                padding: 20px;
            }
            
            .controls {
                flex-direction: column;
                align-items: stretch;
            }
            
            .tasks-table {
                font-size: 0.9rem;
            }
            
            .tasks-table th,
            .tasks-table td {
                padding: 10px 8px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 任务状态监控</h1>
            <p>MCP Bridge Service - 实时任务管理面板</p>
        </div>
        
        <div class="stats" id="stats">
            <div class="stat-card total">
                <div class="stat-number" id="total-count">-</div>
                <div class="stat-label">总任务数</div>
            </div>
            <div class="stat-card pending">
                <div class="stat-number" id="pending-count">-</div>
                <div class="stat-label">等待中</div>
            </div>
            <div class="stat-card processing">
                <div class="stat-number" id="processing-count">-</div>
                <div class="stat-label">处理中</div>
            </div>
            <div class="stat-card completed">
                <div class="stat-number" id="completed-count">-</div>
                <div class="stat-label">已完成</div>
            </div>
            <div class="stat-card failed">
                <div class="stat-number" id="failed-count">-</div>
                <div class="stat-label">失败</div>
            </div>
        </div>
        
        <div class="controls">
            <div>
                <button class="refresh-btn" onclick="loadTasks()">🔄 刷新数据</button>
                <span id="last-update" style="margin-left: 15px; color: #64748b; font-size: 0.9rem;"></span>
            </div>
            <div>
                <select class="filter-select" id="status-filter" onchange="filterTasks()">
                    <option value="all">所有状态</option>
                    <option value="pending">等待中</option>
                    <option value="processing">处理中</option>
                    <option value="completed">已完成</option>
                    <option value="failed">失败</option>
                </select>
                <select class="filter-select" id="type-filter" onchange="filterTasks()" style="margin-left: 10px;">
                    <option value="all">所有类型</option>
                    <option value="TTS">TTS</option>
                    <option value="Qwen TTS">Qwen TTS</option>
                    <option value="Image Generation">图像生成</option>
                    <option value="Qwen T2V">文生视频</option>
                    <option value="Qwen I2V">图生视频</option>
                </select>
            </div>
        </div>
        
        <div id="tasks-container">
            <div class="loading">📊 正在加载任务数据...</div>
        </div>
    </div>
    
    <script>
        let allTasks = [];
        
        function formatTime(timestamp) {
            return new Date(timestamp).toLocaleString('zh-CN');
        }
        
        function formatDuration(ms) {
            if (ms < 1000) return ms + 'ms';
            if (ms < 60000) return Math.round(ms / 1000) + 's';
            return Math.round(ms / 60000) + 'm';
        }
        
        function getStatusBadge(status) {
            const statusMap = {
                'pending': { class: 'status-pending', text: '等待中' },
                'processing': { class: 'status-processing', text: '处理中' },
                'completed': { class: 'status-completed', text: '已完成' },
                'failed': { class: 'status-failed', text: '失败' }
            };
            const config = statusMap[status] || { class: 'status-pending', text: status };
            return \`<span class="status-badge \${config.class}">\${config.text}</span>\`;
        }
        
        function updateStats(summary) {
            document.getElementById('total-count').textContent = summary.total;
            document.getElementById('pending-count').textContent = summary.pending;
            document.getElementById('processing-count').textContent = summary.processing;
            document.getElementById('completed-count').textContent = summary.completed;
            document.getElementById('failed-count').textContent = summary.failed;
        }
        
        function renderTasks(tasks) {
            const container = document.getElementById('tasks-container');
            
            if (tasks.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <h3>📭 暂无任务</h3>
                        <p>当前没有任何任务记录</p>
                    </div>
                \`;
                return;
            }
            
            const tableHTML = \`
                <table class="tasks-table">
                    <thead>
                        <tr>
                            <th>任务ID</th>
                            <th>类型</th>
                            <th>状态</th>
                            <th>文本内容</th>
                            <th>文件名</th>
                            <th>创建时间</th>
                            <th>耗时</th>
                            <th>错误信息</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${tasks.map(task => \`
                            <tr>
                                <td><code>\${task.id}</code></td>
                                <td><span class="task-type">\${task.type}</span></td>
                                <td>\${getStatusBadge(task.status)}</td>
                                <td><div class="task-text" title="\${task.text}">\${task.text}</div></td>
                                <td><code>\${task.filename || '-'}</code></td>
                                <td>\${formatTime(task.createdAt)}</td>
                                <td><span class="duration">\${formatDuration(task.duration)}</span></td>
                                <td>\${task.error ? \`<div class="error-text" title="\${task.error}">\${task.error}</div>\` : '-'}</td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
            
            container.innerHTML = tableHTML;
        }
        
        function filterTasks() {
            const statusFilter = document.getElementById('status-filter').value;
            const typeFilter = document.getElementById('type-filter').value;
            
            let filteredTasks = allTasks;
            
            if (statusFilter !== 'all') {
                filteredTasks = filteredTasks.filter(task => task.status === statusFilter);
            }
            
            if (typeFilter !== 'all') {
                filteredTasks = filteredTasks.filter(task => task.type === typeFilter);
            }
            
            renderTasks(filteredTasks);
        }
        
        async function loadTasks() {
            try {
                const response = await fetch('/api/tasks');
                const data = await response.json();
                
                if (data.success) {
                    allTasks = data.tasks;
                    updateStats(data.summary);
                    filterTasks();
                    
                    document.getElementById('last-update').textContent = 
                        \`最后更新: \${new Date().toLocaleTimeString('zh-CN')}\`;
                } else {
                    throw new Error(data.error || '获取任务数据失败');
                }
            } catch (error) {
                console.error('Error loading tasks:', error);
                document.getElementById('tasks-container').innerHTML = \`
                    <div class="empty-state">
                        <h3>❌ 加载失败</h3>
                        <p>\${error.message}</p>
                        <button class="refresh-btn" onclick="loadTasks()" style="margin-top: 15px;">重试</button>
                    </div>
                \`;
            }
        }
        
        // 初始加载
        loadTasks();
        
        // 自动刷新（每30秒）
        setInterval(loadTasks, 30000);
    </script>
</body>
</html>
    `);
  });

  // 简化的图像生成端点（向后兼容）
  router.post('/image', async (req: Request, res: Response) => {
    try {
      const { prompt, logseqPath, filename, type = 'text-to-image' } = req.body;
      
      if (!prompt || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: prompt, logseqPath, filename'
        });
      }
      
      // 获取API配置
      const apiConfig = configManager.getApiConfig();
      const config = {
        model: apiConfig.imageModel || 'dall-e-3',
        size: '1024x1024',
        quality: 'standard',
        responseFormat: 'b64_json',
        imageApiKey: apiConfig.imageApiKey,
        imageApiAddress: apiConfig.imageApiAddress
      };
      
      // 生成任务ID
      const taskId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建任务记录
      const task = {
        id: taskId,
        status: 'pending' as const,
        type,
        prompt,
        config,
        logseqPath,
        filename,
        createdAt: Date.now()
      };
      
      imageTasksMap.set(taskId, task);
      
      logger.info(`Created direct image generation task: ${taskId}`);
      
      // 同步处理任务
      try {
        await processImageTask(taskId);
        const completedTask = imageTasksMap.get(taskId);
        
        if (completedTask?.status === 'completed') {
          return res.json({
            success: true,
            taskId,
            filePath: completedTask.filePath,
            message: 'Image generated successfully'
          });
        } else {
          return res.status(500).json({
            success: false,
            error: completedTask?.error || 'Image generation failed'
          });
        }
      } catch (error) {
        logger.error(`Error processing direct image task ${taskId}:`, error);
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } catch (error) {
      logger.error('Error in direct image generation:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 创建异步图像生成任务
  router.post('/image/create-task', async (req: Request, res: Response) => {
    try {
      // 支持两种请求格式：
      // 1. 新格式：{ type, prompt, config, inputImages, maskImage, logseqPath, filename }
      // 2. 插件格式：{ type, prompt, imagePath, maskPath, assetsPath }
      let { type, prompt, config, inputImages, maskImage, logseqPath, filename } = req.body;
      const { imagePath, maskPath, assetsPath } = req.body;
      
      // 如果是插件格式，转换为新格式
       if (imagePath && assetsPath && !inputImages && !logseqPath) {
         // 处理图片路径：转换相对路径为绝对路径，然后转换为Base64
         let processedImagePath = imagePath;
         if (!isValidUrl(imagePath)) {
           // 处理 Logseq 相对路径格式
           let fullImagePath = imagePath;
           if (imagePath.startsWith('../assets/')) {
             fullImagePath = path.join(assetsPath, imagePath.replace('../assets/', ''));
           } else if (imagePath.startsWith('./assets/')) {
             fullImagePath = path.join(assetsPath, imagePath.replace('./assets/', ''));
           } else if (imagePath.startsWith('assets/')) {
             fullImagePath = path.join(path.dirname(assetsPath), imagePath);
           } else if (!path.isAbsolute(imagePath)) {
             fullImagePath = path.join(assetsPath, imagePath);
           }
           
           logger.info(`Processing image path: ${imagePath} -> ${fullImagePath}`);
           
           if (fs.existsSync(fullImagePath)) {
             try {
               const imageBuffer = fs.readFileSync(fullImagePath);
               const imageBase64 = imageBuffer.toString('base64');
               const mimeType = fullImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
               processedImagePath = `data:${mimeType};base64,${imageBase64}`;
               logger.info(`Converted local image to Base64: ${fullImagePath}`);
             } catch (error) {
               logger.error(`Failed to read local image file: ${fullImagePath}`, error);
               return res.status(400).json({
                 success: false,
                 error: `Failed to read image file: ${fullImagePath}`
               });
             }
           } else {
             logger.error(`Image file not found: ${fullImagePath}`);
             return res.status(400).json({
               success: false,
               error: `Image file not found: ${fullImagePath}`
             });
           }
         }
         
         // 处理遮罩图片路径
         let processedMaskPath = maskPath;
         if (maskPath && !isValidUrl(maskPath)) {
           // 处理 Logseq 相对路径格式
           let fullMaskPath = maskPath;
           if (maskPath.startsWith('../assets/')) {
             fullMaskPath = path.join(assetsPath, maskPath.replace('../assets/', ''));
           } else if (maskPath.startsWith('./assets/')) {
             fullMaskPath = path.join(assetsPath, maskPath.replace('./assets/', ''));
           } else if (maskPath.startsWith('assets/')) {
             fullMaskPath = path.join(path.dirname(assetsPath), maskPath);
           } else if (!path.isAbsolute(maskPath)) {
             fullMaskPath = path.join(assetsPath, maskPath);
           }
           
           logger.info(`Processing mask path: ${maskPath} -> ${fullMaskPath}`);
           
           if (fs.existsSync(fullMaskPath)) {
             try {
               const maskBuffer = fs.readFileSync(fullMaskPath);
               const maskBase64 = maskBuffer.toString('base64');
               const mimeType = fullMaskPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
               processedMaskPath = `data:${mimeType};base64,${maskBase64}`;
               logger.info(`Converted local mask to Base64: ${fullMaskPath}`);
             } catch (error) {
               logger.error(`Failed to read local mask file: ${fullMaskPath}`, error);
               return res.status(400).json({
                 success: false,
                 error: `Failed to read mask file: ${fullMaskPath}`
               });
             }
           } else {
             logger.error(`Mask file not found: ${fullMaskPath}`);
             return res.status(400).json({
               success: false,
               error: `Mask file not found: ${fullMaskPath}`
             });
           }
         }
         
         inputImages = [processedImagePath];
         maskImage = processedMaskPath || null;
         logseqPath = assetsPath;
         filename = filename || `edited_${Date.now()}.png`;
         
         // 获取API配置中的默认模型
         const apiConfig = configManager.getApiConfig();
         const defaultEditModel = apiConfig.imageEditModel || 'qwen-image-edit';
         
         // 设置默认配置
         config = config || {
           model: defaultEditModel,
           editModel: defaultEditModel,
           editSize: apiConfig.imageEditSize || '512x512',
           editQuality: apiConfig.imageEditQuality || 'standard',
           editCount: parseInt(apiConfig.imageEditCount || '1'),
           responseFormat: apiConfig.imageEditResponseFormat || 'url'
         };
       }
      
      if (!type || !prompt || !config || !logseqPath || !filename) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters. Need either: (type, prompt, config, logseqPath, filename) or (type, prompt, imagePath, assetsPath)'
        });
      }
      
      // 验证任务类型
      if (!['text-to-image', 'image-to-image', 'image-edit'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid task type. Must be one of: text-to-image, image-to-image, image-edit'
        });
      }
      
      // 生成任务ID
      const taskId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建任务记录
      const task = {
        id: taskId,
        status: 'pending' as const,
        type,
        prompt,
        config,
        inputImages,
        maskImage,
        logseqPath,
        filename,
        createdAt: Date.now(),
        // 记录提交信息
        submissionInfo: {
          userAgent: req.headers['user-agent'] || 'Unknown',
          clientIp: req.ip || req.connection.remoteAddress || 'Unknown',
          requestHeaders: {
            'content-type': req.headers['content-type'] || '',
            'accept': req.headers['accept'] || '',
            'origin': req.headers['origin'] || ''
          },
          submittedAt: Date.now()
        },
        // 初始化处理步骤
        processSteps: [
          {
            step: '任务创建',
            status: 'completed' as const,
            startTime: Date.now(),
            endTime: Date.now(),
            details: { taskType: type, prompt: prompt.substring(0, 100) }
          },
          {
            step: '参数验证',
            status: 'completed' as const,
            startTime: Date.now(),
            endTime: Date.now(),
            details: { configModel: config.model, filename }
          },
          {
            step: '云端API调用',
            status: 'pending' as const,
            startTime: Date.now()
          }
        ]
      };
      
      imageTasksMap.set(taskId, task);
      
      logger.info(`Created image generation task: ${taskId}, type: ${type}`);
      
      // 立即开始处理任务（异步）
      logger.info(`Starting to process image task: ${taskId}`);
      processImageTask(taskId).catch(error => {
        logger.error(`Error processing image task ${taskId}:`, error);
        logger.error(`Error stack:`, error.stack);
        const task = imageTasksMap.get(taskId);
        if (task) {
          task.status = 'failed';
          task.error = error.message;
          
          // 更新处理步骤状态
          if (task.processSteps) {
            // 找到当前正在处理的步骤并标记为失败
            const processingStep = task.processSteps.find(step => step.status === 'processing');
            if (processingStep) {
              processingStep.status = 'failed';
              processingStep.endTime = Date.now();
              processingStep.details = { error: error.message };
            }
          }
        }
      });
      
      return res.json({
        success: true,
        taskId,
        status: 'pending',
        message: 'Image generation task created and processing started'
      });
    } catch (error) {
      logger.error('Error creating image task:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 查询图像生成任务状态
  router.get('/image/task/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = imageTasksMap.get(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      return res.json({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          type: task.type,
          filename: task.filename,
          filePath: task.filePath,
          error: task.error,
          createdAt: task.createdAt,
          completedAt: task.completedAt
        }
      });
    } catch (error) {
      logger.error('Error getting image task status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 图像生成任务处理函数
  async function processImageTask(taskId: string): Promise<void> {
    const task = imageTasksMap.get(taskId);
    if (!task) {
      logger.error(`Image task ${taskId} not found`);
      return;
    }

    try {
      task.status = 'processing';
      
      // 更新处理步骤：开始云端API调用
      if (task.processSteps) {
        const apiCallStep = task.processSteps.find(step => step.step === '云端API调用');
        if (apiCallStep) {
          apiCallStep.status = 'processing';
          apiCallStep.startTime = Date.now();
        }
      }
      
      logger.info(`Processing image task ${taskId}, type: ${task.type}`);

      // 获取图像API配置（优先使用任务配置，回退到配置管理器）
      const apiConfig = configManager.getApiConfig();
      const imageApiAddress = task.config.imageApiAddress || apiConfig.imageApiAddress;
      const imageApiKey = task.config.imageApiKey || apiConfig.imageApiKey;
      const imageModel = task.config.model || apiConfig.imageModel || 'qwen-image';
      const requestTimeout = (apiConfig.requestTimeout || 30) * 1000; // 转换为毫秒
      
      // 如果没有配置API密钥，提示用户配置而不是使用测试图片
      if (!imageApiKey) {
        logger.warn('Image API key not configured');
        task.status = 'failed';
        task.error = '图像API密钥未配置。请在配置页面 (http://localhost:3000/config) 设置有效的图像API密钥后重试。\n\n当前配置状态：\n- API地址：' + imageApiAddress + '\n- API密钥：未配置\n\n请确保配置了有效的OpenAI兼容的图像生成API密钥。';
         logger.info(`Image task ${taskId} failed due to missing API key`);
         return;
        
        logger.info(`Image task ${taskId} completed with test image`);
        return;
      }
      
      let apiUrl = imageApiAddress;
      let requestBody: any;
      let headers: any = {
        'Authorization': `Bearer ${imageApiKey}`,
        'Content-Type': 'application/json'
      };

      // 根据任务类型构建不同的API请求
      switch (task.type) {
        case 'text-to-image':
          // 文生图
          if (!apiUrl.endsWith('/v1/images/generations')) {
            apiUrl = apiUrl.replace(/\/$/, '') + '/v1/images/generations';
          }
          requestBody = {
            model: task.config.model || imageModel,
            prompt: task.prompt,
            n: 1,
            size: task.config.size || "1024x1024",
            quality: task.config.quality || "standard",
            response_format: task.config.responseFormat || "url"
          };
          break;

        case 'image-to-image':
          // 图生图
          if (!apiUrl.endsWith('/v1/images/generations')) {
            apiUrl = apiUrl.replace(/\/$/, '') + '/v1/images/generations';
          }
          requestBody = {
            model: task.config.model || imageModel,
            prompt: task.prompt,
            image: task.inputImages?.[0], // 使用第一张输入图片
            n: 1,
            size: task.config.size || "1024x1024",
            response_format: task.config.responseFormat || "url"
          };
          break;

        case 'image-edit':
          // 图片编辑 - 支持多种模型
          const apiConfig = configManager.getApiConfig();
          const defaultEditModel = apiConfig.imageEditModel || 'qwen-image-edit';
          const editModel = task.config.editModel || task.config.model || defaultEditModel;
          
          if (editModel === 'qwen-image-edit') {
            // 使用DashScope HTTP API处理qwen-image-edit
            const config = configManager.getConfig();
            const dashscopeApiKey = config.api.dashscopeApiKey;
            
            if (!dashscopeApiKey) {
              throw new Error('DashScope API Key未配置，请在配置中设置dashscopeApiKey');
            }
            
            // 处理输入图片 - qwen-image-edit支持Base64格式
            let imageData = '';
            if (task.inputImages?.[0]) {
              const inputImage = task.inputImages[0];
              if (inputImage.startsWith('data:image/') || isValidUrl(inputImage)) {
                // qwen-image-edit支持Base64和URL格式
                imageData = inputImage;
              } else {
                throw new Error('Invalid image format. Must be Base64 data URL or valid HTTP URL.');
              }
            } else {
              throw new Error('输入图片是必需的');
            }
            
            // 构建请求参数 - 使用正确的qwen-image-edit API格式
            const requestParams = {
              model: editModel,
              input: {
                messages: [{
                  role: 'user',
                  content: [
                    { image: imageData },
                    { text: task.prompt || '高质量图片' }
                  ]
                }]
              },
              parameters: {
                negative_prompt: '',
                watermark: false
              }
            };
            
            logger.info('调用DashScope图片编辑API:', {
              model: requestParams.model,
              prompt: requestParams.input.messages[0].content[1].text
            });
            
            // 记录云端请求信息
            const apiEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
            const requestHeaders = {
              'Authorization': `Bearer ${dashscopeApiKey}`,
              'Content-Type': 'application/json'
            };
            
            task.cloudRequestInfo = {
              apiEndpoint,
              requestMethod: 'POST',
              requestHeaders: {
                'Content-Type': requestHeaders['Content-Type'],
                'Authorization': 'Bearer [HIDDEN]'
              },
              requestBody: {
                model: requestParams.model,
                prompt: requestParams.input.messages[0].content[1].text,
                parameters: requestParams.parameters
              },
              sentAt: Date.now()
            };
            
            // 调用DashScope HTTP API - 使用正确的multimodal-generation端点
            const requestStartTime = Date.now();
            const response = await fetch(apiEndpoint, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify(requestParams)
            });
            
            const result = await response.json() as any;
            const requestEndTime = Date.now();
            
            // 记录云端响应信息
            task.cloudResponseInfo = {
              statusCode: response.status,
              responseHeaders: {
                'content-type': response.headers.get('content-type') || '',
                'content-length': response.headers.get('content-length') || ''
              },
              responseBody: {
                success: !!result.output?.choices?.[0]?.message?.content?.[0]?.image,
                hasImage: !!result.output?.choices?.[0]?.message?.content?.[0]?.image,
                errorCode: result.code,
                errorMessage: result.message
              },
              receivedAt: requestEndTime,
              processingTime: requestEndTime - requestStartTime
            };
            
            logger.info('DashScope API响应:', {
              status: response.status,
              statusText: response.statusText,
              result: JSON.stringify(result, null, 2)
            });
            
            if (result.output?.choices?.[0]?.message?.content?.[0]?.image) {
              // 更新处理步骤：云端API调用完成
              if (task.processSteps) {
                const apiCallStep = task.processSteps.find(step => step.step === '云端API调用');
                if (apiCallStep) {
                  apiCallStep.status = 'completed';
                  apiCallStep.endTime = Date.now();
                  apiCallStep.details = { imageUrl: result.output.choices[0].message.content[0].image };
                }
                
                // 添加图片下载步骤
                task.processSteps.push({
                  step: '图片下载',
                  status: 'processing',
                  startTime: Date.now()
                });
              }
              
              // qwen-image-edit返回的是图片URL
              const imageUrl = result.output.choices[0].message.content[0].image;
              const imageBuffer = await downloadImage(imageUrl, 5, requestTimeout);
              
              // 更新处理步骤：图片下载完成
              if (task.processSteps) {
                const downloadStep = task.processSteps.find(step => step.step === '图片下载');
                if (downloadStep) {
                  downloadStep.status = 'completed';
                  downloadStep.endTime = Date.now();
                  downloadStep.details = { imageSize: imageBuffer.length };
                }
                
                // 添加文件保存步骤
                task.processSteps.push({
                  step: '文件保存',
                  status: 'processing',
                  startTime: Date.now()
                });
              }
              
              // 生成文件名
              const timestamp = Date.now();
              const filename = task.filename || `qwen_edit_${timestamp}.jpg`;
              const filepath = path.join('/tmp', filename);
              
              // 保存图片
              fs.writeFileSync(filepath, imageBuffer);
              
              // 更新处理步骤：文件保存完成
              if (task.processSteps) {
                const saveStep = task.processSteps.find(step => step.step === '文件保存');
                if (saveStep) {
                  saveStep.status = 'completed';
                  saveStep.endTime = Date.now();
                  saveStep.details = { filepath, filename, fileSize: imageBuffer.length };
                }
              }
              
              // 更新任务状态
              task.status = 'completed';
              task.filePath = `http://localhost:3000/images/${filename}`;
              task.completedAt = Date.now();
              
              logger.info('qwen-image-edit任务完成:', {
                taskId: task.id,
                filename: filename,
                imageUrl: imageUrl
              });
              
              return;
            } else {
              logger.error('DashScope API返回结果异常:', {
                response: result,
                expectedPath: 'result.output.choices[0].message.content[0].image'
              });
              throw new Error(`DashScope API返回结果异常: ${JSON.stringify(result)}`);
            }
          } else if (editModel === 'gpt-image-1') {
            // 使用comfly.chat API处理gpt-image-1
            if (!apiUrl.endsWith('/v1/images/edits')) {
              apiUrl = apiUrl.replace(/\/$/, '') + '/v1/images/edits';
            }
            
            // gpt-image-1使用与dall-e-2相同的API格式
            const FormData = require('form-data');
            const formData = new FormData();
            
            // 添加必需参数
            formData.append('prompt', task.prompt);
            formData.append('model', editModel);
            formData.append('n', (task.config.editCount || 1).toString());
            formData.append('response_format', task.config.responseFormat || 'url');
            
            // 添加可选参数
            if (task.config.editSize && task.config.editSize !== 'auto') {
              formData.append('size', task.config.editSize);
            }
            if (task.config.editQuality && task.config.editQuality !== 'auto') {
              formData.append('quality', task.config.editQuality);
            }
            
            // 处理输入图片（支持Base64和URL）
            if (task.inputImages?.[0]) {
              const imageData = task.inputImages[0];
              if (imageData.startsWith('data:image/')) {
                // Base64格式
                const base64Data = imageData.split(',')[1];
                const imageBuffer = Buffer.from(base64Data, 'base64');
                formData.append('image', imageBuffer, 'image.jpg');
              } else if (isValidUrl(imageData)) {
                // URL格式，需要下载图片
                const imageBuffer = await downloadImage(imageData, 5, requestTimeout);
                formData.append('image', imageBuffer, 'image.jpg');
              } else {
                throw new Error('Invalid image format. Must be Base64 data URL or valid HTTP URL.');
              }
            }
            
            // 处理遮罩图片
            if (task.maskImage) {
              if (task.maskImage.startsWith('data:image/')) {
                // Base64格式
                const base64Data = task.maskImage.split(',')[1];
                const maskBuffer = Buffer.from(base64Data, 'base64');
                formData.append('mask', maskBuffer, 'mask.jpg');
              } else if (isValidUrl(task.maskImage)) {
                // URL格式，需要下载图片
                const maskBuffer = await downloadImage(task.maskImage, 5, requestTimeout);
                formData.append('mask', maskBuffer, 'mask.jpg');
              } else {
                throw new Error('Invalid mask image format. Must be Base64 data URL or valid HTTP URL.');
              }
            }
            
            const gptHeaders = {
              'Authorization': `Bearer ${imageApiKey}`,
              ...formData.getHeaders()
            };
            
            logger.info('调用gpt-image-1图片编辑API:', {
              model: editModel,
              prompt: task.prompt,
              apiUrl: apiUrl
            });
            
            // 调用gpt-image-1 API
            const gptResponseData = await sendFormDataRequest(apiUrl, formData, gptHeaders);
            
            logger.info('gpt-image-1 API响应:', gptResponseData);
            
            // 提取图片URL或Base64数据
            let imageUrl: string;
            let imageBase64: string | null = null;
            
            if (gptResponseData.data && gptResponseData.data[0]) {
              if (gptResponseData.data[0].url) {
                imageUrl = gptResponseData.data[0].url;
              } else if (gptResponseData.data[0].b64_json) {
                imageBase64 = gptResponseData.data[0].b64_json;
                imageUrl = 'base64_data'; // 标记为base64数据
              } else {
                logger.error('gpt-image-1 API响应格式错误:', gptResponseData);
                throw new Error('gpt-image-1 API响应格式错误：未找到图片URL或Base64数据');
              }
            } else if (gptResponseData.url) {
              imageUrl = gptResponseData.url;
            } else if (gptResponseData.b64_json) {
              imageBase64 = gptResponseData.b64_json;
              imageUrl = 'base64_data'; // 标记为base64数据
            } else {
              logger.error('gpt-image-1 API响应格式错误:', gptResponseData);
              throw new Error('gpt-image-1 API响应格式错误：未找到图片URL或Base64数据');
            }
            
            // 更新处理步骤：云端API调用完成
            if (task.processSteps) {
              const apiCallStep = task.processSteps.find(step => step.step === '云端API调用');
              if (apiCallStep) {
                apiCallStep.status = 'completed';
                apiCallStep.endTime = Date.now();
                apiCallStep.details = { imageUrl: imageBase64 ? 'base64_data' : imageUrl };
              }
              
              // 添加图片处理步骤
              task.processSteps.push({
                step: imageBase64 ? '图片解码' : '图片下载',
                status: 'processing',
                startTime: Date.now()
              });
            }
            
            // 获取图片数据
            let imageBuffer: Buffer;
            if (imageBase64) {
              // 处理Base64数据
              imageBuffer = Buffer.from(imageBase64, 'base64');
            } else {
              // 下载图片
              imageBuffer = await downloadImage(imageUrl, 5, requestTimeout);
            }
            
            // 更新处理步骤：图片处理完成
            if (task.processSteps) {
              const processStep = task.processSteps.find(step => step.step === '图片解码' || step.step === '图片下载');
              if (processStep) {
                processStep.status = 'completed';
                processStep.endTime = Date.now();
                processStep.details = { imageSize: imageBuffer.length };
              }
              
              // 添加文件保存步骤
              task.processSteps.push({
                step: '文件保存',
                status: 'processing',
                startTime: Date.now()
              });
            }
            
            // 生成文件名
            const timestamp = Date.now();
            const filename = task.filename || `gpt_edit_${timestamp}.jpg`;
            const filepath = path.join('/tmp', filename);
            
            // 保存图片
            fs.writeFileSync(filepath, imageBuffer);
            
            // 更新处理步骤：文件保存完成
            if (task.processSteps) {
              const saveStep = task.processSteps.find(step => step.step === '文件保存');
              if (saveStep) {
                saveStep.status = 'completed';
                saveStep.endTime = Date.now();
                saveStep.details = { filepath, filename, fileSize: imageBuffer.length };
              }
            }
            
            // 更新任务状态
            task.status = 'completed';
            task.filePath = `http://localhost:3000/images/${filename}`;
            task.completedAt = Date.now();
            
            logger.info('gpt-image-1任务完成:', {
              taskId: task.id,
              filename: filename,
              imageUrl: imageUrl
            });
            
            return;
          } else {
            // 默认使用dall-e-2格式（兼容性）
            if (!apiUrl.endsWith('/v1/images/edits')) {
              apiUrl = apiUrl.replace(/\/$/, '') + '/v1/images/edits';
            }
            
            const FormData = require('form-data');
            const formData = new FormData();
            
            // 添加必需参数
            formData.append('prompt', task.prompt);
            formData.append('model', editModel);
            formData.append('n', (task.config.editCount || 1).toString());
            formData.append('response_format', task.config.responseFormat || 'url');
            
            // 添加可选参数
            if (task.config.editSize && task.config.editSize !== 'auto') {
              formData.append('size', task.config.editSize);
            }
            if (task.config.editQuality && task.config.editQuality !== 'auto') {
              formData.append('quality', task.config.editQuality);
            }
            
            // 处理输入图片（支持Base64和URL）
            if (task.inputImages?.[0]) {
              const imageData = task.inputImages[0];
              if (imageData.startsWith('data:image/')) {
                // Base64格式
                const base64Data = imageData.split(',')[1];
                const imageBuffer = Buffer.from(base64Data, 'base64');
                formData.append('image', imageBuffer, 'image.jpg');
              } else if (isValidUrl(imageData)) {
                // URL格式，需要下载图片
                const imageBuffer = await downloadImage(imageData, 5, requestTimeout);
                formData.append('image', imageBuffer, 'image.jpg');
              } else {
                throw new Error('Invalid image format. Must be Base64 data URL or valid HTTP URL.');
              }
            }
            
            // 处理遮罩图片
            if (task.maskImage) {
              if (task.maskImage.startsWith('data:image/')) {
                // Base64格式
                const base64Data = task.maskImage.split(',')[1];
                const maskBuffer = Buffer.from(base64Data, 'base64');
                formData.append('mask', maskBuffer, 'mask.jpg');
              } else if (isValidUrl(task.maskImage)) {
                // URL格式，需要下载图片
                const maskBuffer = await downloadImage(task.maskImage, 5, requestTimeout);
                formData.append('mask', maskBuffer, 'mask.jpg');
              } else {
                throw new Error('Invalid mask image format. Must be Base64 data URL or valid HTTP URL.');
              }
            }
            
            headers = {
              'Authorization': `Bearer ${imageApiKey}`,
              ...formData.getHeaders()
            };
            requestBody = formData;
          }
          break;

        default:
          throw new Error(`Unsupported task type: ${task.type}`);
      }

      // 调用真实的图像生成API
      let imageUrl: string | undefined;
      
      logger.info(`Making API request to: ${apiUrl}`);
      logger.info(`Using API key: ${imageApiKey.substring(0, 8)}...`);
      logger.info(`Request body:`, task.type === 'image-edit' ? '[FormData]' : requestBody);
      
      let responseData: any;
      
      if (task.type === 'image-edit') {
        // 对于图片编辑，使用 FormData 和 https 模块
        responseData = await sendFormDataRequest(apiUrl, requestBody as any, headers);
      } else {
        // 对于其他类型，使用 JSON 请求
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(requestTimeout) // 使用配置的超时时间
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Image API error: ${response.status} ${response.statusText}`);
          logger.error(`Error response: ${errorText}`);
          throw new Error(`图像生成API调用失败 (${response.status}): ${errorText}`);
        }
        
        responseData = await response.json();
      }
      logger.info('Image API response:', responseData);
      
      // 提取图片数据（支持URL和base64格式）
      let imageData: string | Buffer;
      let isBase64 = false;
      
      if (responseData.data && responseData.data[0]) {
        if (responseData.data[0].url) {
          imageData = responseData.data[0].url;
          imageUrl = imageData as string;
        } else if (responseData.data[0].b64_json) {
          imageData = Buffer.from(responseData.data[0].b64_json, 'base64');
          isBase64 = true;
        } else {
          logger.error('Invalid API response format:', responseData);
          throw new Error('API响应格式错误：未找到图片URL或base64数据');
        }
      } else if (responseData.url) {
        imageData = responseData.url;
        imageUrl = imageData as string;
      } else if (responseData.b64_json) {
        imageData = Buffer.from(responseData.b64_json, 'base64');
        isBase64 = true;
      } else {
        logger.error('Invalid API response format:', responseData);
        throw new Error('API响应格式错误：未找到图片URL或base64数据');
      }
      
      if (isBase64) {
        logger.info('Received base64 image data, saving directly to file');
      } else {
        logger.info(`Generated image URL: ${imageUrl}`);
      }
      
      // 保存图片
      const fullFilePath = path.join('/tmp', task.filename);
      
      // 确保目录存在
      const dir = path.dirname(fullFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 更新处理步骤：云端API调用完成
      if (task.processSteps) {
        const apiCallStep = task.processSteps.find(step => step.step === '云端API调用');
        if (apiCallStep) {
          apiCallStep.status = 'completed';
          apiCallStep.endTime = Date.now();
          apiCallStep.details = { 
            responseFormat: isBase64 ? 'base64' : 'url',
            imageUrl: isBase64 ? undefined : imageUrl
          };
        }
        
        // 添加文件保存步骤
        task.processSteps.push({
          step: isBase64 ? '文件保存' : '图片下载',
          status: 'processing',
          startTime: Date.now()
        });
      }

      if (isBase64) {
        // 直接保存base64数据
        try {
          fs.writeFileSync(fullFilePath, imageData as Buffer);
          logger.info(`Base64 image saved to: ${fullFilePath}`);
          
          // 更新处理步骤：文件保存完成
          if (task.processSteps) {
            const saveStep = task.processSteps.find(step => step.step === '文件保存');
            if (saveStep) {
              saveStep.status = 'completed';
              saveStep.endTime = Date.now();
              saveStep.details = { 
                filepath: fullFilePath, 
                filename: task.filename, 
                fileSize: (imageData as Buffer).length 
              };
            }
          }
        } catch (error) {
          throw new Error(`Failed to save base64 image: ${error}`);
        }
      } else {
        // 下载URL图片
        const downloadResult = await downloadFile(imageUrl!, fullFilePath);
        
        if (!downloadResult.success) {
          throw new Error(`Failed to download image: ${downloadResult.error}`);
        }
        
        // 更新处理步骤：图片下载完成
        if (task.processSteps) {
          const downloadStep = task.processSteps.find(step => step.step === '图片下载');
          if (downloadStep) {
            downloadStep.status = 'completed';
            downloadStep.endTime = Date.now();
            const stats = fs.statSync(fullFilePath);
            downloadStep.details = { 
              filepath: fullFilePath, 
              filename: task.filename, 
              fileSize: stats.size 
            };
          }
        }
      }

      // 更新任务状态
      task.status = 'completed';
      task.filePath = `http://localhost:3000/images/${task.filename}`;
      task.completedAt = Date.now();
      
      logger.info(`Image task ${taskId} completed successfully`);
      
    } catch (error) {
      logger.error(`Image task ${taskId} failed:`, error);
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  // 获取配置
  router.get('/api-config', (req: Request, res: Response) => {
    try {
      const apiConfig = configManager.getApiConfig();
      const config = {
        imageApiAddress: apiConfig.imageApiAddress,
        imageApiKey: apiConfig.imageApiKey ? '***' + apiConfig.imageApiKey.slice(-4) : '',
        imageModel: apiConfig.imageModel,
        imageEditModel: apiConfig.imageEditModel,
        imageEditQuality: apiConfig.imageEditQuality,
        imageEditResponseFormat: apiConfig.imageEditResponseFormat,
        imageEditSize: apiConfig.imageEditSize,
        imageEditCount: apiConfig.imageEditCount,
        ttsApiAddress: apiConfig.ttsApiAddress,
        ttsApiKey: apiConfig.ttsApiKey ? '***' + apiConfig.ttsApiKey.slice(-4) : '',
        ttsModel: apiConfig.ttsModel,
        ttsVoice: apiConfig.ttsVoice,
        ttsResponseFormat: apiConfig.ttsResponseFormat,
        ttsSpeed: apiConfig.ttsSpeed,
        dashscopeApiKey: apiConfig.dashscopeApiKey ? '***' + apiConfig.dashscopeApiKey.slice(-4) : '',
        qwenTtsModel: apiConfig.qwenTtsModel,
        qwenTtsVoice: apiConfig.qwenTtsVoice,
        qwenTtsFormat: apiConfig.qwenTtsFormat,
        logLevel: configManager.getConfig().server.logLevel,
        requestTimeout: apiConfig.requestTimeout
      };
      
      res.json({ config });
    } catch (error) {
      logger.error('Error getting config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 更新配置
  router.put('/api-config', (req: Request, res: Response) => {
    try {
      const { config } = req.body;
      
      if (!config || typeof config !== 'object') {
        res.status(400).json({ error: 'Invalid config data' });
        return;
      }
      
      // 验证配置字段
      const validFields = [
        'imageApiAddress', 'imageApiKey', 'imageModel', 'imageEditModel', 'imageEditQuality', 
        'imageEditResponseFormat', 'imageEditSize', 'imageEditCount',
        'ttsApiAddress', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsResponseFormat', 'ttsSpeed',
        'dashscopeApiKey', 'qwenTtsModel', 'qwenTtsVoice', 'qwenTtsFormat',
        'logLevel', 'requestTimeout'
      ];
      const updates: any = {};
      
      for (const field of validFields) {
        if (config[field] !== undefined) {
          updates[field] = config[field];
        }
      }
      
      // 验证URL格式
      if (updates.imageApiAddress && !isValidUrl(updates.imageApiAddress)) {
        res.status(400).json({ error: 'Invalid image API address URL' });
        return;
      }
      
      if (updates.ttsApiAddress && !isValidUrl(updates.ttsApiAddress)) {
        res.status(400).json({ error: 'Invalid TTS API address URL' });
        return;
      }
      
      // 验证日志级别
      if (updates.logLevel && !['error', 'warn', 'info', 'debug'].includes(updates.logLevel)) {
        res.status(400).json({ error: 'Invalid log level' });
        return;
      }
      
      // 验证超时时间
      if (updates.requestTimeout && (updates.requestTimeout < 1 || updates.requestTimeout > 300)) {
        res.status(400).json({ error: 'Request timeout must be between 1 and 300 seconds' });
        return;
      }
      
      // 更新API配置（持久化保存到配置文件）
      const apiUpdates: any = {};
      if (updates.imageApiAddress !== undefined) apiUpdates.imageApiAddress = updates.imageApiAddress;
      if (updates.imageApiKey !== undefined) apiUpdates.imageApiKey = updates.imageApiKey;
      if (updates.imageModel !== undefined) apiUpdates.imageModel = updates.imageModel;
      if (updates.imageEditModel !== undefined) apiUpdates.imageEditModel = updates.imageEditModel;
      if (updates.imageEditQuality !== undefined) apiUpdates.imageEditQuality = updates.imageEditQuality;
      if (updates.imageEditResponseFormat !== undefined) apiUpdates.imageEditResponseFormat = updates.imageEditResponseFormat;
      if (updates.imageEditSize !== undefined) apiUpdates.imageEditSize = updates.imageEditSize;
      if (updates.imageEditCount !== undefined) apiUpdates.imageEditCount = updates.imageEditCount;
      if (updates.ttsApiAddress !== undefined) apiUpdates.ttsApiAddress = updates.ttsApiAddress;
      if (updates.ttsApiKey !== undefined) apiUpdates.ttsApiKey = updates.ttsApiKey;
      if (updates.ttsModel !== undefined) apiUpdates.ttsModel = updates.ttsModel;
      if (updates.ttsVoice !== undefined) apiUpdates.ttsVoice = updates.ttsVoice;
      if (updates.ttsResponseFormat !== undefined) apiUpdates.ttsResponseFormat = updates.ttsResponseFormat;
      if (updates.ttsSpeed !== undefined) apiUpdates.ttsSpeed = updates.ttsSpeed;
      if (updates.dashscopeApiKey !== undefined) apiUpdates.dashscopeApiKey = updates.dashscopeApiKey;
      if (updates.qwenTtsModel !== undefined) apiUpdates.qwenTtsModel = updates.qwenTtsModel;
      if (updates.qwenTtsVoice !== undefined) apiUpdates.qwenTtsVoice = updates.qwenTtsVoice;
      if (updates.qwenTtsFormat !== undefined) apiUpdates.qwenTtsFormat = updates.qwenTtsFormat;
      if (updates.requestTimeout !== undefined) apiUpdates.requestTimeout = updates.requestTimeout;
      
      if (Object.keys(apiUpdates).length > 0) {
        configManager.updateApiConfig(apiUpdates);
      }
      
      // 更新服务器配置
      if (updates.logLevel) {
        const currentConfig = configManager.getConfig();
        currentConfig.server.logLevel = updates.logLevel;
        // 这里需要一个更新服务器配置的方法，暂时保持环境变量更新
        process.env.LOG_LEVEL = updates.logLevel;
      }
      
      logger.info('Configuration updated:', {
        imageApiAddress: updates.imageApiAddress || 'unchanged',
        imageApiKey: updates.imageApiKey ? '***' + updates.imageApiKey.slice(-4) : 'unchanged',
        ttsApiAddress: updates.ttsApiAddress || 'unchanged',
        ttsApiKey: updates.ttsApiKey ? '***' + updates.ttsApiKey.slice(-4) : 'unchanged',
        dashscopeApiKey: updates.dashscopeApiKey ? '***' + updates.dashscopeApiKey.slice(-4) : 'unchanged',
        logLevel: updates.logLevel || 'unchanged',
        requestTimeout: updates.requestTimeout || 'unchanged'
      });
      
      res.json({ 
        success: true, 
        message: 'Configuration updated successfully and saved to config file.',
        updated: Object.keys(updates)
      });
    } catch (error) {
      logger.error('Error updating config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 统一的AI能力调用接口
  router.post('/ai-capabilities/:capability', async (req: Request, res: Response) => {
    try {
      const { capability } = req.params;
      const validCapabilities: AICapabilityType[] = ['text-to-image', 'image-to-image', 'edit-image', 'text-to-speech', 'text-to-video', 'image-to-video'];
      
      if (!validCapabilities.includes(capability as AICapabilityType)) {
        return res.status(400).json({
          success: false,
          error: `Invalid capability. Must be one of: ${validCapabilities.join(', ')}`
        });
      }

      let taskId: string = '';
      
      switch (capability as AICapabilityType) {
        case 'text-to-image':
          taskId = await aiCapabilities.createTextToImageTask(req.body);
          break;
        case 'image-to-image':
          taskId = await aiCapabilities.createImageToImageTask(req.body);
          break;
        case 'edit-image':
          taskId = await aiCapabilities.createEditImageTask(req.body);
          break;
        case 'text-to-speech':
          taskId = await aiCapabilities.createTextToSpeechTask(req.body);
          break;
        case 'text-to-video':
          taskId = await aiCapabilities.createTextToVideoTask(req.body);
          break;
        case 'image-to-video':
          taskId = await aiCapabilities.createImageToVideoTask(req.body);
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Unsupported capability'
          });
      }

      return res.json({
        success: true,
        taskId,
        message: `${capability} task created successfully`
      });
    } catch (error) {
      logger.error(`Error creating ${req.params.capability} task:`, error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  });

  // 查询AI任务状态
  router.get('/ai-capabilities/task/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = aiCapabilities.getTask(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      return res.json({
        success: true,
        task: {
          id: task.id,
          type: task.type,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          error: task.error,
          result: task.result
        }
      });
    } catch (error) {
      logger.error('Error getting AI task status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 获取所有AI任务
  router.get('/ai-capabilities/tasks', (req: Request, res: Response) => {
    try {
      const { type, status } = req.query;
      let tasks = aiCapabilities.getAllTasks();
      
      // 按类型过滤
      if (type && typeof type === 'string') {
        tasks = aiCapabilities.getTasksByType(type as AICapabilityType);
      }
      
      // 按状态过滤
      if (status && typeof status === 'string') {
        tasks = tasks.filter((task: any) => task.status === status);
      }
      
      return res.json({
        success: true,
        tasks: tasks.map((task: any) => ({
          id: task.id,
          type: task.type,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          error: task.error
        }))
      });
    } catch (error) {
      logger.error('Error getting AI tasks:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // 日志管理接口
  router.get('/logs/api-calls', (req: Request, res: Response) => {
    try {
      const { limit, offset } = req.query;
      const limitNum = limit ? parseInt(limit as string) : undefined;
      const offsetNum = offset ? parseInt(offset as string) : undefined;
      
      const logs = loggingService.getAPICallLogs(limitNum, offsetNum);
      
      res.json({
        success: true,
        logs,
        total: logs.length
      });
    } catch (error) {
      logger.error('Error getting API call logs:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  router.get('/logs/task-status', (req: Request, res: Response) => {
    try {
      const { taskId, limit, offset } = req.query;
      const limitNum = limit ? parseInt(limit as string) : undefined;
      const offsetNum = offset ? parseInt(offset as string) : undefined;
      
      const logs = loggingService.getTaskStatusLogs(
        taskId as string,
        limitNum,
        offsetNum
      );
      
      res.json({
        success: true,
        logs,
        total: logs.length
      });
    } catch (error) {
      logger.error('Error getting task status logs:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  router.get('/logs/mcp-tool-calls', (req: Request, res: Response) => {
    try {
      const { serviceId, toolName, limit, offset } = req.query;
      const limitNum = limit ? parseInt(limit as string) : undefined;
      const offsetNum = offset ? parseInt(offset as string) : undefined;
      
      const logs = loggingService.getMCPToolCallLogs(
        serviceId as string,
        toolName as string,
        limitNum,
        offsetNum
      );
      
      res.json({
        success: true,
        logs,
        total: logs.length
      });
    } catch (error) {
      logger.error('Error getting MCP tool call logs:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  router.get('/logs/statistics', (req: Request, res: Response) => {
    try {
      const stats = loggingService.getStatistics();
      
      res.json({
        success: true,
        statistics: stats
      });
    } catch (error) {
      logger.error('Error getting log statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  router.post('/logs/export', (req: Request, res: Response) => {
    try {
      const { type, format } = req.body;
      
      if (!['api-calls', 'task-status', 'mcp-tool-calls', 'all'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid log type. Must be one of: api-calls, task-status, mcp-tool-calls, all'
        });
      }
      
      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid format. Must be json or csv'
        });
      }
      
      const exportData = loggingService.exportLogs(type, format);
      
      const filename = `logs-${type}-${new Date().toISOString().split('T')[0]}.${format}`;
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
      
      return res.send(exportData);
    } catch (error) {
      logger.error('Error exporting logs:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  router.delete('/logs/cleanup', (req: Request, res: Response) => {
    try {
      const { daysToKeep } = req.body;
      const days = daysToKeep ? parseInt(daysToKeep) : 7;
      
      loggingService.clearOldLogs(days);
      
      res.json({
        success: true,
        message: `Logs older than ${days} days have been cleared`
      });
    } catch (error) {
      logger.error('Error clearing old logs:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Dashboard路由
  router.get('/dashboard', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
  });

  // 静态文件服务
  router.use('/temp-images', express.static(path.join(__dirname, '../../temp-images')));
  router.use(express.static(path.join(__dirname, '../../public')));

  // 错误处理中间件
  router.use(errorLoggingMiddleware);
  router.use((error: Error, req: Request, res: Response, next: any) => {
    logger.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}

// 辅助函数：下载文件
function downloadFile(url: string, filePath: string): Promise<{ success: boolean; error?: string; size?: number }> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    const request = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        resolve({
          success: false,
          error: `HTTP ${response.statusCode}: ${response.statusMessage}`
        });
        return;
      }
      
      const fileStream = fs.createWriteStream(filePath);
      let downloadedBytes = 0;
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve({
          success: true,
          size: downloadedBytes
        });
      });
      
      fileStream.on('error', (error) => {
        fs.unlink(filePath, () => {}); // 删除部分下载的文件
        resolve({
          success: false,
          error: error.message
        });
      });
    });
    
    request.on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });
    
    request.setTimeout(60000, () => {
      request.destroy();
      resolve({
        success: false,
        error: 'Download timeout'
      });
    });
  });
}