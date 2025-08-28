import { logger } from '../utils/logger';
import { ConfigManager } from '../config/manager';

// 意图分析结果接口
export interface IntentAnalysisResult {
  needsMCP: boolean;
  confidence: number;
  taskType: 'text' | 'image' | 'audio' | 'video' | 'multimodal';
  recommendedTool?: {
    serviceId: string;
    toolName: string;
    arguments: any;
    reasoning: string;
  };
  reasoning: string;
  suggestedWorkflow?: string[];
}

// 用户输入接口
export interface UserInput {
  text?: string;
  images?: string[]; // base64 或 URL
  audio?: string; // base64 或 URL
  video?: string; // base64 或 URL
  context?: any; // 上下文信息
}

// AI服务配置接口
interface AIServiceConfig {
  provider: 'comfly' | 'dashscope' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export class IntentAnalyzer {
  private configManager: ConfigManager;
  private aiConfig: AIServiceConfig;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.aiConfig = this.loadAIConfig();
  }

  private loadAIConfig(): AIServiceConfig {
    const config = this.configManager.getConfig();
    
    // 使用阿里百炼
    if (config.api.dashscopeApiKey) {
      return {
        provider: 'dashscope',
        apiKey: config.api.dashscopeApiKey,
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        model: 'qwen-max'
      };
    }
    
    // 默认使用本地 Ollama
    return {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2'
    };
  }

  async analyzeIntent(userInput: UserInput, availableTools: any[]): Promise<IntentAnalysisResult> {
    try {
      // 检测任务类型
      const taskType = this.detectTaskType(userInput);
      
      // 构建分析提示词
      const prompt = this.buildAnalysisPrompt(userInput, availableTools, taskType);
      
      // 调用AI服务进行分析
      const aiResponse = await this.callAIService(prompt, userInput);
      
      // 解析AI响应
      const analysis = this.parseAIResponse(aiResponse, taskType);
      
      logger.info('Intent analysis completed', {
        taskType,
        needsMCP: analysis.needsMCP,
        confidence: analysis.confidence
      });
      
      return analysis;
    } catch (error) {
      logger.error('Intent analysis failed:', error);
      
      // 返回降级分析结果
      return this.fallbackAnalysis(userInput, availableTools);
    }
  }

  private detectTaskType(userInput: UserInput): 'text' | 'image' | 'audio' | 'video' | 'multimodal' {
    const hasText = !!userInput.text;
    const hasImages = !!(userInput.images && userInput.images.length > 0);
    const hasAudio = !!userInput.audio;
    const hasVideo = !!userInput.video;
    
    const modalityCount = [hasText, hasImages, hasAudio, hasVideo].filter(Boolean).length;
    
    if (modalityCount > 1) {
      return 'multimodal';
    }
    
    if (hasImages) return 'image';
    if (hasAudio) return 'audio';
    if (hasVideo) return 'video';
    return 'text';
  }

  private buildAnalysisPrompt(userInput: UserInput, availableTools: any[], taskType: string): string {
    const toolsDescription = availableTools.map(tool => 
      `- ${tool.serviceId}/${tool.name}: ${tool.description}`
    ).join('\n');

    const basePrompt = `你是一个智能意图分析助手，负责分析用户输入并推荐合适的MCP工具。

可用的MCP工具：
${toolsDescription}

任务类型：${taskType}

请分析用户输入，判断是否需要调用MCP工具。返回JSON格式：
{
  "needsMCP": boolean,
  "confidence": number (0-1),
  "taskType": "${taskType}",
  "recommendedTool": {
    "serviceId": "服务ID",
    "toolName": "工具名称",
    "arguments": {参数对象},
    "reasoning": "选择理由"
  },
  "reasoning": "分析理由",
  "suggestedWorkflow": ["步骤1", "步骤2"]
}`;

    // 根据任务类型添加特定指导
    switch (taskType) {
      case 'image':
        return basePrompt + `\n\n特别关注：
- 图像生成、编辑、分析需求
- 文生图、图生图、图像编辑工具
- 图像格式转换和处理`;
      
      case 'audio':
        return basePrompt + `\n\n特别关注：
- 语音合成(TTS)需求
- 音频处理和转换
- 语音识别需求`;
      
      case 'video':
        return basePrompt + `\n\n特别关注：
- 视频生成需求
- 文生视频、图生视频
- 视频编辑和处理`;
      
      case 'multimodal':
        return basePrompt + `\n\n特别关注：
- 多模态任务编排
- 跨模态转换需求
- 复合任务流程设计`;
      
      default:
        return basePrompt;
    }
  }

  private async callAIService(prompt: string, userInput: UserInput): Promise<string> {
    switch (this.aiConfig.provider) {
      case 'comfly':
        return this.callComflyAPI(prompt, userInput);
      case 'dashscope':
        return this.callDashscopeAPI(prompt, userInput);
      case 'ollama':
        return this.callOllamaAPI(prompt, userInput);
      default:
        throw new Error(`Unsupported AI provider: ${this.aiConfig.provider}`);
    }
  }

  private async callComflyAPI(prompt: string, userInput: UserInput): Promise<string> {
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: userInput.text || '用户提供了多媒体内容' }
    ];

    // 如果有图像，构建多模态消息
    if (userInput.images && userInput.images.length > 0) {
      const content = [
        { type: 'text', text: userInput.text || '请分析这些图像' },
        ...userInput.images.map(img => ({
          type: 'image_url',
          image_url: { url: img }
        }))
      ];
      messages[1] = { role: 'user', content: JSON.stringify(content) };
    }

    const response = await fetch(`${this.aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: this.aiConfig.model,
        messages,
        temperature: 0.1,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`Comfly API error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.choices[0].message.content;
  }

  private async callDashscopeAPI(prompt: string, userInput: UserInput): Promise<string> {
    // 使用阿里百炼API
    const response = await fetch(`${this.aiConfig.baseUrl}/services/aigc/text-generation/generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: this.aiConfig.model,
        input: {
          prompt: `${prompt}\n\n用户输入：${userInput.text || '多媒体内容'}`
        },
        parameters: {
          temperature: 0.1,
          max_tokens: 1000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Dashscope API error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.output.text;
  }

  private async callOllamaAPI(prompt: string, userInput: UserInput): Promise<string> {
    // 使用本地Ollama API
    const response = await fetch(`${this.aiConfig.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.aiConfig.model,
        prompt: `${prompt}\n\n用户输入：${userInput.text || '多媒体内容'}`,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 1000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.response;
  }

  private parseAIResponse(aiResponse: string, taskType: string): IntentAnalysisResult {
    try {
      // 尝试解析JSON响应
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          needsMCP: parsed.needsMCP || false,
          confidence: parsed.confidence || 0.5,
          taskType: taskType as any,
          recommendedTool: parsed.recommendedTool,
          reasoning: parsed.reasoning || 'AI分析结果',
          suggestedWorkflow: parsed.suggestedWorkflow
        };
      }
    } catch (error) {
      logger.warn('Failed to parse AI response as JSON:', error);
    }

    // 如果解析失败，使用文本分析
    return this.parseTextResponse(aiResponse, taskType);
  }

  private parseTextResponse(aiResponse: string, taskType: string): IntentAnalysisResult {
    const lowerResponse = aiResponse.toLowerCase();
    
    // 检测是否需要MCP工具
    const needsMCP = lowerResponse.includes('需要') || 
                     lowerResponse.includes('推荐') || 
                     lowerResponse.includes('使用工具');
    
    return {
      needsMCP,
      confidence: needsMCP ? 0.7 : 0.3,
      taskType: taskType as any,
      reasoning: aiResponse,
      suggestedWorkflow: needsMCP ? ['分析用户需求', '选择合适工具', '执行任务'] : ['直接对话回复']
    };
  }

  private fallbackAnalysis(userInput: UserInput, availableTools: any[]): IntentAnalysisResult {
    const text = userInput.text?.toLowerCase() || '';
    
    // 检测是否询问工具列表
    const toolListKeywords = ['支持哪些', '有哪些工具', '工具列表', 'mcp服务', 'mcp工具', '可用工具', '功能列表'];
    if (toolListKeywords.some(keyword => text.includes(keyword))) {
      return {
        needsMCP: false,
        confidence: 0.9,
        taskType: this.detectTaskType(userInput),
        reasoning: '用户询问可用工具列表，应返回实际连接的MCP服务和工具信息',
        suggestedWorkflow: ['获取当前连接的MCP服务列表', '展示每个服务的可用工具', '提供工具使用示例']
      };
    }
    
    // 简单的关键词匹配 - 只匹配实际存在的工具
    const patterns = [
      { keywords: ['记住', '保存', '记录'], serviceId: 'memory', toolName: 'store_memory' },
      { keywords: ['回忆', '查找', '搜索记忆'], serviceId: 'memory', toolName: 'search_memory' },
      { keywords: ['读取文件', '查看文件'], serviceId: 'filesystem', toolName: 'read_file' },
      { keywords: ['写入文件', '保存文件'], serviceId: 'filesystem', toolName: 'write_file' },
      { keywords: ['删除文件'], serviceId: 'filesystem', toolName: 'delete_file' },
      { keywords: ['列出文件', '文件列表'], serviceId: 'filesystem', toolName: 'list_files' },
      { keywords: ['查找文件'], serviceId: 'filesystem', toolName: 'find_files' }
    ];

    for (const pattern of patterns) {
      if (pattern.keywords.some(keyword => text.includes(keyword))) {
        const tool = availableTools.find(t => t.serviceId === pattern.serviceId && t.name === pattern.toolName);
        if (tool) {
          return {
            needsMCP: true,
            confidence: 0.6,
            taskType: this.detectTaskType(userInput),
            recommendedTool: {
              serviceId: pattern.serviceId,
              toolName: pattern.toolName,
              arguments: {},
              reasoning: `关键词匹配：${pattern.keywords.join(', ')}`
            },
            reasoning: '基于关键词匹配的降级分析'
          };
        }
      }
    }

    return {
      needsMCP: false,
      confidence: 0.5,
      taskType: this.detectTaskType(userInput),
      reasoning: '未检测到需要特定工具的意图，建议直接对话'
    };
  }

  // 更新AI配置
  updateAIConfig(newConfig: Partial<AIServiceConfig>): void {
    this.aiConfig = { ...this.aiConfig, ...newConfig };
    logger.info('AI configuration updated', { provider: this.aiConfig.provider });
  }

  // 获取当前AI配置
  getAIConfig(): AIServiceConfig {
    return { ...this.aiConfig };
  }
}