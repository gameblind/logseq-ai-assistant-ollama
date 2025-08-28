import * as api from '@/libs';
import { getSettings } from './settings';
import { analyzeUserIntent, callMCPTool } from '@/libs';

/**
 * 智能任务路由器
 * 根据意图分析结果自动选择最佳的处理方式
 */
export class SmartRouter {
    private static instance: SmartRouter;
    
    public static getInstance(): SmartRouter {
        if (!SmartRouter.instance) {
            SmartRouter.instance = new SmartRouter();
        }
        return SmartRouter.instance;
    }
    
    /**
     * 智能路由处理用户输入
     * @param blockId 当前块ID
     * @param userInput 用户输入内容
     * @param context 上下文信息
     */
    async routeUserInput(
        blockId: string, 
        userInput: string, 
        context?: {
            isStreaming?: boolean;
            systemContent?: string;
            assistantContent?: string;
        }
    ): Promise<void> {
        try {
            const { bridgeServiceUrl } = await getSettings();
            
            // 如果没有配置桥接服务，直接使用传统对话
            if (!bridgeServiceUrl) {
                console.log('🔄 未配置桥接服务，使用传统对话模式');
                return this.handleTraditionalChat(blockId, userInput, context);
            }
            
            console.log('🧠 开始智能任务路由分析...', { userInput: userInput.substring(0, 100) + '...' });
            
            // 检测是否询问工具列表
            const toolListKeywords = ['支持哪些', '有哪些工具', '工具列表', 'mcp服务', 'mcp工具', '可用工具', '功能列表'];
            const lowerInput = userInput.toLowerCase();
            if (toolListKeywords.some(keyword => lowerInput.includes(keyword))) {
                console.log('🔍 检测到工具列表询问，直接获取实际MCP服务信息');
                return this.handleToolListInquiry(blockId, userInput, context);
            }
            
            // 执行意图分析
            const intentAnalysis = await analyzeUserIntent(userInput);
            
            console.log('🎯 路由分析结果:', {
                taskType: intentAnalysis.taskType,
                confidence: intentAnalysis.confidence,
                needsMCP: intentAnalysis.needsMCP,
                reasoning: intentAnalysis.reasoning
            });
            
            // 根据任务类型和置信度选择处理方式
            const routingDecision = this.makeRoutingDecision(intentAnalysis);
            
            console.log('🚀 路由决策:', routingDecision);
            
            // 执行路由决策
            await this.executeRoutingDecision(blockId, userInput, intentAnalysis, routingDecision, context);
            
        } catch (error) {
            console.error('❌ 智能路由失败:', error);
            // 降级到传统对话模式
            console.log('🔄 降级到传统对话模式');
            await this.handleTraditionalChat(blockId, userInput, context);
        }
    }
    
    /**
     * 根据意图分析结果做出路由决策
     */
    private makeRoutingDecision(intentAnalysis: any): {
        strategy: 'mcp_tool' | 'specialized_command' | 'enhanced_chat' | 'traditional_chat';
        command?: string;
        reasoning: string;
    } {
        const { taskType, confidence, needsMCP, recommendedTool } = intentAnalysis;
        
        // 高置信度且需要MCP工具
        if (needsMCP && recommendedTool && confidence > 0.8) {
            return {
                strategy: 'mcp_tool',
                reasoning: `高置信度(${(confidence * 100).toFixed(1)}%)检测到需要MCP工具: ${recommendedTool.serviceId}/${recommendedTool.toolName}`
            };
        }
        
        // 根据任务类型选择专门的命令
        if (confidence > 0.7) {
            const commandMapping = this.getCommandMapping(taskType);
            if (commandMapping) {
                return {
                    strategy: 'specialized_command',
                    command: commandMapping.command,
                    reasoning: `高置信度(${(confidence * 100).toFixed(1)}%)检测到${taskType}任务，使用专门命令: ${commandMapping.command}`
                };
            }
        }
        
        // 中等置信度，使用增强对话（包含意图信息）
        if (confidence > 0.5) {
            return {
                strategy: 'enhanced_chat',
                reasoning: `中等置信度(${(confidence * 100).toFixed(1)}%)，使用增强对话模式`
            };
        }
        
        // 低置信度，使用传统对话
        return {
            strategy: 'traditional_chat',
            reasoning: `低置信度(${(confidence * 100).toFixed(1)}%)，使用传统对话模式`
        };
    }
    
    /**
     * 获取任务类型到命令的映射
     */
    private getCommandMapping(taskType: string): { command: string; handler: string } | null {
        const mappings: Record<string, { command: string; handler: string }> = {
            'image_generation': { command: '/gpt-image', handler: 'performImageGeneration' },
            'image_edit': { command: '/gpt-imgedit', handler: 'performImageEdit' },
            'text_to_speech': { command: '/gpt-tts', handler: 'performTextToSpeech' },
            'ocr': { command: '/gpt-ocr', handler: 'performOCR' },
            'summary': { command: '/gpt-summary', handler: 'generatePageSummary' },
            'graph_search': { command: '/gpt-graph', handler: 'generateGraphBasedResponse' }
        };
        
        return mappings[taskType] || null;
    }
    
    /**
     * 执行路由决策
     */
    private async executeRoutingDecision(
        blockId: string,
        userInput: string,
        intentAnalysis: any,
        decision: any,
        context?: any
    ): Promise<void> {
        const { strategy, command, reasoning } = decision;
        
        // 显示路由决策信息给用户
        await logseq.UI.showMsg(`🤖 智能路由: ${reasoning}`, 'info');
        
        switch (strategy) {
            case 'mcp_tool':
                await this.handleMCPTool(blockId, userInput, intentAnalysis, context);
                break;
                
            case 'specialized_command':
                await this.handleSpecializedCommand(blockId, userInput, command!, intentAnalysis, context);
                break;
                
            case 'enhanced_chat':
                await this.handleEnhancedChat(blockId, userInput, intentAnalysis, context);
                break;
                
            case 'traditional_chat':
            default:
                await this.handleTraditionalChat(blockId, userInput, context);
                break;
        }
    }
    
    /**
     * 处理MCP工具调用
     */
    private async handleMCPTool(
        blockId: string,
        userInput: string,
        intentAnalysis: any,
        context?: any
    ): Promise<void> {
        const { recommendedTool } = intentAnalysis;
        const { serviceId, toolName, arguments: toolArgs, reasoning } = recommendedTool;
        
        try {
            console.log('🔧 执行MCP工具路由:', { serviceId, toolName, reasoning });
            
            // 调用MCP工具
            const toolResult = await callMCPTool(serviceId, toolName, toolArgs);
            
            if (toolResult.success) {
                // 工具执行成功，将结果与原始问题一起传递给AI进行后处理
                const enhancedInput = `${userInput}\n\n[MCP工具执行结果]\n工具: ${serviceId}/${toolName}\n结果: ${JSON.stringify(toolResult.result, null, 2)}`;
                await this.handleEnhancedChat(blockId, enhancedInput, intentAnalysis, context);
            } else {
                // 工具执行失败，降级到增强对话
                const enhancedInput = `${userInput}\n\n[MCP工具执行失败]\n工具: ${serviceId}/${toolName}\n错误: ${toolResult.error}`;
                await this.handleEnhancedChat(blockId, enhancedInput, intentAnalysis, context);
            }
        } catch (error) {
            console.error('❌ MCP工具路由执行失败:', error);
            // 降级到增强对话
            await this.handleEnhancedChat(blockId, userInput, intentAnalysis, context);
        }
    }
    
    /**
     * 处理专门命令
     */
    private async handleSpecializedCommand(
        blockId: string,
        userInput: string,
        command: string,
        intentAnalysis: any,
        context?: any
    ): Promise<void> {
        try {
            console.log('⚡ 执行专门命令路由:', { command, taskType: intentAnalysis.taskType });
            
            // 根据命令类型调用相应的API函数
            switch (command) {
                case '/gpt-image':
                    const prompt = this.extractPromptFromInput(userInput, 'image');
                    await api.performImageGeneration(blockId, prompt, []);
                    break;
                    
                case '/gpt-tts':
                    const text = this.extractPromptFromInput(userInput, 'tts');
                    await api.performTextToSpeech(blockId, text);
                    break;
                    
                case '/gpt-summary':
                    await api.generatePageSummary(blockId);
                    break;
                    
                default:
                    // 未知命令，降级到增强对话
                    await this.handleEnhancedChat(blockId, userInput, intentAnalysis, context);
                    break;
            }
        } catch (error) {
            console.error('❌ 专门命令路由执行失败:', error);
            // 降级到增强对话
            await this.handleEnhancedChat(blockId, userInput, intentAnalysis, context);
        }
    }
    
    /**
     * 处理增强对话（包含意图分析信息）
     */
    private async handleEnhancedChat(
        blockId: string,
        userInput: string,
        intentAnalysis: any,
        context?: any
    ): Promise<void> {
        console.log('💬 执行增强对话路由');
        
        // 构建包含意图分析信息的增强输入
        const intentInfo = `\n\n[智能意图分析]\n任务类型: ${intentAnalysis.taskType}\n置信度: ${(intentAnalysis.confidence * 100).toFixed(1)}%\n分析结果: ${intentAnalysis.reasoning}\n`;
        const enhancedInput = userInput + intentInfo;
        
        // 使用增强输入进行对话
        if (context?.isStreaming) {
            await api.openaiStream(blockId, enhancedInput, {
                system_content: context.systemContent,
                assistant_content: context.assistantContent
            });
        } else {
            await api.openaiMessage(blockId, enhancedInput, {
                system_content: context.systemContent,
                assistant_content: context.assistantContent
            });
        }
    }
    
    /**
     * 处理传统对话（无意图分析）
     */
    private async handleTraditionalChat(
        blockId: string,
        userInput: string,
        context?: any
    ): Promise<void> {
        console.log('💬 执行传统对话路由');
        
        if (context?.isStreaming) {
            await api.openaiStream(blockId, userInput, {
                system_content: context.systemContent,
                assistant_content: context.assistantContent
            });
        } else {
            await api.openaiMessage(blockId, userInput, {
                system_content: context.systemContent,
                assistant_content: context.assistantContent
            });
        }
    }
    
    /**
     * 处理工具列表询问
     */
    private async handleToolListInquiry(
        blockId: string,
        userInput: string,
        context?: any
    ): Promise<void> {
        try {
            const { bridgeServiceUrl } = await getSettings();
            
            // 获取服务列表
            const servicesResponse = await fetch(`${bridgeServiceUrl}/api/services`);
            const services = await servicesResponse.json();
            
            // 获取工具列表
            const toolsResponse = await fetch(`${bridgeServiceUrl}/api/tools`);
            const tools = await toolsResponse.json();
            
            // 构建回复内容
            let responseContent = '## 当前可用的 MCP 服务和工具\n\n';
            
            if (services && services.length > 0) {
                responseContent += `### 已连接的服务 (${services.length}个)\n\n`;
                
                for (const service of services) {
                    responseContent += `#### ${service.name} (${service.id})\n`;
                    responseContent += `- **描述**: ${service.description || '无描述'}\n`;
                    responseContent += `- **状态**: ${service.status}\n`;
                    responseContent += `- **工具数量**: ${service.toolCount}\n\n`;
                }
                
                responseContent += '### 可用工具详情\n\n';
                
                // 按服务分组显示工具
                const toolsByService = tools.reduce((acc: any, tool: any) => {
                    if (!acc[tool.serviceId]) {
                        acc[tool.serviceId] = [];
                    }
                    acc[tool.serviceId].push(tool);
                    return acc;
                }, {});
                
                for (const [serviceId, serviceTools] of Object.entries(toolsByService)) {
                    const service = services.find((s: any) => s.id === serviceId);
                    responseContent += `#### ${service?.name || serviceId} 工具\n\n`;
                    
                    for (const tool of serviceTools as any[]) {
                        responseContent += `- **${tool.name}**: ${tool.description}\n`;
                    }
                    responseContent += '\n';
                }
                
                responseContent += '### 使用方法\n\n';
                responseContent += '您可以直接描述您想要执行的任务，系统会自动选择合适的工具来帮助您完成。\n\n';
                responseContent += '例如：\n';
                responseContent += '- "记住今天学习了 TypeScript"\n';
                responseContent += '- "搜索之前关于 React 的记录"\n';
                responseContent += '- "读取 package.json 文件"\n';
            } else {
                responseContent += '当前没有连接任何 MCP 服务。\n\n';
                responseContent += '请检查桥接服务配置或联系管理员。';
            }
            
            // 插入回复到当前块
            await logseq.Editor.insertBlock(blockId, responseContent, {
                sibling: false,
                before: false
            });
            
        } catch (error) {
            console.error('❌ 获取工具列表失败:', error);
            await logseq.Editor.insertBlock(blockId, '❌ 获取工具列表失败，请检查桥接服务连接。', {
                sibling: false,
                before: false
            });
        }
    }
    
    /**
     * 从用户输入中提取提示词
     */
    private extractPromptFromInput(userInput: string, type: 'image' | 'tts'): string {
        // 移除常见的触发词和命令词
        const cleanInput = userInput
            .replace(/生成图片|生成图像|画一张|画个|生图/gi, '')
            .replace(/语音合成|文字转语音|读出来|朗读/gi, '')
            .replace(/请|帮我|能否|可以/gi, '')
            .trim();
            
        return cleanInput || userInput;
    }
}

// 导出单例实例
export const smartRouter = SmartRouter.getInstance();