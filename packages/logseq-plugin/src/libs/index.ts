import '@logseq/libs';
import { OpenAI, toMessages } from '@libs/openai';
import { settingsSchema, getSettings } from './settings';
import { bridgeServiceRequest, ConnectionManager } from './network';

/**
 * 格式化AI回复内容，处理Logseq不支持的多个列表和标题
 * @param content AI回复的原始内容
 * @returns 格式化后的内容数组，每个元素对应一个Logseq块
 */
function formatContentForLogseq(content: string): string[] {
    if (!content || content.trim() === '') {
        return [content];
    }

    const lines = content.split('\n');
    const blocks: string[] = [];
    let currentBlock = '';
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // 检查代码块
        if (trimmedLine.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            if (currentBlock === '') {
                currentBlock = line;
            } else {
                currentBlock += '\n' + line;
            }
            
            // 如果代码块结束，结束当前块
            if (!inCodeBlock) {
                blocks.push(currentBlock.trim());
                currentBlock = '';
            }
            continue;
        }
        
        // 如果在代码块内，直接添加
        if (inCodeBlock) {
            currentBlock += '\n' + line;
            continue;
        }
        
        // 检查是否是标题（# ## ### 等）
        const isHeading = /^#{1,6}\s/.test(trimmedLine);
        // 检查是否是列表项（- * + 或 1. 2. 等）
        const isListItem = /^[\-\*\+]\s/.test(trimmedLine) || /^\d+\.\s/.test(trimmedLine);
        
        // 标题和列表项都需要独立成块
        if ((isHeading || isListItem) && currentBlock.trim() !== '') {
            blocks.push(currentBlock.trim());
            currentBlock = line;
        }
        // 如果当前行是标题或列表项，且当前块为空，直接设置为当前块
        else if ((isHeading || isListItem) && currentBlock.trim() === '') {
            currentBlock = line;
        }
        // 普通文本行
        else {
            if (currentBlock === '') {
                currentBlock = line;
            } else {
                // 如果当前块已经是标题或列表项，需要结束当前块
                const currentBlockTrimmed = currentBlock.trim();
                const currentIsHeading = /^#{1,6}\s/.test(currentBlockTrimmed);
                const currentIsListItem = /^[\-\*\+]\s/.test(currentBlockTrimmed) || /^\d+\.\s/.test(currentBlockTrimmed);
                
                if (currentIsHeading || currentIsListItem) {
                    blocks.push(currentBlock.trim());
                    currentBlock = line;
                } else {
                    currentBlock += '\n' + line;
                }
            }
        }
        
        // 如果当前行是标题或列表项，立即结束当前块
        if (isHeading || isListItem) {
            blocks.push(currentBlock.trim());
            currentBlock = '';
        }
    }
    
    // 添加最后一个块
    if (currentBlock.trim() !== '') {
        blocks.push(currentBlock.trim());
    }
    
    // 如果没有分割出多个块，返回原内容
    return blocks.length > 0 ? blocks : [content];
}

/**
 * Recursively aggregate all content on tree nodes.
 * @param uuid Block ID
 * @param isRecord Whether it is recorded
 */
async function summary(uuid: string, isRecord: boolean): Promise<string> {
    let { content, children }: any = await logseq.Editor.getBlock(uuid);
    if (undefined === children) {
        return content || '';
    }

    content = isRecord ? content : '';
    for (let child of children) {
        content += '\n\n';
        content += await summary(child[1], true);
    }
    return content;
}

async function openaiMessage(
    block_id: string,
    user_content: string,
    opts?: {
        system_content?: string,
        assistant_content?: string
    }
): Promise<void> {
    try {
        const { aiProvider, openaiKey, openaiAddress, gptModel, ollamaAddress, ollamaModel, bridgeServiceUrl } = await getSettings();
        
        let openai: OpenAI;
        if (aiProvider === "ollama") {
            openai = new OpenAI("", ollamaAddress, ollamaModel, true);
        } else {
            openai = new OpenAI(openaiKey, openaiAddress, gptModel, false);
        }
        
        // 智能意图分析和任务调度（非流式版本）
        let mcpContext = '';
        let intentAnalysisInfo = '';
        
        // 只有在配置了桥接服务时才进行意图分析
        if (bridgeServiceUrl) {
            try {
                console.log('🧠 开始智能意图分析（非流式）...', { userInput: user_content.substring(0, 100) + '...' });
                
                // 执行意图分析（非流式不显示中间提示）
                const intentAnalysis = await analyzeUserIntent(user_content);
                
                console.log('🎯 意图分析结果:', {
                    needsMCP: intentAnalysis.needsMCP,
                    taskType: intentAnalysis.taskType,
                    confidence: intentAnalysis.confidence,
                    reasoning: intentAnalysis.reasoning
                });
                
                // 构建意图分析信息
                intentAnalysisInfo = `\n\n[智能意图分析]\n任务类型: ${intentAnalysis.taskType}\n置信度: ${(intentAnalysis.confidence * 100).toFixed(1)}%\n分析结果: ${intentAnalysis.reasoning}\n`;
                
                // 如果需要调用MCP工具
                if (intentAnalysis.needsMCP && intentAnalysis.recommendedTool) {
                    const { serviceId, toolName, arguments: toolArgs, reasoning } = intentAnalysis.recommendedTool;
                    
                    try {
                        console.log('🔧 准备调用MCP工具（非流式）:', { serviceId, toolName, reasoning });
                        
                        // 调用MCP工具
                        const toolResult = await callMCPTool(serviceId, toolName, toolArgs);
                        
                        console.log('✅ MCP工具调用完成（非流式）:', { success: toolResult.success });
                        
                        // 构建MCP上下文
                        if (toolResult.success) {
                            mcpContext = `\n\n[MCP工具执行成功]\n工具: ${serviceId}/${toolName}\n推荐理由: ${reasoning}\n执行结果: ${JSON.stringify(toolResult.result, null, 2)}\n`;
                        } else {
                            mcpContext = `\n\n[MCP工具执行失败]\n工具: ${serviceId}/${toolName}\n推荐理由: ${reasoning}\n错误信息: ${toolResult.error}\n`;
                        }
                    } catch (error) {
                        console.error('❌ MCP工具调用异常（非流式）:', error);
                        mcpContext = `\n\n[MCP工具调用异常]\n工具: ${serviceId}/${toolName}\n推荐理由: ${reasoning}\n异常信息: ${error instanceof Error ? error.message : '未知错误'}\n`;
                    }
                } else {
                    console.log('💬 无需调用MCP工具，直接进行对话（非流式）');
                }
            } catch (error) {
                console.error('❌ 意图分析失败（非流式）:', error);
                intentAnalysisInfo = `\n\n[意图分析失败]\n错误: ${error instanceof Error ? error.message : '未知错误'}\n将直接进行对话处理\n`;
            }
        } else {
            console.log('⚠️ 未配置桥接服务，跳过意图分析（非流式）');
        }
        
        // 构建增强的用户内容
        const enhancedUserContent = (intentAnalysisInfo + mcpContext) ? `${user_content}${intentAnalysisInfo}${mcpContext}` : user_content;
        
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `loading...`))?.uuid;

        const result = await openai.chat(toMessages(
            enhancedUserContent, {
            system: opts?.system_content,
            assistant: opts?.assistant_content
        }), false);

        // 格式化内容为多个块
        const formattedBlocks = formatContentForLogseq(result);
        
        if (formattedBlocks.length === 1) {
            // 单个块，直接更新或插入
            if (uuid) {
                await logseq.Editor.updateBlock(uuid, formattedBlocks[0]);
            } else {
                await logseq.Editor.insertBlock(block_id, formattedBlocks[0]);
            }
        } else {
            // 多个块，需要删除loading块并插入多个新块
            if (uuid) {
                await logseq.Editor.removeBlock(uuid);
            }
            
            // 插入多个格式化后的块
            for (let i = 0; i < formattedBlocks.length; i++) {
                await logseq.Editor.insertBlock(block_id, formattedBlocks[i]);
            }
        }
        await logseq.Editor.editBlock(block_id);
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

/**
 * Use openai chat api to stream content output.
 * @param block_id block ID
 * @param user_content content
 * @param opts gpt prompt
 */
/**
 * 调用MCP工具的函数
 */
async function callMCPTool(serviceId: string, toolName: string, args: any): Promise<any> {
    try {
        const { bridgeServiceUrl } = await getSettings();
        const result = await bridgeServiceRequest(`/api/tools/${serviceId}/${toolName}`, bridgeServiceUrl, {
            body: JSON.stringify(args),
            timeout: 30000,
            retries: 2
        });
        return result;
    } catch (error) {
        console.error('Error calling MCP tool:', error);
        throw error;
    }
}

/**
 * 分析用户意图并推荐MCP工具
 */
async function analyzeUserIntent(userInput: string): Promise<any> {
    try {
        const { bridgeServiceUrl } = await getSettings();
        const result = await bridgeServiceRequest('/api/analyze-intent', bridgeServiceUrl, {
            body: JSON.stringify({ userInput }),
            timeout: 15000,
            retries: 1
        });
        return result.analysis;
    } catch (error) {
        console.error('Error analyzing intent:', error);
        return { needsMCP: false, reasoning: '意图分析失败，直接进行对话' };
    }
}

async function openaiStream(
    block_id: string,
    user_content: string,
    opts?: {
        system_content?: string,
        assistant_content?: string
    }
): Promise<void> {
    try {
        const { aiProvider, openaiKey, openaiAddress, gptModel, ollamaAddress, ollamaModel, bridgeServiceUrl } = await getSettings();
        
        let openai: OpenAI;
        if (aiProvider === "ollama") {
            openai = new OpenAI("", ollamaAddress, ollamaModel, true);
        } else {
            openai = new OpenAI(openaiKey, openaiAddress, gptModel, false);
        }
        
        // 智能意图分析和任务调度
        let mcpContext = '';
        let intentAnalysisInfo = '';
        
        // 只有在配置了桥接服务时才进行意图分析
        if (bridgeServiceUrl) {
            try {
                console.log('🧠 开始智能意图分析...', { userInput: user_content.substring(0, 100) + '...' });
                
                // 显示意图分析提示
                const analysisUuid = (await logseq.Editor.insertBlock(block_id, `🧠 正在分析意图和任务类型...`))?.uuid;
                
                // 执行意图分析
                const intentAnalysis = await analyzeUserIntent(user_content);
                
                console.log('🎯 意图分析结果:', {
                    needsMCP: intentAnalysis.needsMCP,
                    taskType: intentAnalysis.taskType,
                    confidence: intentAnalysis.confidence,
                    reasoning: intentAnalysis.reasoning
                });
                
                // 删除分析提示
                if (analysisUuid) {
                    await logseq.Editor.removeBlock(analysisUuid);
                }
                
                // 构建意图分析信息
                intentAnalysisInfo = `\n\n[智能意图分析]\n任务类型: ${intentAnalysis.taskType}\n置信度: ${(intentAnalysis.confidence * 100).toFixed(1)}%\n分析结果: ${intentAnalysis.reasoning}\n`;
                
                // 如果需要调用MCP工具
                if (intentAnalysis.needsMCP && intentAnalysis.recommendedTool) {
                    const { serviceId, toolName, arguments: toolArgs, reasoning } = intentAnalysis.recommendedTool;
                    
                    try {
                        console.log('🔧 准备调用MCP工具:', { serviceId, toolName, reasoning });
                        
                        // 显示工具调用提示
                        const toolUuid = (await logseq.Editor.insertBlock(block_id, `🔧 正在调用 ${serviceId}/${toolName} 工具...\n💡 ${reasoning}`))?.uuid;
                        
                        // 调用MCP工具
                        const toolResult = await callMCPTool(serviceId, toolName, toolArgs);
                        
                        console.log('✅ MCP工具调用完成:', { success: toolResult.success });
                        
                        // 删除工具调用提示
                        if (toolUuid) {
                            await logseq.Editor.removeBlock(toolUuid);
                        }
                        
                        // 构建MCP上下文
                        if (toolResult.success) {
                            mcpContext = `\n\n[MCP工具执行成功]\n工具: ${serviceId}/${toolName}\n推荐理由: ${reasoning}\n执行结果: ${JSON.stringify(toolResult.result, null, 2)}\n`;
                        } else {
                            mcpContext = `\n\n[MCP工具执行失败]\n工具: ${serviceId}/${toolName}\n推荐理由: ${reasoning}\n错误信息: ${toolResult.error}\n`;
                        }
                    } catch (error) {
                        console.error('❌ MCP工具调用异常:', error);
                        mcpContext = `\n\n[MCP工具调用异常]\n工具: ${serviceId}/${toolName}\n推荐理由: ${reasoning}\n异常信息: ${error instanceof Error ? error.message : '未知错误'}\n`;
                    }
                } else {
                    console.log('💬 无需调用MCP工具，直接进行对话');
                }
            } catch (error) {
                console.error('❌ 意图分析失败:', error);
                intentAnalysisInfo = `\n\n[意图分析失败]\n错误: ${error instanceof Error ? error.message : '未知错误'}\n将直接进行对话处理\n`;
            }
        } else {
            console.log('⚠️ 未配置桥接服务，跳过意图分析');
        }
        
        // 构建增强的用户内容
        const enhancedUserContent = (intentAnalysisInfo + mcpContext) ? `${user_content}${intentAnalysisInfo}${mcpContext}` : user_content;
        
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `loading...`))?.uuid;

        let result: string = "", text: string = "";
        const decoder = new TextDecoder("utf-8");
        const reader = (await openai.chat(toMessages(
            enhancedUserContent, {
            system: opts?.system_content,
            assistant: opts?.assistant_content
        }))).body?.getReader();

        while (undefined !== uuid) {
            const { done, value }: any = await reader?.read();
            if( done ) { break; }

            try {
                const lines = decoder.decode(value).split("\n");
                lines.map((line) => line.replace(/^data: /, "").trim())
                    .filter((line) => line !== "" && line !== "[DONE]")
                    .map((line) => JSON.parse(line))
                    .forEach((line) => {
                        text = line.choices[0].delta?.content as string;
                        result += text ? text : '';
                    })
                // 流式输出时实时更新，不进行格式化
                await logseq.Editor.updateBlock(uuid, result);
            } catch(err: any) {
                // Avoid situations where the presence of 
                // certain escape characters causes output failure.
                continue;
            }
        }
        
        // 流式输出完成后，对最终结果进行格式化处理
        if (undefined !== uuid && result.trim() !== '') {
            const formattedBlocks = formatContentForLogseq(result);
            
            if (formattedBlocks.length > 1) {
                // 需要拆分为多个块
                await logseq.Editor.removeBlock(uuid);
                
                // 插入多个格式化后的块
                for (let i = 0; i < formattedBlocks.length; i++) {
                    await logseq.Editor.insertBlock(block_id, formattedBlocks[i]);
                }
            }
        }
        
        await logseq.Editor.editBlock(block_id);
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

async function generateAdvancedQuery(content: string, block_id: string) {
    try {
        const { aiProvider, openaiKey, openaiAddress, gptModel, ollamaAddress, ollamaModel, promptAdvancedQuery } = await getSettings();
        
        let openai: OpenAI;
        if (aiProvider === "ollama") {
            openai = new OpenAI("", ollamaAddress, ollamaModel, true);
        } else {
            openai = new OpenAI(openaiKey, openaiAddress, gptModel, false);
        }
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `loading...`))?.uuid;

        if (undefined != uuid) {
            const result: string = (await openai.chat(toMessages(
                content + '(output the code text only without additional explanations.)', {
                system: promptAdvancedQuery
            }), false));

            await logseq.Editor.updateBlock(uuid, result.replace(/^```+|```+$/g, ''));
            await logseq.Editor.editBlock(block_id);
        }
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

/**
 * 生成当前页面的摘要
 * @param block_id 当前块ID
 */
async function generatePageSummary(block_id: string): Promise<void> {
    try {
        const { aiProvider, openaiKey, openaiAddress, gptModel, ollamaAddress, ollamaModel } = await getSettings();
        
        // 获取当前页面的所有内容
        const currentBlock = await logseq.Editor.getCurrentBlock();
        if (!currentBlock) {
            logseq.UI.showMsg('无法获取当前块信息', 'error');
            return;
        }
        
        // 获取当前页面
        const currentPage = await logseq.Editor.getCurrentPage();
        if (!currentPage) {
            logseq.UI.showMsg('无法获取当前页面信息', 'error');
            return;
        }
        
        // 获取页面的所有块内容
        const pageBlocks = await logseq.Editor.getPageBlocksTree(currentPage.name);
        let pageContent = '';
        
        // 递归获取所有块的内容
        function extractBlockContent(blocks: any[]): string {
            let content = '';
            for (const block of blocks) {
                if (block.content) {
                    content += block.content + '\n';
                }
                if (block.children && block.children.length > 0) {
                    content += extractBlockContent(block.children);
                }
            }
            return content;
        }
        
        pageContent = extractBlockContent(pageBlocks);
        
        if (!pageContent.trim()) {
            logseq.UI.showMsg('当前页面没有内容可以摘要', 'warning');
            return;
        }
        
        // 构建摘要提示词
        const summaryPrompt = `请为以下内容生成一个简洁的摘要，不超过144个字：\n\n${pageContent}`;
        
        let openai: OpenAI;
        if (aiProvider === "ollama") {
            openai = new OpenAI("", ollamaAddress, ollamaModel, true);
        } else {
            openai = new OpenAI(openaiKey, openaiAddress, gptModel, false);
        }
        
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `正在生成页面摘要...`))?.uuid;
        
        const result = await openai.chat(toMessages(summaryPrompt, {
            system: "你是一个专业的摘要助手。请生成简洁、准确的摘要，突出主要观点和关键信息。摘要应该在144个字以内。"
        }), false);
        
        // 格式化摘要结果
        const formattedBlocks = formatContentForLogseq(result);
        
        if (formattedBlocks.length === 1) {
            // 单个块，直接更新
            if (uuid) {
                await logseq.Editor.updateBlock(uuid, `📝 **页面摘要**\n\n${formattedBlocks[0]}`);
            } else {
                await logseq.Editor.insertBlock(block_id, `📝 **页面摘要**\n\n${formattedBlocks[0]}`);
            }
        } else {
            // 多个块，需要删除loading块并插入多个新块
            if (uuid) {
                await logseq.Editor.removeBlock(uuid);
            }
            
            // 插入标题块
            await logseq.Editor.insertBlock(block_id, `📝 **页面摘要**`);
            
            // 插入多个格式化后的块
            for (let i = 0; i < formattedBlocks.length; i++) {
                await logseq.Editor.insertBlock(block_id, formattedBlocks[i]);
            }
        }
        
        await logseq.Editor.editBlock(block_id);
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

/**
 * 获取与当前页面相关的图库内容（基于双链和标签）
 * @param currentPageName 当前页面名称
 * @returns 相关的图库内容
 */
async function getBacklinkGraphContent(currentPageName: string): Promise<string> {
    try {
        // 获取当前页面信息
        const currentPage = await logseq.Editor.getPage(currentPageName);
        if (!currentPage) {
            return '无法获取当前页面信息。';
        }

        // 获取当前页面内容以提取标签和引用
        const currentPageBlocks = await logseq.Editor.getPageBlocksTree(currentPageName);
        const currentPageContent = currentPageBlocks ? extractBlockContent(currentPageBlocks) : '';
        
        // 提取当前页面的标签和引用
        const tags = extractTags(currentPageContent);
        const pageReferences = extractPageReferences(currentPageContent);
        
        // 收集相关内容
        const relatedContent: Array<{type: string, pageName: string, content: string}> = [];
        
        // 1. 获取引用当前页面的其他页面（反向链接）
        const backlinks = await getBacklinks(currentPageName);
        for (const backlink of backlinks) {
            relatedContent.push({
                type: '反向链接',
                pageName: backlink.pageName,
                content: backlink.content
            });
        }
        
        // 2. 获取当前页面引用的其他页面（正向链接）
        for (const ref of pageReferences) {
            const refContent = await getPageContent(ref);
            if (refContent) {
                relatedContent.push({
                    type: '引用页面',
                    pageName: ref,
                    content: refContent
                });
            }
        }
        
        // 3. 获取包含相同标签的页面
        for (const tag of tags) {
            const taggedPages = await getPagesWithTag(tag);
            for (const taggedPage of taggedPages) {
                if (taggedPage.pageName !== currentPageName) {
                    relatedContent.push({
                        type: '相同标签',
                        pageName: taggedPage.pageName,
                        content: taggedPage.content
                    });
                }
            }
        }
        
        // 去重并限制数量
        const uniqueContent = deduplicateContent(relatedContent);
        const limitedContent = uniqueContent.slice(0, 8); // 限制最多8个相关页面
        
        if (limitedContent.length === 0) {
            return `当前页面 "${currentPageName}" 没有找到相关的双链或标签内容。`;
        }
        
        return formatRelatedContent(currentPageName, limitedContent, tags, pageReferences);
        
    } catch (error) {
        console.error('获取双链图库内容时出错:', error);
        return '获取图库内容时发生错误，请稍后重试。';
    }
}

/**
 * 提取页面内容中的标签
 * @param content 页面内容
 * @returns 标签数组
 */
function extractTags(content: string): string[] {
    const tagRegex = /#([\w\u4e00-\u9fa5]+)/g;
    const tags = new Set<string>();
    let match;
    
    while ((match = tagRegex.exec(content)) !== null) {
        tags.add(match[1]);
    }
    
    return Array.from(tags).slice(0, 5); // 限制标签数量
}

/**
 * 提取页面内容中的页面引用
 * @param content 页面内容
 * @returns 页面引用数组
 */
function extractPageReferences(content: string): string[] {
    const refRegex = /\[\[([^\]]+)\]\]/g;
    const refs = new Set<string>();
    let match;
    
    while ((match = refRegex.exec(content)) !== null) {
        refs.add(match[1]);
    }
    
    return Array.from(refs).slice(0, 5); // 限制引用数量
}

/**
 * 获取引用指定页面的其他页面（反向链接）
 * @param pageName 页面名称
 * @returns 反向链接数组
 */
async function getBacklinks(pageName: string): Promise<Array<{pageName: string, content: string}>> {
    try {
        // 使用 Datalog 查询获取包含页面引用的块
        const query = `[
            :find (pull ?b [*])
            :where 
            [?b :block/content ?content]
            [(clojure.string/includes? ?content "[[${pageName}]]")]
        ]`;
        
        const results = await logseq.DB.datascriptQuery(query);
        const backlinks: Array<{pageName: string, content: string}> = [];
        
        for (const result of results.slice(0, 5)) { // 限制结果数量
            const block = result[0];
            if (block && block.page && block.page.id) {
                const page = await logseq.Editor.getPage(block.page.id);
                if (page && page.name !== pageName) {
                    // 获取包含引用的上下文内容
                    const contextContent = await getBlockContext(block.uuid);
                    backlinks.push({
                        pageName: page.name,
                        content: contextContent || block.content || ''
                    });
                }
            }
        }
        
        return backlinks;
    } catch (error) {
        console.warn('获取反向链接时出错:', error);
        return [];
    }
}

/**
 * 获取页面内容
 * @param pageName 页面名称
 * @returns 页面内容
 */
async function getPageContent(pageName: string): Promise<string | null> {
    try {
        const pageBlocks = await logseq.Editor.getPageBlocksTree(pageName);
        if (!pageBlocks || pageBlocks.length === 0) {
            return null;
        }
        
        const content = extractBlockContent(pageBlocks);
        // 限制单个页面内容长度
        return content.length > 800 ? content.substring(0, 800) + '...' : content;
    } catch (error) {
        console.warn(`获取页面 ${pageName} 内容时出错:`, error);
        return null;
    }
}

/**
 * 获取包含指定标签的页面
 * @param tag 标签名称
 * @returns 包含该标签的页面数组
 */
async function getPagesWithTag(tag: string): Promise<Array<{pageName: string, content: string}>> {
    try {
        // 使用 Datalog 查询获取包含标签的块
        const query = `[
            :find (pull ?b [*])
            :where 
            [?b :block/content ?content]
            [(clojure.string/includes? ?content "#${tag}")]
        ]`;
        
        const results = await logseq.DB.datascriptQuery(query);
        const taggedPages: Array<{pageName: string, content: string}> = [];
        const seenPages = new Set<string>();
        
        for (const result of results.slice(0, 3)) { // 限制每个标签的结果数量
            const block = result[0];
            if (block && block.page && block.page.id) {
                const page = await logseq.Editor.getPage(block.page.id);
                if (page && !seenPages.has(page.name)) {
                    seenPages.add(page.name);
                    const contextContent = await getBlockContext(block.uuid);
                    taggedPages.push({
                        pageName: page.name,
                        content: contextContent || block.content || ''
                    });
                }
            }
        }
        
        return taggedPages;
    } catch (error) {
        console.warn(`获取标签 ${tag} 相关页面时出错:`, error);
        return [];
    }
}

/**
 * 获取块的上下文内容（包括父块和子块）
 * @param blockUuid 块UUID
 * @returns 上下文内容
 */
async function getBlockContext(blockUuid: string): Promise<string | null> {
    try {
        const block = await logseq.Editor.getBlock(blockUuid);
        if (!block) return null;
        
        let context = block.content || '';
        
        // 获取父块内容
        if (block.parent && block.parent.id) {
            const parentBlock = await logseq.Editor.getBlock(block.parent.id);
            if (parentBlock && parentBlock.content) {
                context = parentBlock.content + '\n  ' + context;
            }
        }
        
        // 获取子块内容（限制数量）
        if (block.children && block.children.length > 0) {
            for (let i = 0; i < Math.min(block.children.length, 2); i++) {
                const childBlock = await logseq.Editor.getBlock(block.children[i][1]);
                if (childBlock && childBlock.content) {
                    context += '\n    ' + childBlock.content;
                }
            }
        }
        
        return context.length > 500 ? context.substring(0, 500) + '...' : context;
    } catch (error) {
        console.warn('获取块上下文时出错:', error);
        return null;
    }
}

/**
 * 去重相关内容
 * @param content 相关内容数组
 * @returns 去重后的内容数组
 */
function deduplicateContent(content: Array<{type: string, pageName: string, content: string}>): Array<{type: string, pageName: string, content: string}> {
    const seen = new Set<string>();
    const unique: Array<{type: string, pageName: string, content: string}> = [];
    
    for (const item of content) {
        const key = `${item.type}-${item.pageName}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
        }
    }
    
    return unique;
}

/**
 * 格式化相关内容为最终输出
 * @param currentPageName 当前页面名称
 * @param content 相关内容数组
 * @param tags 标签数组
 * @param references 引用数组
 * @returns 格式化后的内容字符串
 */
function formatRelatedContent(
    currentPageName: string, 
    content: Array<{type: string, pageName: string, content: string}>,
    tags: string[],
    references: string[]
): string {
    let result = `# 双链图库搜索结果\n\n`;
    result += `**当前页面**: ${currentPageName}\n`;
    
    if (tags.length > 0) {
        result += `**页面标签**: ${tags.map(tag => `#${tag}`).join(', ')}\n`;
    }
    
    if (references.length > 0) {
        result += `**页面引用**: ${references.map(ref => `[[${ref}]]`).join(', ')}\n`;
    }
    
    result += `**找到 ${content.length} 个相关页面**\n\n`;
    
    // 按类型分组显示
    const groupedContent = {
        '反向链接': content.filter(item => item.type === '反向链接'),
        '引用页面': content.filter(item => item.type === '引用页面'),
        '相同标签': content.filter(item => item.type === '相同标签')
    };
    
    for (const [type, items] of Object.entries(groupedContent)) {
        if (items.length > 0) {
            result += `## ${type} (${items.length}个)\n\n`;
            
            for (const item of items) {
                result += `### [[${item.pageName}]]\n\n`;
                result += item.content + '\n\n---\n\n';
            }
        }
    }
    
    return result;
}

/**
 * 递归提取块内容的辅助函数
 * @param blocks 块数组
 * @returns 提取的内容字符串
 */
function extractBlockContent(blocks: any[]): string {
    let content = '';
    for (const block of blocks) {
        if (block.content) {
            content += block.content + '\n';
        }
        if (block.children && block.children.length > 0) {
            content += extractBlockContent(block.children);
        }
    }
    return content;
}

async function generateGraphBasedResponse(currentPageName: string, userInput: string, model: string, apiKey: string, baseUrl: string, blockId: string): Promise<void> {
    try {
        // 获取基于双链的图库内容
        const graphContent = await getBacklinkGraphContent(currentPageName);
        
        // 构建系统提示词
        const systemPrompt = `你是一个智能助手，专门帮助用户基于他们的知识图库来回答问题。

以下是从用户的知识图库中基于双链和标签搜索到的相关内容：

${graphContent}

请基于上述图库内容来回答用户的问题。如果图库内容与问题不相关，请说明并尝试给出一般性的回答。

注意：
1. 优先使用图库中的信息
2. 如果图库信息不足，可以结合你的知识进行补充
3. 明确指出哪些信息来自图库，哪些是补充信息
4. 保持回答的准确性和相关性`;

        // 调用OpenAI API
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userInput }
                ],
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '抱歉，无法生成回答。';
        
        // 格式化内容为多个块
        const formattedBlocks = formatContentForLogseq(content);
        
        // 创建loading块
        const uuid: string|undefined = (await logseq.Editor.insertBlock(blockId, `loading...`))?.uuid;
        
        if (formattedBlocks.length === 1) {
            // 单个块，直接更新
            if (uuid) {
                await logseq.Editor.updateBlock(uuid, formattedBlocks[0]);
            } else {
                await logseq.Editor.insertBlock(blockId, formattedBlocks[0]);
            }
        } else {
            // 多个块，需要删除loading块并插入多个新块
            if (uuid) {
                await logseq.Editor.removeBlock(uuid);
            }
            
            // 插入多个格式化后的块
            for (let i = 0; i < formattedBlocks.length; i++) {
                await logseq.Editor.insertBlock(blockId, formattedBlocks[i]);
            }
        }
        await logseq.Editor.editBlock(blockId);
        
    } catch (error) {
        console.error('生成图库回答时出错:', error);
        logseq.UI.showMsg('生成回答时出现错误', 'error');
    }
}

/**
 * 检测当前块中的图片引用
 * @param content 块内容
 * @returns 图片路径数组
 */
function detectImages(content: string): string[] {
    const images: string[] = [];
    
    // 匹配 Markdown 图片语法: ![alt](path)
    const markdownImageRegex = /!\[.*?\]\(([^)]+)\)/g;
    let match;
    
    while ((match = markdownImageRegex.exec(content)) !== null) {
        images.push(match[1]);
    }
    
    // 匹配直接的图片路径引用
    const directImageRegex = /(?:^|\s)(\.\.\/assets\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))/gi;
    while ((match = directImageRegex.exec(content)) !== null) {
        images.push(match[1]);
    }
    
    return images;
}

/**
 * 检测块内容中的文件引用（包括图片和其他文件格式）
 * @param content 块内容
 * @returns 包含图片和文件路径的对象
 */
function detectFiles(content: string): {images: string[], files: string[]} {
    const images: string[] = [];
    const files: string[] = [];
    
    // 匹配 Markdown 文件语法: [text](path) 或 ![alt](path)
    const markdownLinkRegex = /!?\[.*?\]\(([^)]+)\)/g;
    let match;
    
    while ((match = markdownLinkRegex.exec(content)) !== null) {
        const filePath = match[1];
        if (isImageFile(filePath)) {
            images.push(filePath);
        } else if (isSupportedFile(filePath)) {
            files.push(filePath);
        }
    }
    
    // 匹配直接的文件路径引用
    const directFileRegex = /(?:^|\s)(\.\.\/assets\/[^\s]+\.(?:pdf|ppt|pptx|doc|docx|txt|json|csv|md|js|ts|py|java|html|css|xml|xlsx|xls))/gi;
    while ((match = directFileRegex.exec(content)) !== null) {
        files.push(match[1]);
    }
    
    // 匹配直接的图片路径引用
    const directImageRegex = /(?:^|\s)(\.\.\/assets\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))/gi;
    while ((match = directImageRegex.exec(content)) !== null) {
        images.push(match[1]);
    }
    
    return { images, files };
}

/**
 * 判断文件是否为图片格式
 * @param filePath 文件路径
 * @returns 是否为图片
 */
function isImageFile(filePath: string): boolean {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    const extension = filePath.split('.').pop()?.toLowerCase();
    return imageExtensions.includes(extension || '');
}

/**
 * 判断文件是否为支持的文件格式
 * @param filePath 文件路径
 * @returns 是否为支持的文件格式
 */
function isSupportedFile(filePath: string): boolean {
    const supportedExtensions = [
        'pdf', 'ppt', 'pptx', 'doc', 'docx', 'txt', 'json', 'csv', 'md',
        'js', 'ts', 'py', 'java', 'html', 'css', 'xml', 'xlsx', 'xls'
    ];
    const extension = filePath.split('.').pop()?.toLowerCase();
    return supportedExtensions.includes(extension || '');
}

/**
 * 获取文件的 MIME 类型
 * @param filePath 文件路径
 * @returns MIME 类型
 */
function getFileMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const mimeTypes: {[key: string]: string} = {
        'pdf': 'application/pdf',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'txt': 'text/plain',
        'json': 'application/json',
        'csv': 'text/csv',
        'md': 'text/markdown',
        'js': 'text/javascript',
        'ts': 'text/typescript',
        'py': 'text/x-python',
        'java': 'text/x-java-source',
        'html': 'text/html',
        'css': 'text/css',
        'xml': 'application/xml',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel'
    };
    return mimeTypes[extension || ''] || 'application/octet-stream';
}

/**
 * 将本地图片转换为 base64
 * @param imagePath 图片路径
 * @returns base64 编码的图片数据
 */
async function imageToBase64(imagePath: string): Promise<string | null> {
    try {
        console.log('处理图片路径:', imagePath);
        
        // 处理相对路径，转换为绝对路径
        let fullPath = imagePath;
        if (imagePath.startsWith('../assets/')) {
            // 获取当前图库路径
            const graphPath = await logseq.App.getCurrentGraph();
            console.log('当前图库路径:', graphPath);
            if (graphPath?.path) {
                fullPath = `${graphPath.path}/assets/${imagePath.replace('../assets/', '')}`;
                console.log('转换后的完整路径:', fullPath);
            }
        } else if (imagePath.startsWith('./assets/')) {
            // 处理 ./assets/ 格式
            const graphPath = await logseq.App.getCurrentGraph();
            if (graphPath?.path) {
                fullPath = `${graphPath.path}/assets/${imagePath.replace('./assets/', '')}`;
                console.log('转换后的完整路径:', fullPath);
            }
        } else if (imagePath.startsWith('assets/')) {
            // 处理 assets/ 格式
            const graphPath = await logseq.App.getCurrentGraph();
            if (graphPath?.path) {
                fullPath = `${graphPath.path}/${imagePath}`;
                console.log('转换后的完整路径:', fullPath);
            }
        }
        
        // 读取文件并转换为 base64
        const fileUrl = `file://${fullPath}`;
        console.log('尝试加载文件:', fileUrl);
        
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
        }
        
        const blob = await response.blob();
        console.log('文件加载成功，大小:', blob.size, 'bytes');
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                console.log('Base64 转换成功，长度:', result.length);
                // 返回 base64 数据（包含 data:image/xxx;base64, 前缀）
                resolve(result);
            };
            reader.onerror = (error) => {
                console.error('FileReader 错误:', error);
                reject(error);
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error converting image to base64:', error);
        return null;
    }
}

/**
 * 将本地文件转换为 base64
 * @param filePath 文件路径
 * @returns base64 编码的文件数据和 MIME 类型
 */
async function fileToBase64(filePath: string): Promise<{data: string, mimeType: string} | null> {
    try {
        console.log('处理文件路径:', filePath);
        
        // 处理相对路径，转换为绝对路径
        let fullPath = filePath;
        if (filePath.startsWith('../assets/')) {
            // 获取当前图库路径
            const graphPath = await logseq.App.getCurrentGraph();
            console.log('当前图库路径:', graphPath);
            if (graphPath?.path) {
                fullPath = `${graphPath.path}/assets/${filePath.replace('../assets/', '')}`;
                console.log('转换后的完整路径:', fullPath);
            }
        } else if (filePath.startsWith('./assets/')) {
            // 处理 ./assets/ 格式
            const graphPath = await logseq.App.getCurrentGraph();
            if (graphPath?.path) {
                fullPath = `${graphPath.path}/assets/${filePath.replace('./assets/', '')}`;
                console.log('转换后的完整路径:', fullPath);
            }
        } else if (filePath.startsWith('assets/')) {
            // 处理 assets/ 格式
            const graphPath = await logseq.App.getCurrentGraph();
            if (graphPath?.path) {
                fullPath = `${graphPath.path}/${filePath}`;
                console.log('转换后的完整路径:', fullPath);
            }
        }
        
        // 获取文件的 MIME 类型
        const mimeType = getFileMimeType(filePath);
        console.log('文件 MIME 类型:', mimeType);
        
        // 读取文件并转换为 base64
        const fileUrl = `file://${fullPath}`;
        console.log('尝试加载文件:', fileUrl);
        
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }
        
        const blob = await response.blob();
        console.log('文件加载成功，大小:', blob.size, 'bytes');
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                console.log('Base64 转换成功，长度:', result.length, 'MIME:', mimeType);
                // 返回 base64 数据和 MIME 类型
                resolve({ data: result, mimeType });
            };
            reader.onerror = (error) => {
                console.error('FileReader 错误:', error);
                reject(error);
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error converting file to base64:', error);
        return null;
    }
}

/**
 * 判断是否为网络图片 URL
 * @param path 图片路径
 * @returns 是否为网络 URL
 */
function isNetworkImage(path: string): boolean {
    return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * 下载并保存图片到 Logseq assets 文件夹
 * @param imageUrl 图片URL
 * @param filename 可选的文件名
 * @returns 包含本地路径和原始URL的对象
 */
async function downloadAndSaveImage(imageUrl: string, filename?: string): Promise<{localPath: string; originalUrl: string} | null> {
    try {
        console.log('📥 开始保存图片:', imageUrl);
        
        // 生成文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finalFilename = filename || `ai-generated-image-${timestamp}.png`;
        
        const { bridgeServiceUrl } = await getSettings();
        
        // 优先尝试通过桥接服务保存图片
        if (bridgeServiceUrl) {
            try {
                // 获取当前图谱路径
                const currentGraph = await logseq.App.getCurrentGraph();
                if (!currentGraph?.path) {
                    throw new Error('无法获取当前图谱路径');
                }
                
                console.log('🔄 通过桥接服务保存图片到:', currentGraph.path);
                
                const result = await bridgeServiceRequest('/api/files/save-image', bridgeServiceUrl, {
                    body: JSON.stringify({
                        imageUrl: imageUrl,
                        logseqPath: currentGraph.path,
                        filename: finalFilename
                    }),
                    timeout: 60000,
                    retries: 1
                });
                
                if (result.success) {
                    console.log('✅ 图片已通过桥接服务保存:', result.filePath);
                    logseq.UI.showMsg('图片生成并保存成功！', 'success');
                    
                    return {
                        localPath: result.filePath,
                        originalUrl: imageUrl
                    };
                } else {
                    throw new Error(result.error || '桥接服务保存失败');
                }
                
            } catch (bridgeError) {
                console.warn('⚠️ 桥接服务保存失败，使用备用方案:', bridgeError);
                // 继续执行备用方案
            }
        }
        
        // 备用方案：客户端下载和保存
        console.log('🔄 使用客户端备用方案下载图片');
        
        // 下载图片
        const response = await fetch(imageUrl);
        if (!response.ok) {
            console.error('❌ 下载图片失败:', response.status, response.statusText);
            logseq.UI.showMsg('下载图片失败，请检查网络连接', 'error');
            return null;
        }
        
        const blob = await response.blob();
        
        try {
            // 尝试使用 Logseq Assets API 保存图片
            const storage = logseq.Assets.makeSandboxStorage();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // 将 Uint8Array 转换为 base64 字符串
            const base64String = btoa(String.fromCharCode(...uint8Array));
            
            // 保存到 storage
            await storage.setItem(finalFilename, base64String);
            
            console.log('✅ 图片已保存到 Logseq assets:', finalFilename);
            logseq.UI.showMsg('图片生成并保存成功！', 'success');
            
            // 返回相对路径格式
            return {
                localPath: `assets/${finalFilename}`,
                originalUrl: imageUrl
            };
            
        } catch (assetsError) {
            console.warn('⚠️ Logseq Assets API 失败，使用浏览器下载:', assetsError);
            
            // 最后备用方案：使用浏览器下载API
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = finalFilename;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // 清理URL对象
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
            console.log('✅ 图片下载完成（浏览器下载）:', finalFilename);
            
            // 提示用户移动文件到assets目录
            logseq.UI.showMsg(
                `图片已下载到默认下载文件夹！\n请将 "${finalFilename}" 移动到 Logseq 的 assets 目录中，然后刷新页面查看图片`,
                'warning',
                { timeout: 10000 }
            );
            
            // 返回包含本地路径和原始URL的对象
            return {
                localPath: `assets/${finalFilename}`,
                originalUrl: imageUrl
            };
        }
        
    } catch (error) {
        console.error('❌ 保存图片过程中发生错误:', error);
        logseq.UI.showMsg('保存图片时发生错误', 'error');
        return null;
    }
}

/**
 * 使用 GPT-5 Nano 进行 OCR 识别
 * @param blockId 块 ID
 * @param imagePaths 图片路径数组
 */
/**
 * 执行图片生成
 * @param blockId 当前块ID
 * @param prompt 提示词
 * @param existingImages 现有图片路径（用于图生图）
 */
async function performTextToImageWithOriginalContent(blockId: string, prompt: string, imageApiKey: string, imageApiAddress: string, imageModel: string, originalContent: string): Promise<void> {
    console.log('🎨 降级为文生图模式，保留原始内容...');
    
    let apiUrl = imageApiAddress;
    if (!apiUrl.endsWith('/v1/images/generations')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/images/generations';
    }
    
    console.log('🚀 文生图 API URL:', apiUrl);
    
    const requestBody = {
        model: imageModel,
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "url"
    };
    
    console.log('📤 文生图请求参数:', requestBody);
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${imageApiKey}`
        },
        body: JSON.stringify(requestBody)
    });
    
    console.log('📥 响应状态:', response.status);
    
    if (!response.ok) {
         let errorMessage = `❌ 文生图失败：${response.status} ${response.statusText}`;
         try {
             const errorText = await response.text();
             console.error('❌ 文生图API错误:', errorText);
             errorMessage += `\n${errorText}`;
         } catch {
             errorMessage = `❌ 生图失败：${response.status} ${response.statusText}`;
         }
         
         await logseq.Editor.insertBlock(blockId, errorMessage, { sibling: false });
         await logseq.Editor.updateBlock(blockId, originalContent);
         return;
     }
    
    const result = await response.json();
    console.log('✅ 生图结果:', result);
    
    if (result.data && result.data.length > 0) {
        const imageUrl = result.data[0].url;
        
        // 下载并保存图片到本地
        const downloadResult = await downloadAndSaveImage(imageUrl);
        
        if (downloadResult) {
            const imageMarkdown = `![${prompt}](${downloadResult.localPath})`;
            // 在当前块的下一级子块末尾输出，保持原有结构不受影响
            await logseq.Editor.insertBlock(blockId, imageMarkdown, { sibling: false });
            await logseq.Editor.updateBlock(blockId, originalContent);
            console.log('✅ 图片已保存到本地:', downloadResult.localPath);
        } else {
            // 如果保存失败，显示错误信息而不使用网络URL
            await logseq.Editor.insertBlock(blockId, '❌ 图片保存失败', { sibling: false });
            await logseq.Editor.updateBlock(blockId, originalContent);
            console.log('⚠️ 图片保存失败');
        }
    } else {
        await logseq.Editor.insertBlock(blockId, '❌ 生图失败：API返回了空结果', { sibling: false });
        await logseq.Editor.updateBlock(blockId, originalContent);
    }
}

async function performTextToImage(blockId: string, prompt: string, imageApiKey: string, imageApiAddress: string, imageModel: string): Promise<void> {
    // 文生图：使用 /v1/images/generations 端点
    let apiUrl = imageApiAddress;
    if (!apiUrl.endsWith('/v1/images/generations')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/v1/images/generations';
    }
    
    console.log('🌐 文生图 API URL:', apiUrl);
    console.log('🔑 API Key (前8位):', imageApiKey.substring(0, 8) + '...');
    
    // 优化请求参数，增加更多选项
    const requestBody = {
        model: imageModel,
        prompt: prompt,
        size: "1024x1024",
        n: 1,
        quality: "standard", // 图片质量
        response_format: "url" // 明确指定返回格式
    };
    
    console.log('📤 文生图请求参数:', requestBody);
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${imageApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    
    console.log('📥 响应状态:', response.status);
    console.log('📥 响应头:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API错误:', errorText);
        
        let errorMessage = '';
        if (errorText.includes('<!doctype') || errorText.includes('<html')) {
            errorMessage = '❌ 错误：生图API地址配置错误，返回了HTML页面而非JSON响应。请检查API地址是否正确。';
        } else if (response.status === 401) {
            errorMessage = '❌ 错误：API Key无效或已过期，请检查生图API Key配置。';
        } else if (response.status === 403) {
            errorMessage = '❌ 错误：API访问被拒绝，请检查API Key权限或账户余额。';
        } else if (response.status === 429) {
            errorMessage = '❌ 错误：API请求频率过高，请稍后重试。';
        } else if (response.status === 500) {
            errorMessage = '❌ 错误：API服务器内部错误，请稍后重试。';
        } else {
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = `❌ 生图失败：${errorJson.error?.message || errorJson.message || errorText}`;
            } catch {
                errorMessage = `❌ 生图失败：${response.status} ${response.statusText}\n${errorText}`;
            }
        }
        
        await logseq.Editor.insertBlock(blockId, errorMessage, { sibling: false });
        return;
    }
    
    const result = await response.json();
    console.log('✅ 生图结果:', result);
    
    if (result.data && result.data.length > 0) {
        const imageUrl = result.data[0].url;
        
        // 下载并保存图片到本地
        const downloadResult = await downloadAndSaveImage(imageUrl);
        
        if (downloadResult) {
            const imageMarkdown = `![${prompt}](${downloadResult.localPath})`;
            // 在当前块的下一级子块末尾输出，保持原有结构不受影响
            await logseq.Editor.insertBlock(blockId, imageMarkdown, { sibling: false });
            console.log('✅ 图片已保存到本地:', downloadResult.localPath);
        } else {
            // 如果保存失败，显示错误信息而不使用网络URL
            await logseq.Editor.insertBlock(blockId, `❌ 图片保存失败`, { sibling: false });
            console.log('⚠️ 图片保存失败');
        }
    } else {
        await logseq.Editor.insertBlock(blockId, '❌ 生图失败：API返回了空结果', { sibling: false });
    }
}

// 异步图像生成函数
async function performImageGeneration(blockId: string, prompt: string, existingImages: string[] = []): Promise<void> {
    try {
        const settings = await getSettings();
        const { bridgeServiceUrl } = settings;
        
        if (!bridgeServiceUrl || bridgeServiceUrl.trim() === '') {
            const configError = `❌ **图像生成失败：桥接服务未配置**\n🔧 **解决步骤：**\n1. 打开插件设置页面\n2. 配置桥接服务地址 (通常是 http://localhost:3000)\n3. 确保桥接服务正在运行\n4. 验证API密钥已正确配置\n\n**提示：** 桥接服务是图像生成功能的必需组件`;
            await logseq.Editor.insertBlock(blockId, configError, { sibling: false });
            return;
        }
        
        // 检查提示词长度限制
        const maxPromptLength = 1000;
        let processedPrompt = prompt;
        
        if (prompt.length > maxPromptLength) {
            // 截断提示词并添加提示
            processedPrompt = prompt.substring(0, maxPromptLength);
            await logseq.Editor.insertBlock(blockId, `⚠️ 提示词过长（${prompt.length} 字符），已自动截断至 ${maxPromptLength} 字符`, { sibling: false });
            console.log(`⚠️ 提示词截断: ${prompt.length} -> ${maxPromptLength} 字符`);
        }
        
        // 获取当前块的内容，用于保留原始提示词
        const currentBlock = await logseq.Editor.getBlock(blockId);
        const originalContent = currentBlock?.content || '';
        
        console.log('🎨 开始异步生图...', { prompt: processedPrompt, originalPromptLength: prompt.length, existingImages });
        
        // 获取 Logseq assets 目录的绝对路径
        const currentGraph = await logseq.App.getCurrentGraph();
        if (!currentGraph) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：无法获取当前图谱信息', { sibling: false });
            return;
        }
        
        const assetsPath = `${currentGraph.path}/assets`;
        console.log('📁 Assets 目录路径:', assetsPath);
        
        // 判断是文生图还是图生图
        const isImageToImage = existingImages.length > 0;
        
        // 生成文件名
        const timestamp = Date.now();
        const filename = `generated_image_${timestamp}.png`;
        
        // 获取图像生成设置
        const imageModel = settings.imageModel || 'qwen-image';
        const imageSize = '1024x1024'; // 默认图片尺寸
        
        // 构建任务请求 - 匹配桥接服务期望的参数格式
        const taskRequest: any = {
            type: isImageToImage ? 'image-to-image' : 'text-to-image',
            prompt: processedPrompt,
            config: {
                model: imageModel,
                size: imageSize,
                quality: 'standard',
                style: 'vivid'
            },
            logseqPath: assetsPath,
            filename: filename
        };
        
        // 如果是图生图，添加图片信息
        if (isImageToImage) {
            taskRequest.inputImages = existingImages;
        }
        
        console.log('📤 发送图像生成任务请求:', taskRequest);
        
        // 创建异步任务
        const response = await fetch(`${bridgeServiceUrl}/api/image/create-task`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskRequest)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ 创建图像生成任务失败:', errorText);
            
            let errorMessage = '';
            if (response.status === 404) {
                errorMessage = `❌ 图像生成失败：桥接服务端点不存在 (${response.status})\n🔧 **可能原因：**\n• 桥接服务版本过旧，请更新服务\n• 服务未正确启动图像生成模块`;
            } else if (response.status === 500) {
                errorMessage = `❌ 图像生成失败：服务器内部错误 (${response.status})\n🔧 **可能原因：**\n• API密钥配置错误或已过期\n• 图像生成服务不可用\n• 服务器配置问题`;
            } else if (response.status === 401 || response.status === 403) {
                errorMessage = `❌ 图像生成失败：认证失败 (${response.status})\n🔧 **可能原因：**\n• API密钥未配置或错误\n• API密钥已过期\n• 权限不足`;
            } else if (response.status >= 400 && response.status < 500) {
                errorMessage = `❌ 图像生成失败：请求错误 (${response.status})\n🔧 **可能原因：**\n• 提示词格式不正确\n• 参数配置错误\n• 请求格式不符合要求`;
            } else {
                errorMessage = `❌ 图像生成失败：网络或服务错误 (${response.status})\n🔧 **可能原因：**\n• 桥接服务未启动或不可访问\n• 网络连接问题\n• 服务器临时不可用`;
            }
            
            await logseq.Editor.insertBlock(blockId, errorMessage, { sibling: false });
            return;
        }
        
        const result = await response.json();
        console.log('✅ 图像生成任务创建成功:', result);
        
        if (!result.taskId) {
            await logseq.Editor.insertBlock(blockId, '❌ 创建图像生成任务失败：未返回任务ID', { sibling: false });
            return;
        }
        
        // 插入子块显示任务进度，保留原始提示词
        const placeholderContent = `🎨 **正在生成图片...** (任务ID: ${result.taskId})\n![生成中...]()`;
        
        await logseq.Editor.insertBlock(blockId, placeholderContent, { sibling: false });
        
        // 开始轮询任务状态
        pollImageTaskStatus(result.taskId, bridgeServiceUrl, { uuid: blockId }, processedPrompt);
        
        logseq.UI.showMsg('🎨 图像生成任务已创建，正在后台处理...', 'success');
        
    } catch (error) {
        console.error('❌ 图像生成过程中发生错误:', error);
        
        let errorMessage = '';
        
        if (error instanceof TypeError && error.message.includes('fetch')) {
            // 网络连接错误
            errorMessage = `❌ **图像生成失败：无法连接到桥接服务**\n🔧 **诊断步骤：**\n1. **检查桥接服务状态**\n   • 确认服务是否正在运行\n   • 访问 http://localhost:3000/api/health 检查服务健康状态\n2. **验证服务地址配置**\n   • 检查插件设置中的桥接服务地址\n   • 确认地址格式正确（如：http://localhost:3000）\n3. **网络连接检查**\n   • 确认防火墙未阻止连接\n   • 检查端口3000是否被占用\n\n**提示：** 如果服务刚启动，请等待几秒后重试`;
        } else if (error instanceof Error) {
            // 其他已知错误
            if (error.message.includes('timeout')) {
                errorMessage = `❌ **图像生成失败：请求超时**\n🔧 **可能原因：**\n• 桥接服务响应缓慢\n• 网络连接不稳定\n• 服务器负载过高\n\n**建议：** 请稍后重试，或检查网络连接`;
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = `❌ **图像生成失败：连接被拒绝**\n🔧 **解决方案：**\n• 启动桥接服务：\n  \`cd packages/mcp-bridge-service && npm run dev\`\n• 确认服务运行在正确端口（默认3000）\n• 检查服务配置文件`;
            } else {
                errorMessage = `❌ **图像生成失败：** ${error.message}\n\n🔧 **通用排查步骤：**\n1. 检查桥接服务是否运行\n2. 验证API配置是否正确\n3. 查看浏览器控制台获取详细错误信息`;
            }
        } else {
            // 未知错误类型
            errorMessage = `❌ **图像生成失败：未知错误**\n🔧 **排查建议：**\n1. 重启桥接服务\n2. 检查插件配置\n3. 查看浏览器控制台获取详细信息\n\n**错误详情：** ${String(error)}`;
        }
        
        // 插入子块显示错误信息，保留原始提示词
        try {
            await logseq.Editor.insertBlock(blockId, errorMessage, { sibling: false });
        } catch (insertError) {
            console.error('❌ 插入错误信息失败:', insertError);
            logseq.UI.showMsg(`图像生成失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
    }
}

async function performImageEdit(blockId: string, prompt: string, imagePaths: string[], maskPath?: string | null): Promise<void> {
    try {
        const settings = await getSettings();
        const { 
            bridgeServiceUrl,
            imageEditModel,
            imageEditQuality,
            imageEditResponseFormat,
            imageEditSize,
            imageEditCount
        } = settings;
        
        if (!bridgeServiceUrl || bridgeServiceUrl.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置桥接服务地址', { sibling: false });
            return;
        }
        
        // 获取当前块内容以保留原始提示词
        const currentBlock = await logseq.Editor.getBlock(blockId);
        const originalContent = currentBlock?.content || '';
        
        console.log('🎨 开始异步图片编辑...', { prompt, imagePaths, maskPath });
        
        // 获取 Logseq assets 目录的绝对路径
        const currentGraph = await logseq.App.getCurrentGraph();
        if (!currentGraph) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：无法获取当前图谱信息', { sibling: false });
            return;
        }
        
        const assetsPath = `${currentGraph.path}/assets`;
        console.log('📁 Assets 目录路径:', assetsPath);
        
        // 构建任务请求
        const taskRequest: any = {
            prompt: prompt,
            assetsPath: assetsPath,
            type: 'image-edit',
            imagePath: imagePaths[0],
            config: {
                editModel: imageEditModel || 'qwen-image-edit',
                editQuality: imageEditQuality || 'auto',
                responseFormat: imageEditResponseFormat || 'url',
                editSize: imageEditSize || 'auto',
                editCount: parseInt(imageEditCount || '1')
            }
        };
        
        // 如果有遮罩图片，添加到请求中
        if (maskPath) {
            taskRequest.maskPath = maskPath;
        }
        
        console.log('🔧 图片编辑配置:', taskRequest.config);
        
        console.log('📤 发送图片编辑任务请求:', taskRequest);
        
        // 创建异步任务
        const response = await fetch(`${bridgeServiceUrl}/api/image/create-task`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskRequest)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ 创建图片编辑任务失败:', errorText);
            await logseq.Editor.insertBlock(blockId, `❌ 创建图片编辑任务失败：${response.status} ${response.statusText}`, { sibling: false });
            return;
        }
        
        const result = await response.json();
        console.log('✅ 图片编辑任务创建成功:', result);
        
        if (!result.taskId) {
            await logseq.Editor.insertBlock(blockId, '❌ 创建图片编辑任务失败：未返回任务ID', { sibling: false });
            return;
        }
        
        // 插入子块显示任务进度，保留原始提示词
        const placeholderContent = `🎨 **正在编辑图片...** (任务ID: ${result.taskId})\n![编辑中...]()`;
        
        await logseq.Editor.insertBlock(blockId, placeholderContent, { sibling: false });
        
        // 开始轮询任务状态
        pollImageTaskStatus(result.taskId, bridgeServiceUrl, { uuid: blockId }, prompt);
        
        logseq.UI.showMsg('🎨 图片编辑任务已创建，正在后台处理...', 'success');
        
    } catch (error) {
        console.error('❌ 图片编辑过程中发生错误:', error);
        
        // 插入子块显示错误信息，保留原始提示词
        try {
            await logseq.Editor.insertBlock(blockId, `❌ 图片编辑失败：${error instanceof Error ? error.message : '未知错误'}`, { sibling: false });
        } catch (insertError) {
            console.error('❌ 插入错误信息失败:', insertError);
            logseq.UI.showMsg(`图片编辑失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
    }
}

/**
 * 执行文件分析
 * @param blockId 块 ID
 * @param filePaths 文件路径数组
 */
async function performFileAnalysis(blockId: string, filePaths: string[]): Promise<void> {
    try {
        console.log('开始文件分析，文件数量:', filePaths.length);
        
        if (filePaths.length === 0) {
            await logseq.Editor.updateBlock(blockId, '❌ 未找到可分析的文件');
            return;
        }
        
        // 获取设置
        const settings = await getSettings();
        const { openaiKey, openaiAddress, gptModel } = settings;
        
        if (!openaiKey) {
            await logseq.Editor.updateBlock(blockId, '❌ 请先配置 OpenAI API Key');
            return;
        }
        
        // 显示处理中状态
        await logseq.Editor.updateBlock(blockId, '🔄 正在分析文件...');
        
        // 处理文件
        const fileContents = [];
        for (const filePath of filePaths) {
            console.log('处理文件:', filePath);
            
            if (isImageFile(filePath)) {
                // 图片文件使用 base64 编码的 image_url 格式
                const fileData = await fileToBase64(filePath);
                if (fileData) {
                    fileContents.push({
                        type: 'image_url',
                        image_url: {
                            url: fileData.data,
                            detail: 'high'
                        }
                    });
                    console.log('图片文件转换成功:', filePath, 'MIME:', fileData.mimeType);
                } else {
                    console.error('图片文件转换失败:', filePath);
                }
            } else {
                // 文本文件直接读取内容作为文本
                try {
                    const graph = await logseq.App.getCurrentGraph();
                    const absolutePath = filePath.startsWith('/') ? filePath : `${graph?.path}/${filePath}`;
                    const response = await fetch(`file://${absolutePath}`);
                    const textContent = await response.text();
                    
                    fileContents.push({
                        type: 'text',
                        text: `文件名: ${filePath.split('/').pop()}\n文件内容:\n${textContent}`
                    });
                    console.log('文本文件读取成功:', filePath, '内容长度:', textContent.length);
                } catch (error) {
                    console.error('文本文件读取失败:', filePath, error);
                    // 如果直接读取失败，尝试使用 base64 方式
                    const fileData = await fileToBase64(filePath);
                    if (fileData && fileData.data.startsWith('data:text/')) {
                        try {
                            const base64Content = fileData.data.split(',')[1];
                            const textContent = atob(base64Content);
                            fileContents.push({
                                type: 'text',
                                text: `文件名: ${filePath.split('/').pop()}\n文件内容:\n${textContent}`
                            });
                            console.log('文本文件 base64 解码成功:', filePath);
                        } catch (decodeError) {
                            console.error('文本文件 base64 解码失败:', filePath, decodeError);
                        }
                    }
                }
            }
        }
        
        if (fileContents.length === 0) {
            await logseq.Editor.updateBlock(blockId, '❌ 文件处理失败，请检查文件路径是否正确');
            return;
        }
        
        // 构建消息内容
        const messageContent = [
            {
                type: 'text',
                text: `请分析这${fileContents.length}个文件的内容。请提供详细的分析，包括：

1. 文件类型和格式
2. 主要内容概述
3. 关键信息提取
4. 结构分析（如适用）
5. 重要发现或见解

请用中文回答，并保持分析的准确性和完整性。`
            },
            ...fileContents
        ];
        
        // 构建 API 请求
        const apiUrl = openaiAddress.includes('/chat/completions') 
            ? openaiAddress 
            : `${openaiAddress}/chat/completions`;
        
        const requestBody = {
            model: gptModel || 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: messageContent
                }
            ],
            max_tokens: 4000,
            temperature: 0.1
        };
        
        console.log('=== 文件分析 API 调用详情 ===');
        console.log('原始 openaiAddress 设置:', openaiAddress);
        console.log('构建的 API URL:', apiUrl);
        console.log('使用的模型:', gptModel || 'gpt-4o');
        console.log('文件数量:', fileContents.length);
        console.log('请求体:', JSON.stringify(requestBody, null, 2));
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        // 获取响应文本
        const responseText = await response.text();
        console.log('API 响应状态:', response.status);
        console.log('API 响应内容类型:', response.headers.get('content-type'));
        console.log('API 响应内容（前500字符）:', responseText.substring(0, 500));
        
        if (!response.ok) {
            console.error('API 调用失败:', response.status, responseText);
            
            // 检查是否返回了 HTML 错误页面
            if (responseText.includes('<html>') || responseText.includes('<!DOCTYPE')) {
                await logseq.Editor.updateBlock(blockId, `❌ API 调用失败：服务器返回了错误页面\n\n请检查以下配置：\n1. OpenAI API 地址是否正确\n2. 网络连接是否正常\n3. API Key 是否有效\n\n当前 API 地址: ${apiUrl}`);
                return;
            }
            
            await logseq.Editor.updateBlock(blockId, `❌ API 调用失败: ${response.status} ${response.statusText}\n\n错误详情: ${responseText.substring(0, 200)}`);
            return;
        }
        
        // 检查响应是否为 JSON 格式
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('JSON 解析失败:', parseError);
            console.error('响应内容:', responseText);
            
            // 检查是否返回了 HTML 页面
            if (responseText.includes('<html>') || responseText.includes('<!DOCTYPE')) {
                await logseq.Editor.updateBlock(blockId, `❌ 服务器返回了 HTML 页面而非 JSON 数据\n\n这通常表示：\n1. API 地址配置错误\n2. 服务器返回了错误页面\n3. 网络代理或防火墙问题\n\n当前 API 地址: ${apiUrl}\n\n请检查 OpenAI API 地址配置是否正确`);
                return;
            }
            
            await logseq.Editor.updateBlock(blockId, `❌ 文件分析失败: 服务器返回了无效的 JSON 数据\n\n响应内容: ${responseText.substring(0, 200)}`);
            return;
        }
        console.log('API 响应:', data);
        
        if (!data.choices || data.choices.length === 0 || !data.choices[0].message?.content) {
            console.error('API 返回空结果:', data);
            await logseq.Editor.updateBlock(blockId, '❌ API 返回空结果，请重试');
            return;
        }
        
        const analysisResult = data.choices[0].message.content;
        console.log('文件分析结果:', analysisResult);
        
        // 格式化结果并插入到块中
        const formattedContent = formatContentForLogseq(analysisResult);
        
        // 更新当前块为结果标题
        await logseq.Editor.updateBlock(blockId, `📄 文件分析结果 (${filePaths.length}个文件)`);
        
        // 插入分析结果
        for (let i = 0; i < formattedContent.length; i++) {
            await logseq.Editor.insertBlock(blockId, formattedContent[i], {
                sibling: false,
                before: false
            });
        }
        
        console.log('文件分析完成');
        
    } catch (error) {
        console.error('文件分析过程中出错:', error);
        await logseq.Editor.updateBlock(blockId, `❌ 文件分析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}


async function performOCR(blockId: string, imagePaths: string[]): Promise<void> {
    try {
        const { openaiKey, openaiAddress, gptModel } = await getSettings();
        
        if (!openaiKey || !openaiAddress) {
            throw new Error('请先配置 OpenAI API Key 和地址');
        }
        
        if (imagePaths.length === 0) {
            throw new Error('未找到图片，请确保当前块包含图片引用');
        }
        
        // 创建加载提示
        const uuid: string | undefined = (await logseq.Editor.insertBlock(blockId, `正在识别图片文字...`))?.uuid;
        
        // 处理图片数据
        const imageContents: Array<{type: string, image_url?: {url: string}, text?: string}> = [];
        
        for (const imagePath of imagePaths) {
            if (isNetworkImage(imagePath)) {
                // 网络图片直接使用 URL
                imageContents.push({
                    type: "image_url",
                    image_url: {
                        url: imagePath
                    }
                });
            } else {
                // 本地图片转换为 base64
                const base64Data = await imageToBase64(imagePath);
                if (base64Data) {
                    imageContents.push({
                        type: "image_url",
                        image_url: {
                            url: base64Data
                        }
                    });
                } else {
                    console.warn(`无法加载图片: ${imagePath}`);
                }
            }
        }
        
        if (imageContents.length === 0) {
            throw new Error('无法加载任何图片，请检查图片路径是否正确');
        }
        
        // 构建消息内容 - 优化后的提示词
        const messageContent = [
            {
                type: "text",
                text: `请仔细识别图片中的所有文字内容，并严格按照以下要求输出：

1. **格式要求**：
   - 使用标准的 Markdown 格式
   - 保持原始的文字排列顺序和段落结构
   - 如果是表格，使用 Markdown 表格语法
   - 如果是列表，使用 Markdown 列表语法（- 或 1. ）
   - 如果是标题，使用 Markdown 标题语法（# ## ###）

2. **内容要求**：
   - 准确识别主要可见文字，包括标点符号
   - 保持原文的语言（中文、英文等）
   - 不要添加任何解释或说明文字
   - 不要使用代码块包裹内容

请开始识别图片内容：`
            },
            ...imageContents
        ];
        
        // 调用 OpenAI API - 修复 URL 构建逻辑
        let apiUrl;
        if (openaiAddress.includes('/v1/chat/completions')) {
            // 如果地址已经包含完整端点，直接使用
            apiUrl = openaiAddress;
        } else {
            // 否则拼接端点
            apiUrl = `${openaiAddress.replace(/\/$/, '')}/v1/chat/completions`;
        }
        console.log('OCR API 调用信息:', { 
            originalAddress: openaiAddress,
            finalApiUrl: apiUrl, 
            model: gptModel || "gpt-4o", 
            imageCount: imageContents.length 
        });
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: gptModel || "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: messageContent
                    }
                ],
                max_tokens: 4000
            })
        });
        
        if (!response.ok) {
            let errorMessage = `API 调用失败 (${response.status}): ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMessage = `API 调用失败: ${errorData.error?.message || errorMessage}`;
            } catch (e) {
                // 如果返回的不是JSON，可能是HTML错误页面
                const textResponse = await response.text();
                if (textResponse.includes('<!doctype') || textResponse.includes('<html')) {
                    errorMessage = `API 地址配置错误，返回了HTML页面而不是API响应。请检查 OpenAI Address 配置是否正确。当前地址: ${openaiAddress}`;
                } else {
                    errorMessage = `API 调用失败: ${textResponse.substring(0, 200)}`;
                }
            }
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        const result = data.choices[0]?.message?.content;
        
        if (!result) {
            throw new Error('API 返回空结果');
        }
        
        // 格式化内容为多个块
        const formattedBlocks = formatContentForLogseq(result);
        
        if (formattedBlocks.length === 1) {
            // 单个块，直接更新
            if (uuid) {
                await logseq.Editor.updateBlock(uuid, formattedBlocks[0]);
            } else {
                await logseq.Editor.insertBlock(blockId, formattedBlocks[0]);
            }
        } else {
            // 多个块，需要删除loading块并插入多个新块
            if (uuid) {
                await logseq.Editor.removeBlock(uuid);
            }
            
            // 插入多个格式化的块
            for (let i = 0; i < formattedBlocks.length; i++) {
                await logseq.Editor.insertBlock(blockId, formattedBlocks[i]);
            }
        }
        
    } catch (error: any) {
        console.error('OCR 识别失败:', error);
        logseq.UI.showMsg(`OCR 识别失败: ${error.message}`, 'error');
        
        // 插入错误信息作为子块
        await logseq.Editor.insertBlock(blockId, `❌ OCR 识别失败: ${error.message}`, { sibling: false });
    }
}

/**
 * 下载并保存音频文件
 * @param audioUrl 音频URL
 * @param filename 文件名（可选）
 * @returns 保存结果
 */
async function downloadAndSaveAudio(audioUrl: string, filename?: string): Promise<{localPath: string; originalUrl: string} | null> {
    try {
        console.log('🎵 开始下载音频:', audioUrl);
        
        const response = await fetch(audioUrl);
        if (!response.ok) {
            console.error('❌ 音频下载失败:', response.status, response.statusText);
            return null;
        }
        
        const audioBuffer = await response.arrayBuffer();
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        
        // 生成文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const audioFilename = filename || `tts-audio-${timestamp}.mp3`;
        
        // 保存到 assets 目录
        const assetsPath = '../assets';
        const localPath = `${assetsPath}/${audioFilename}`;
        
        // 创建下载链接并触发下载
        const downloadUrl = URL.createObjectURL(audioBlob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = audioFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
        
        console.log('✅ 音频已保存:', localPath);
        
        return {
            localPath,
            originalUrl: audioUrl
        };
    } catch (error) {
        console.error('❌ 音频下载保存失败:', error);
        return null;
    }
}



/**
 * 执行文本转语音
 * @param blockId 当前块ID
 * @param text 要转换的文本
 */
async function performTextToSpeech(blockId: string, text: string): Promise<void> {
    try {
        const settings = await getSettings();
        const { ttsApiKey, ttsApiAddress, ttsModel, ttsVoice, ttsResponseFormat, ttsSpeed, bridgeServiceUrl } = settings;
        
        if (!ttsApiKey || ttsApiKey.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置TTS API Key', { sibling: false });
            return;
        }
        
        if (!ttsApiAddress || ttsApiAddress.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置TTS API地址', { sibling: false });
            return;
        }
        
        if (!text || text.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：没有找到要转换的文本内容', { sibling: false });
            return;
        }
        
        // 获取当前 Logseq 图谱路径
        const currentGraph = await logseq.App.getCurrentGraph();
        if (!currentGraph || !currentGraph.path) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：无法获取当前图谱路径', { sibling: false });
            return;
        }
        
        const logseqPath = currentGraph.path;
        console.log('📁 Logseq图谱路径:', logseqPath);
        
        // 构建API URL
        let apiUrl = ttsApiAddress;
        if (!apiUrl.endsWith('/v1/audio/speech')) {
            apiUrl = apiUrl.replace(/\/$/, '') + '/v1/audio/speech';
        }
        
        console.log('🎵 TTS API URL:', apiUrl);
        console.log('🔑 API Key (前8位):', ttsApiKey.substring(0, 8) + '...');
        console.log('📝 转换文本:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
        console.log('🎯 TTS模型:', ttsModel);
        
        // 显示处理提示 - 插入子块保留原始提示词
        const processingBlockId = await logseq.Editor.insertBlock(blockId, `🎵 正在使用${ttsModel}生成语音...`, { sibling: false });
        
        // 确保使用OpenAI兼容的音色
        let finalVoice = ttsVoice;
        const openaiVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
        
        if (!openaiVoices.includes(ttsVoice)) {
            finalVoice = 'alloy'; // 默认使用alloy音色
            console.log('⚠️ 检测到非OpenAI音色，自动切换为alloy');
        }
        
        // 构建请求参数
        const requestBody = {
            model: ttsModel,
            input: text,
            voice: finalVoice,
            response_format: ttsResponseFormat,
            speed: parseFloat(ttsSpeed)
        };
        
        console.log('📤 TTS请求参数:', requestBody);
        
        // 发送API请求
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ttsApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('📥 响应状态:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ TTS API错误:', errorText);
            
            let errorMessage = '';
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error?.message || errorData.message || '未知错误';
            } catch {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            
            await logseq.Editor.insertBlock(blockId, `❌ 语音生成失败：${errorMessage}`, { sibling: false });
            return;
        }
        
        // 获取音频数据
        const audioBuffer = await response.arrayBuffer();
        const audioBlob = new Blob([audioBuffer], { type: `audio/${ttsResponseFormat}` });
        
        // 生成文件名（使用简洁的格式，类似图片命名）
        const timestamp = Date.now();
        const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').substring(0, 10); // 提取前10个有效字符
        const filename = `${cleanText || 'tts'}_${timestamp}_0.${ttsResponseFormat}`;
        
        // 检查是否配置了桥接服务
        console.log('🔍 桥接服务配置检查:', { bridgeServiceUrl, isEmpty: !bridgeServiceUrl || bridgeServiceUrl.trim() === '' });
        
        if (bridgeServiceUrl && bridgeServiceUrl.trim() !== '') {
            // 使用异步桥接服务处理TTS
            try {
                console.log('🌉 使用异步桥接服务处理TTS，地址:', bridgeServiceUrl);
                
                // 创建TTS任务
                const createTaskUrl = bridgeServiceUrl.replace(/\/$/, '') + '/api/tts/create-task';
                const taskResponse = await fetch(createTaskUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: text,
                        config: {
                            model: ttsModel,
                            voice: finalVoice,
                            responseFormat: ttsResponseFormat,
                            speed: parseFloat(ttsSpeed),
                            ttsApiKey: ttsApiKey,
                            ttsApiAddress: apiUrl
                        },
                        logseqPath: logseqPath,
                        filename: filename
                    })
                });
                
                if (taskResponse.ok) {
                    const taskResult = await taskResponse.json();
                    if (taskResult.success) {
                        const taskId = taskResult.taskId;
                        
                        // 更新处理中的占位链接到已创建的子块
                        if (processingBlockId) {
                            const placeholderMarkdown = `🎵 语音生成中... (任务ID: ${taskId})`;
                            await logseq.Editor.updateBlock(processingBlockId.uuid, placeholderMarkdown);
                            
                            console.log('✅ TTS任务已创建:', taskId);
                            
                            // 开始轮询任务状态，传递子块ID
                            pollTTSTaskStatus(taskId, bridgeServiceUrl, { uuid: processingBlockId.uuid });
                        } else {
                            console.error('❌ 无法创建处理提示块');
                            await logseq.Editor.insertBlock(blockId, `❌ 语音生成失败：无法创建处理提示`, { sibling: false });
                            return;
                        }
                        
                        return; // 异步处理，直接返回
                    } else {
                        console.error('❌ 创建TTS任务失败:', taskResult.error);
                        throw new Error(taskResult.error);
                    }
                } else {
                    const errorText = await taskResponse.text();
                    console.error('❌ 桥接服务请求失败:', errorText);
                    throw new Error(`桥接服务错误: ${taskResponse.status}`);
                }
            } catch (bridgeError) {
                console.warn('⚠️ 异步桥接服务处理失败，回退到同步方式:', bridgeError);
                
                // 回退到同步桥接服务方式
                try {
                    console.log('🔄 尝试同步桥接服务方式');
                    
                    // 将音频数据转换为 base64
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
                    
                    // 调用桥接服务的文件保存API
                    const bridgeUrl = bridgeServiceUrl.replace(/\/$/, '') + '/api/files/save-tts';
                    const bridgeResponse = await fetch(bridgeUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            audioData: base64Audio,
                            logseqPath: logseqPath,
                            filename: filename,
                            mimeType: `audio/${ttsResponseFormat}`
                        })
                    });
                    
                    if (bridgeResponse.ok) {
                        const result = await bridgeResponse.json();
                        if (result.success) {
                            // 生成音频链接的Markdown
                            const audioMarkdown = `![${result.filename}](${result.filePath})`;
                            
                            // 插入音频链接作为子块
                            await logseq.Editor.insertBlock(blockId, audioMarkdown, { sibling: false });
                            
                            logseq.UI.showMsg(
                                `🎵 语音已自动保存到 assets 目录！\n文件名：${result.filename}`,
                                'success',
                                { timeout: 5000 }
                            );
                            
                            console.log('✅ 语音生成并保存完成:', result.filename);
                            return; // 成功处理，直接返回
                        } else {
                            console.error('❌ 桥接服务文件保存失败:', result.error);
                            throw new Error(result.error);
                        }
                    } else {
                        const errorText = await bridgeResponse.text();
                        console.error('❌ 桥接服务请求失败:', errorText);
                        throw new Error(`桥接服务错误: ${bridgeResponse.status}`);
                    }
                } catch (syncBridgeError) {
                    console.warn('⚠️ 同步桥接服务也失败，回退到传统下载方式:', syncBridgeError);
                    // 继续执行传统下载方式
                }
            }
        } else {
            console.log('🔧 未配置桥接服务，回退到传统下载方式');
        }
        
        // 传统的下载方式作为备选方案
        console.log('📥 使用传统下载方式');
        const downloadUrl = URL.createObjectURL(audioBlob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // 清理URL对象
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        
        // 生成音频链接的Markdown（使用图片格式，这样可以在Logseq中正确显示）
        const audioMarkdown = `![${filename}](../assets/${filename})`;
        
        // 插入音频链接作为子块
        await logseq.Editor.insertBlock(blockId, audioMarkdown, { sibling: false });
        
        // 提示用户移动文件到assets目录
        logseq.UI.showMsg(
            `🎵 语音已下载到默认下载文件夹！\n请将 "${filename}" 移动到 Logseq 的 assets 目录中`,
            'success',
            { timeout: 8000 }
        );
        
        console.log('✅ 语音生成完成:', filename);
        
    } catch (error) {
        console.error('❌ TTS过程中发生错误:', error);
        
        try {
            // 尝试插入错误信息到新块
            await logseq.Editor.insertBlock(blockId, `❌ 语音生成失败：${error instanceof Error ? error.message : '未知错误'}`, { sibling: false });
        } catch (updateError) {
            console.error('❌ 插入错误信息失败:', updateError);
            logseq.UI.showMsg(`语音生成失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
    }
}

/**
 * 执行Qwen文本转语音（强制使用qwen-tts模型）
 * @param blockId 当前块ID
 * @param text 要转换的文本
 */
/**
 * 执行Qwen文本转语音 (使用阿里云DashScope API)
 * @param blockId 当前块ID
 * @param text 要转换的文本
 */
async function performQwenTextToSpeech(blockId: string, text: string): Promise<void> {
    try {
        const settings = await getSettings();
        const { dashscopeApiKey, qwenTtsModel, qwenTtsVoice, qwenTtsFormat, bridgeServiceUrl } = settings;
        
        if (!dashscopeApiKey || dashscopeApiKey.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置DashScope API Key', { sibling: false });
            return;
        }
        
        if (!text || text.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：没有找到要转换的文本内容', { sibling: false });
            return;
        }
        
        // 检查文本长度限制
        if (text.length > 500) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：文本长度超过500字符限制', { sibling: false });
            return;
        }
        
        console.log('🎵 使用阿里云DashScope Qwen-TTS (异步模式)');
        console.log('🔑 API Key (前8位):', dashscopeApiKey.substring(0, 8) + '...');
        console.log('🤖 模型:', qwenTtsModel);
        console.log('📝 转换文本:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
        console.log('🎯 音色:', qwenTtsVoice);
        console.log('🎵 格式:', qwenTtsFormat);
        
        // 生成文件名
        const timestamp = Date.now();
        const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').substring(0, 10);
        const filename = `qwen-${cleanText || 'tts'}_${timestamp}_0.${qwenTtsFormat}`;
        
        // 不插入处理提示，直接开始生成
        
        // 获取当前 Logseq 图谱路径
        const currentGraph = await logseq.App.getCurrentGraph();
        if (!currentGraph || !currentGraph.path) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：无法获取当前图谱路径', { sibling: false });
            return;
        }
        const logseqPath = currentGraph.path;
        
        // 调用桥接服务创建异步TTS任务
        const createTaskResponse = await fetch(`${bridgeServiceUrl}/api/qwen-tts/create-task`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                config: {
                    model: qwenTtsModel,
                    voice: qwenTtsVoice,
                    responseFormat: qwenTtsFormat,
                    qwenApiKey: dashscopeApiKey,
                    qwenApiAddress: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
                },
                logseqPath: logseqPath,
                filename: filename
            })
        });
        
        if (!createTaskResponse.ok) {
            const errorText = await createTaskResponse.text();
            console.error('❌ 创建Qwen TTS任务失败:', errorText);
            await logseq.Editor.insertBlock(blockId, `❌ Qwen语音生成失败：无法创建任务`, { sibling: false });
            return;
        }
        
        const taskResult = await createTaskResponse.json();
        console.log('✅ Qwen TTS任务创建成功:', taskResult);
        
        if (!taskResult.success || !taskResult.taskId) {
            await logseq.Editor.insertBlock(blockId, `❌ Qwen语音生成失败：${taskResult.error || '任务创建失败'}`, { sibling: false });
            return;
        }
        
        // 开始轮询任务状态，直接在父块中插入音频链接
        await pollQwenTTSTaskStatus(taskResult.taskId, bridgeServiceUrl, { uuid: blockId });
        
    } catch (error) {
        console.error('❌ Qwen TTS处理错误:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        await logseq.Editor.insertBlock(blockId, `❌ Qwen语音生成失败：${errorMessage}`, { sibling: false });
    }
}

/**
 * 使用桥接服务器进行文生视频
 * @param blockId 当前块ID
 * @param prompt 视频生成提示词
 */
async function performQwenTextToVideo(blockId: string, prompt: string): Promise<void> {
    try {
        const settings = await getSettings();
        const { dashscopeApiKey, qwenVideoT2VModel, qwenVideoResolution, qwenVideoPromptExtend, bridgeServiceUrl } = settings;
        
        if (!dashscopeApiKey || dashscopeApiKey.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置DashScope API Key', { sibling: false });
            return;
        }
        
        if (!prompt || prompt.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：没有找到视频生成提示词', { sibling: false });
            return;
        }
        
        // 检查提示词长度限制
        if (prompt.length > 800) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：提示词长度超过800字符限制', { sibling: false });
            return;
        }
        
        console.log('🎬 使用桥接服务器进行文生视频');
        console.log('🔑 API Key (前8位):', dashscopeApiKey.substring(0, 8) + '...');
        console.log('🤖 模型:', qwenVideoT2VModel);
        console.log('📝 提示词:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
        console.log('📝 提示词完整长度:', prompt.length);
        console.log('📐 分辨率:', qwenVideoResolution);
        console.log('🔧 提示词扩展:', qwenVideoPromptExtend);
        console.log('🌐 桥接服务器:', bridgeServiceUrl);
        
        // 生成文件名
        const timestamp = Date.now();
        const cleanPrompt = prompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').substring(0, 10);
        const filename = `qwen-t2v-${cleanPrompt || 'video'}_${timestamp}.mp4`;
        
        // 获取当前 Logseq 图谱路径
        const currentGraph = await logseq.App.getCurrentGraph();
        if (!currentGraph || !currentGraph.path) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：无法获取当前图谱路径', { sibling: false });
            return;
        }
        const logseqPath = currentGraph.path;
        
        // 显示处理提示
        await logseq.Editor.insertBlock(blockId, '🎬 正在使用阿里云文生视频生成视频，预计需要1-2分钟...', { sibling: false });
        
        // 调用桥接服务创建T2V任务
        const createTaskResponse = await fetch(`${bridgeServiceUrl}/api/qwen-t2v/create-task`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt,
                config: {
                    model: qwenVideoT2VModel,
                    resolution: qwenVideoResolution,
                    promptExtend: qwenVideoPromptExtend,
                    qwenApiKey: dashscopeApiKey
                },
                logseqPath: logseqPath,
                filename: filename
            })
        });
        
        if (!createTaskResponse.ok) {
            const errorText = await createTaskResponse.text();
            console.error('❌ 创建Qwen T2V任务失败:', errorText);
            await logseq.Editor.insertBlock(blockId, `❌ Qwen文生视频失败：无法创建任务`, { sibling: false });
            return;
        }
        
        const taskResult = await createTaskResponse.json();
        console.log('✅ Qwen T2V任务创建成功:', taskResult);
        
        if (!taskResult.success || !taskResult.taskId) {
            await logseq.Editor.insertBlock(blockId, `❌ Qwen文生视频失败：${taskResult.error || '任务创建失败'}`, { sibling: false });
            return;
        }
        
        // 开始轮询任务状态
        await pollQwenVideoTaskStatus(taskResult.taskId, bridgeServiceUrl, { uuid: blockId }, 't2v', prompt);
        
    } catch (error) {
        console.error('❌ Qwen T2V处理错误:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        await logseq.Editor.insertBlock(blockId, `❌ Qwen文生视频失败：${errorMessage}`, { sibling: false });
    }
}

/**
 * 使用阿里云DashScope API进行图生视频
 * @param blockId 当前块ID
 * @param prompt 视频生成提示词
 * @param imagePath 图片路径（可以是本地路径或URL）
 */
async function performQwenImageToVideo(blockId: string, prompt: string, imagePath: string): Promise<void> {
    try {
        const settings = await getSettings();
        const { dashscopeApiKey, qwenVideoI2VModel, qwenVideoResolution, qwenVideoPromptExtend, bridgeServiceUrl } = settings;
        
        if (!dashscopeApiKey || dashscopeApiKey.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置DashScope API Key', { sibling: false });
            return;
        }
        
        if (!prompt || prompt.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：没有找到视频生成提示词', { sibling: false });
            return;
        }
        
        if (!imagePath || imagePath.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：没有找到输入图片', { sibling: false });
            return;
        }
        
        // 检查提示词长度限制
        if (prompt.length > 800) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：提示词长度超过800字符限制', { sibling: false });
            return;
        }
        
        console.log('🎬 使用桥接服务器进行图生视频');
        console.log('🔑 API Key (前8位):', dashscopeApiKey.substring(0, 8) + '...');
        console.log('🤖 模型:', qwenVideoI2VModel);
        console.log('📝 提示词:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
        console.log('🖼️ 图片路径:', imagePath);
        console.log('📐 分辨率:', qwenVideoResolution);
        console.log('🔧 提示词扩展:', qwenVideoPromptExtend);
        console.log('🌐 桥接服务器:', bridgeServiceUrl);
        
        // 显示处理提示
        await logseq.Editor.insertBlock(blockId, '🎬 正在使用阿里云图生视频生成视频，预计需要1-2分钟...', { sibling: false });
        
        // 生成文件名
        const timestamp = Date.now();
        const cleanPrompt = prompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').substring(0, 10);
        const filename = `qwen-i2v-${cleanPrompt || 'video'}_${timestamp}.mp4`;
        
        // 获取当前 Logseq 图谱路径
        const currentGraph = await logseq.App.getCurrentGraph();
        if (!currentGraph || !currentGraph.path) {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：无法获取当前图谱路径', { sibling: false });
            return;
        }
        const logseqPath = currentGraph.path;
        
        // 处理图片路径：如果是本地路径，转换为 Base64；如果是网络 URL，直接使用
        let imageUrl: string;
        if (isNetworkImage(imagePath)) {
            // 网络图片，直接使用 URL
            imageUrl = imagePath;
            console.log('🌐 使用网络图片 URL:', imageUrl);
        } else {
            // 本地图片，转换为 Base64
            console.log('📁 处理本地图片:', imagePath);
            const base64Data = await imageToBase64(imagePath);
            if (!base64Data) {
                await logseq.Editor.insertBlock(blockId, '❌ 错误：无法读取图片文件', { sibling: false });
                return;
            }
            imageUrl = base64Data;
            console.log('✅ 图片已转换为 Base64 (长度:', base64Data.length, ')');
        }
        
        // 调用桥接服务创建I2V任务
        const createTaskResponse = await fetch(`${bridgeServiceUrl}/api/qwen-i2v/create-task`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt,
                imageUrl: imageUrl,
                config: {
                    model: qwenVideoI2VModel,
                    resolution: qwenVideoResolution,
                    promptExtend: qwenVideoPromptExtend,
                    qwenApiKey: dashscopeApiKey
                },
                logseqPath: logseqPath,
                filename: filename
            })
        });
        
        if (!createTaskResponse.ok) {
            const errorText = await createTaskResponse.text();
            console.error('❌ 创建Qwen I2V任务失败:', errorText);
            await logseq.Editor.insertBlock(blockId, `❌ Qwen图生视频失败：无法创建任务`, { sibling: false });
            return;
        }
        
        const taskResult = await createTaskResponse.json();
        console.log('✅ Qwen I2V任务创建成功:', taskResult);
        
        if (!taskResult.success || !taskResult.taskId) {
            await logseq.Editor.insertBlock(blockId, `❌ Qwen图生视频失败：${taskResult.error || '任务创建失败'}`, { sibling: false });
            return;
        }
        
        // 开始轮询任务状态
        await pollQwenVideoTaskStatus(taskResult.taskId, bridgeServiceUrl, { uuid: blockId }, 'i2v', prompt);
        
    } catch (error) {
        console.error('❌ 图生视频处理错误:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        await logseq.Editor.insertBlock(blockId, `❌ 图生视频生成失败：${errorMessage}`, { sibling: false });
    }
}

/**
 * 轮询视频生成任务状态
 * @param taskId 任务ID
 * @param apiKey API密钥
 * @param blockId 块ID
 * @param prompt 原始提示词
 */
async function pollVideoTaskStatus(taskId: string, apiKey: string, blockId: string, prompt: string): Promise<void> {
    const maxAttempts = 60; // 最多轮询60次（约15分钟）
    const pollInterval = 15000; // 15秒轮询一次
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔄 第${attempt}次查询任务状态...`);
            
            // 查询任务状态
            const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
            const statusResponse = await fetch(statusUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!statusResponse.ok) {
                throw new Error(`状态查询失败: ${statusResponse.status}`);
            }
            
            const statusData = await statusResponse.json();
            console.log('📊 完整API响应:', statusData);
            
            // 检查响应格式并提取任务状态
            const taskStatus = statusData.task_status || statusData.output?.task_status;
            console.log('📊 提取的任务状态:', taskStatus);
            
            if (taskStatus === 'SUCCEEDED') {
                // 任务成功完成
                const videoUrl = statusData.output?.video_url;
                if (!videoUrl) {
                    throw new Error('任务完成但未找到视频URL');
                }
                
                console.log('✅ 视频生成成功');
                console.log('🎬 视频URL:', videoUrl);
                
                // 生成视频文件名
                const timestamp = Date.now();
                const cleanPrompt = prompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').substring(0, 10);
                const filename = `qwen-video-${cleanPrompt || 't2v'}_${timestamp}.mp4`;
                
                // 简化处理：仅提供视频链接，与图片处理方式保持一致
                const videoMarkdown = `![${filename}](${videoUrl})\n\n📹 **视频链接**: [点击查看](${videoUrl})\n📝 **提示词**: ${prompt}`;
                const statusMessage = `✅ 视频生成成功\n\n${videoMarkdown}\n\n💡 视频链接有效期24小时，请及时保存`;
                
                await logseq.Editor.updateBlock(blockId, statusMessage);
                return;
                
            } else if (taskStatus === 'FAILED') {
                // 任务失败
                const errorMessage = statusData.message || '视频生成失败';
                console.error('❌ 视频生成任务失败:', errorMessage);
                await logseq.Editor.updateBlock(blockId, `❌ 文生视频生成失败：${errorMessage}`);
                return;
                
            } else if (taskStatus === 'RUNNING' || taskStatus === 'PENDING') {
                // 任务进行中，继续等待
                const progress = Math.round((attempt / maxAttempts) * 100);
                await logseq.Editor.updateBlock(blockId, `🎬 视频生成中... (${progress}%)\n⏳ 第${attempt}次检查，预计还需${Math.ceil((maxAttempts - attempt) * pollInterval / 60000)}分钟`);
                
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                }
            } else {
                // 未知状态或响应格式异常
                console.warn('⚠️ 异常响应或未知状态:', { taskStatus, fullResponse: statusData });
                
                if (taskStatus === undefined || taskStatus === null) {
                    // API响应格式异常，可能是任务不存在
                    await logseq.Editor.updateBlock(blockId, `⚠️ API响应格式异常\n🆔 任务ID: ${taskId}\n📊 原始响应: ${JSON.stringify(statusData, null, 2)}\n💡 可能的原因:\n  • 任务ID不存在或已过期\n  • API服务异常\n  • 网络连接问题\n🔄 请检查任务ID是否正确`);
                    return;
                }
                
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                }
            }
            
        } catch (error) {
            console.error(`❌ 第${attempt}次状态查询失败:`, error);
            if (attempt === maxAttempts) {
                await logseq.Editor.updateBlock(blockId, `❌ 视频生成状态查询失败：${error instanceof Error ? error.message : '未知错误'}`);
                return;
            }
            // 继续下一次尝试
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
    }
    
    // 超时处理
    console.warn('⏰ 视频生成任务轮询超时');
    await logseq.Editor.updateBlock(blockId, `⏰ 视频生成超时，任务ID: ${taskId}\n💡 任务可能仍在进行中，请稍后手动查询任务状态\n🔍 使用命令: /gpt-qwen-query-task ${taskId}\n⏱️ 超时时间: ${Math.round(maxAttempts * pollInterval / 60000)}分钟\n📝 提示: 复杂视频可能需要更长时间生成`);
}

/**
 * 手动查询视频生成任务状态
 * @param blockId 当前块ID
 * @param taskId 任务ID
 */
async function performQwenQueryVideoTask(blockId: string, taskId: string): Promise<void> {
    try {
        const settings = await getSettings();
        const { dashscopeApiKey } = settings;
        
        if (!dashscopeApiKey || dashscopeApiKey.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请先在设置中配置DashScope API Key', { sibling: false });
            return;
        }
        
        if (!taskId || taskId.trim() === '') {
            await logseq.Editor.insertBlock(blockId, '❌ 错误：请提供有效的任务ID', { sibling: false });
            return;
        }
        
        console.log('🔍 手动查询视频任务状态');
        console.log('🆔 任务ID:', taskId);
        
        // 显示查询提示
        const queryBlockId = await logseq.Editor.insertBlock(blockId, '🔍 正在查询视频生成任务状态...', { sibling: false });
        
        // 查询任务状态
        const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
        const statusResponse = await fetch(statusUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${dashscopeApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!statusResponse.ok) {
            throw new Error(`状态查询失败: ${statusResponse.status}`);
        }
        
        const statusData = await statusResponse.json();
        console.log('📊 完整API响应:', statusData);
        
        // 检查响应格式并提取任务状态
        const taskStatus = statusData.task_status || statusData.output?.task_status;
        console.log('📊 提取的任务状态:', taskStatus);
        
        if (taskStatus === 'SUCCEEDED') {
            // 任务成功完成
            const videoUrl = statusData.output?.video_url;
            if (!videoUrl) {
                throw new Error('任务完成但未找到视频URL');
            }
            
            console.log('✅ 视频生成成功');
            console.log('🎬 视频URL:', videoUrl);
            
            // 生成视频文件名
            const timestamp = Date.now();
            const filename = `qwen-video-query_${timestamp}.mp4`;
            
            // 简化处理：仅提供视频链接，与其他视频处理方式保持一致
            const videoMarkdown = `![${filename}](${videoUrl})\n\n📹 **视频链接**: [点击查看](${videoUrl})\n🆔 **任务ID**: ${taskId}`;
            const statusMessage = `✅ 视频生成任务已完成\n\n${videoMarkdown}\n\n💡 视频链接有效期24小时，请及时保存`;
            
            if (queryBlockId) {
                await logseq.Editor.updateBlock(queryBlockId.uuid, statusMessage);
            } else {
                await logseq.Editor.insertBlock(blockId, statusMessage, { sibling: false });
            }
            
        } else if (taskStatus === 'FAILED') {
            // 任务失败
            const errorMessage = statusData.message || '视频生成失败';
            console.error('❌ 视频生成任务失败:', errorMessage);
            if (queryBlockId) {
                await logseq.Editor.updateBlock(queryBlockId.uuid, `❌ 视频生成任务失败\n🆔 任务ID: ${taskId}\n❌ 错误信息: ${errorMessage}`);
            } else {
                await logseq.Editor.insertBlock(blockId, `❌ 视频生成任务失败\n🆔 任务ID: ${taskId}\n❌ 错误信息: ${errorMessage}`, { sibling: false });
            }
            
        } else if (taskStatus === 'RUNNING' || taskStatus === 'PENDING') {
            // 任务仍在进行中
            if (queryBlockId) {
                await logseq.Editor.updateBlock(queryBlockId.uuid, `⏳ 视频生成任务仍在进行中\n🆔 任务ID: ${taskId}\n📊 状态: ${taskStatus}\n💡 请稍后再次查询`);
            } else {
                await logseq.Editor.insertBlock(blockId, `⏳ 视频生成任务仍在进行中\n🆔 任务ID: ${taskId}\n📊 状态: ${taskStatus}\n💡 请稍后再次查询`, { sibling: false });
            }
            
        } else {
            // 未知状态或响应格式异常
            console.warn('⚠️ 异常响应或未知状态:', { taskStatus, fullResponse: statusData });
            
            let statusMessage;
            if (taskStatus === undefined || taskStatus === null) {
                statusMessage = `⚠️ API响应格式异常\n🆔 任务ID: ${taskId}\n📊 原始响应: ${JSON.stringify(statusData, null, 2)}\n💡 可能的原因:\n  • 任务ID不存在\n  • API服务异常\n  • 网络连接问题\n🔄 建议稍后重试或检查任务ID是否正确`;
            } else {
                statusMessage = `⚠️ 未知任务状态\n🆔 任务ID: ${taskId}\n📊 状态: ${taskStatus}\n📋 完整响应: ${JSON.stringify(statusData, null, 2)}\n💡 请联系技术支持或稍后重试`;
            }
            
            if (queryBlockId) {
                await logseq.Editor.updateBlock(queryBlockId.uuid, statusMessage);
            } else {
                await logseq.Editor.insertBlock(blockId, statusMessage, { sibling: false });
            }
        }
        
    } catch (error) {
        console.error('❌ 任务状态查询错误:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        await logseq.Editor.insertBlock(blockId, `❌ 任务状态查询失败：${errorMessage}`, { sibling: false });
    }
}

// TTS 任务状态轮询函数
async function pollTTSTaskStatus(
    taskId: string, 
    bridgeServiceUrl: string, 
    blockRef: { uuid: string },
    maxAttempts: number = 30,
    intervalMs: number = 2000
): Promise<void> {
    let attempts = 0;
    
    const poll = async (): Promise<void> => {
        try {
            attempts++;
            console.log(`🔄 轮询TTS任务状态 (${attempts}/${maxAttempts}):`, taskId);
            
            const statusUrl = bridgeServiceUrl.replace(/\/$/, '') + `/api/tts/task/${taskId}`;
            const response = await fetch(statusUrl);
            
            if (!response.ok) {
                throw new Error(`状态查询失败: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.task) {
                const task = result.task;
                
                switch (task.status) {
                    case 'completed':
                        // 任务完成，替换处理提示为最终的音频链接
                        const audioMarkdown = `![${task.filename}](${task.filePath})`;
                        await logseq.Editor.updateBlock(blockRef.uuid, audioMarkdown);
                        
                        logseq.UI.showMsg(
                            `🎵 语音生成完成！\n文件名：${task.filename}`,
                            'success',
                            { timeout: 5000 }
                        );
                        
                        console.log('✅ TTS任务完成，文件已保存:', task.filePath);
                        return;
                        
                    case 'failed':
                        // 任务失败，插入错误信息作为子块
                        const errorMarkdown = `❌ 语音生成失败：${task.error || '未知错误'}`;
                        await logseq.Editor.insertBlock(blockRef.uuid, errorMarkdown, { sibling: false });
                        
                        logseq.UI.showMsg(
                            `❌ 语音生成失败：${task.error || '未知错误'}`,
                            'error',
                            { timeout: 8000 }
                        );
                        
                        console.error('❌ TTS任务失败:', task.error);
                        return;
                        
                    case 'processing':
                    case 'pending':
                        // 任务仍在处理中，继续轮询
                        if (attempts >= maxAttempts) {
                            const timeoutMarkdown = `⏰ 语音生成超时，请稍后手动检查任务：${taskId}`;
                            await logseq.Editor.updateBlock(blockRef.uuid, timeoutMarkdown);
                            
                            logseq.UI.showMsg(
                                `⏰ 语音生成超时，任务ID：${taskId}`,
                                'warning',
                                { timeout: 10000 }
                            );
                            
                            console.warn('⏰ TTS任务轮询超时:', taskId);
                            return;
                        }
                        
                        // 不更新进度提示，保留原始占位符内容
                        // 进度信息通过控制台日志显示
                        console.log(`🎵 语音生成中... (${task.status}, ${attempts}/${maxAttempts})`);
                        
                        // 继续轮询
                        setTimeout(poll, intervalMs);
                        break;
                        
                    default:
                        throw new Error(`未知任务状态: ${task.status}`);
                }
            } else {
                throw new Error('无效的响应格式');
            }
        } catch (error) {
            console.error('❌ 轮询TTS任务状态失败:', error);
            
            if (attempts >= maxAttempts) {
                const errorMarkdown = `❌ 语音生成状态检查失败：${error instanceof Error ? error.message : '未知错误'}`;
                await logseq.Editor.updateBlock(blockRef.uuid, errorMarkdown);
                
                logseq.UI.showMsg(
                    `❌ 语音生成状态检查失败`,
                    'error',
                    { timeout: 8000 }
                );
                return;
            }
            
            // 出错时也继续重试
            setTimeout(poll, intervalMs);
        }
    };
    
    // 开始轮询
    setTimeout(poll, intervalMs);
}

async function pollImageTaskStatus(
    taskId: string, 
    bridgeServiceUrl: string, 
    blockRef: { uuid: string },
    prompt?: string,
    maxAttempts: number = 100,
    intervalMs: number = 3000
): Promise<void> {
    let attempts = 0;
    
    const pollStatus = async (): Promise<void> => {
        try {
            attempts++;
            console.log(`🔄 轮询图像生成任务状态 (${attempts}/${maxAttempts}):`, taskId);
            
            const response = await fetch(`${bridgeServiceUrl}/api/image/task/${taskId}`);
            
            if (!response.ok) {
                let errorDetail = '';
                if (response.status === 404) {
                    errorDetail = '任务状态查询端点不存在，可能是服务版本问题';
                } else if (response.status === 500) {
                    errorDetail = '服务器内部错误，可能是API配置或服务问题';
                } else if (response.status >= 400 && response.status < 500) {
                    errorDetail = '请求错误，可能是任务ID无效或已过期';
                } else {
                    errorDetail = '网络或服务连接问题';
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorDetail}`);
            }
            
            const result = await response.json();
            console.log('📥 图像生成任务状态响应:', result);
            
            // 从嵌套的 task 对象中提取状态和文件路径
            const taskStatus = result.task?.status || result.status;
            const taskFilePath = result.task?.filePath || result.filePath;
            const taskError = result.task?.error || result.error;
            
            if (taskStatus === 'completed' && taskFilePath) {
                // 任务完成，下载图片到本地
                console.log('✅ 图像生成任务完成，文件路径:', taskFilePath);
                
                try {
                    // 下载图片到本地 assets 目录
                    const downloadResult = await downloadAndSaveImage(taskFilePath);
                    
                    if (!downloadResult) {
                        throw new Error('图片下载失败');
                    }
                    
                    console.log('✅ 图片已下载到本地:', downloadResult.localPath);
                    
                    // 获取父块及其子块
                    const parentBlock = await logseq.Editor.getBlock(blockRef.uuid);
                    if (!parentBlock) {
                        console.error('❌ 无法获取父块');
                        return;
                    }
                    
                    // 查找包含占位符的子块
                    const generatePlaceholderRegex = /🎨\s*\*\*正在生成图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[生成中\.\.\.\]\(\)/;
                    const editPlaceholderRegex = /🎨\s*\*\*正在编辑图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[编辑中\.\.\.\]\(\)/;
                    
                    let placeholderBlock = null;
                    
                    // 检查父块是否包含占位符（兼容旧版本）
                    if (generatePlaceholderRegex.test(parentBlock.content) || editPlaceholderRegex.test(parentBlock.content)) {
                        placeholderBlock = parentBlock;
                    } else if (parentBlock.children) {
                        // 在子块中查找占位符
                        for (const childRef of parentBlock.children) {
                            const childBlock = await logseq.Editor.getBlock(childRef[1]);
                            if (childBlock && (generatePlaceholderRegex.test(childBlock.content) || editPlaceholderRegex.test(childBlock.content))) {
                                placeholderBlock = childBlock;
                                break;
                            }
                        }
                    }
                    
                    if (!placeholderBlock) {
                        // 如果没有找到占位符块，直接在父块下插入新的子块
                        const promptText = prompt || '处理的图片';
                        const imageMarkdown = `![${promptText}](${downloadResult.localPath})`;
                        await logseq.Editor.insertBlock(blockRef.uuid, imageMarkdown, { sibling: false });
                    } else {
                        // 更新包含占位符的块
                        const promptText = prompt || '处理的图片';
                        const imageMarkdown = `![${promptText}](${downloadResult.localPath})`;
                        
                        let updatedContent = placeholderBlock.content;
                        if (generatePlaceholderRegex.test(updatedContent)) {
                            updatedContent = updatedContent.replace(generatePlaceholderRegex, imageMarkdown);
                        } else if (editPlaceholderRegex.test(updatedContent)) {
                            updatedContent = updatedContent.replace(editPlaceholderRegex, imageMarkdown);
                        }
                        
                        await logseq.Editor.updateBlock(placeholderBlock.uuid, updatedContent);
                    }
                    logseq.UI.showMsg('✅ 图像生成完成！', 'success');
                    
                } catch (downloadError) {
                    console.error('❌ 图片下载失败:', downloadError);
                    
                    // 下载失败时，仍然显示原始URL
                    const parentBlock = await logseq.Editor.getBlock(blockRef.uuid);
                    if (parentBlock) {
                        const generatePlaceholderRegex = /🎨\s*\*\*正在生成图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[生成中\.\.\.\]\(\)/;
                        const editPlaceholderRegex = /🎨\s*\*\*正在编辑图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[编辑中\.\.\.\]\(\)/;
                        
                        let placeholderBlock = null;
                        
                        // 检查父块是否包含占位符（兼容旧版本）
                        if (generatePlaceholderRegex.test(parentBlock.content) || editPlaceholderRegex.test(parentBlock.content)) {
                            placeholderBlock = parentBlock;
                        } else if (parentBlock.children) {
                            // 在子块中查找占位符
                            for (const childRef of parentBlock.children) {
                                const childBlock = await logseq.Editor.getBlock(childRef[1]);
                                if (childBlock && (generatePlaceholderRegex.test(childBlock.content) || editPlaceholderRegex.test(childBlock.content))) {
                                    placeholderBlock = childBlock;
                                    break;
                                }
                            }
                        }
                        
                        const promptText = prompt || '处理的图片';
                        const fallbackMarkdown = `![${promptText}](${taskFilePath})\n\n⚠️ **注意：** 图片下载到本地失败，显示的是远程链接。错误：${downloadError instanceof Error ? downloadError.message : '未知错误'}`;
                        
                        if (!placeholderBlock) {
                            // 如果没有找到占位符块，直接在父块下插入新的子块
                            await logseq.Editor.insertBlock(blockRef.uuid, fallbackMarkdown, { sibling: false });
                        } else {
                            // 更新包含占位符的块
                            let updatedContent = placeholderBlock.content;
                            if (generatePlaceholderRegex.test(updatedContent)) {
                                updatedContent = updatedContent.replace(generatePlaceholderRegex, fallbackMarkdown);
                            } else if (editPlaceholderRegex.test(updatedContent)) {
                                updatedContent = updatedContent.replace(editPlaceholderRegex, fallbackMarkdown);
                            }
                            
                            await logseq.Editor.updateBlock(placeholderBlock.uuid, updatedContent);
                        }
                    }
                    
                    logseq.UI.showMsg('⚠️ 图像生成完成，但下载到本地失败', 'warning');
                }
                
            } else if (taskStatus === 'failed') {
                // 任务失败
                console.error('❌ 图像生成任务失败:', taskError);
                
                // 分析错误类型并提供详细信息
                let detailedError = '';
                const errorMsg = taskError || '未知错误';
                
                if (errorMsg.includes('API key') || errorMsg.includes('authentication') || errorMsg.includes('401') || errorMsg.includes('403')) {
                    detailedError = `❌ **图像生成失败：API认证错误**\n🔧 **解决方案：**\n• 检查API密钥是否正确配置\n• 确认API密钥未过期\n• 验证API密钥权限\n\n**错误详情：** ${errorMsg}`;
                } else if (errorMsg.includes('quota') || errorMsg.includes('limit') || errorMsg.includes('429')) {
                    detailedError = `❌ **图像生成失败：配额或限制错误**\n🔧 **解决方案：**\n• 检查API账户余额\n• 确认未超出使用限制\n• 稍后重试\n\n**错误详情：** ${errorMsg}`;
                } else if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('connection')) {
                    detailedError = `❌ **图像生成失败：网络连接错误**\n🔧 **解决方案：**\n• 检查网络连接\n• 确认API服务地址正确\n• 检查防火墙设置\n\n**错误详情：** ${errorMsg}`;
                } else if (errorMsg.includes('prompt') || errorMsg.includes('content') || errorMsg.includes('policy')) {
                    detailedError = `❌ **图像生成失败：内容策略错误**\n🔧 **解决方案：**\n• 修改提示词内容\n• 避免敏感或违规内容\n• 简化提示词描述\n\n**错误详情：** ${errorMsg}`;
                } else {
                    detailedError = `❌ **图像生成失败：服务器错误**\n🔧 **可能原因：**\n• 图像生成服务临时不可用\n• 服务器配置问题\n• API服务异常\n\n**错误详情：** ${errorMsg}`;
                }
                
                // 获取当前块内容并更新错误信息
                const currentBlock = await logseq.Editor.getBlock(blockRef.uuid);
                if (currentBlock) {
                    let updatedContent = currentBlock.content;
                    
                    // 查找并替换占位符
                    const placeholderRegex = /🎨\s*\*\*正在生成图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[生成中\.\.\.\]\(\)/;
                    if (placeholderRegex.test(updatedContent)) {
                        updatedContent = updatedContent.replace(placeholderRegex, detailedError);
                        await logseq.Editor.updateBlock(blockRef.uuid, updatedContent);
                    }
                }
                
                logseq.UI.showMsg(`❌ 图像生成失败：${errorMsg}`, 'error');
                
            } else if (taskStatus === 'processing' || taskStatus === 'pending') {
                // 任务仍在处理中，继续轮询
                if (attempts < maxAttempts) {
                    console.log(`⏳ 图像生成任务仍在处理中，${intervalMs}ms 后重试...`);
                    setTimeout(pollStatus, intervalMs);
                } else {
                    console.error('❌ 图像生成任务轮询超时');
                    
                    // 获取当前块内容并更新超时信息
                    const currentBlock = await logseq.Editor.getBlock(blockRef.uuid);
                    if (currentBlock) {
                        let updatedContent = currentBlock.content;
                        
                        // 查找并替换占位符
                        const placeholderRegex = /🎨\s*\*\*正在生成图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[生成中\.\.\.\]\(\)/;
                        if (placeholderRegex.test(updatedContent)) {
                            const timeoutMessage = `❌ **图像生成超时** (任务ID: ${taskId})\n🔧 **可能原因：**\n• 图像生成服务响应缓慢\n• 网络连接不稳定\n• 服务器负载过高\n\n**建议：** 稍后重试或检查服务状态`;
                            updatedContent = updatedContent.replace(placeholderRegex, timeoutMessage);
                            await logseq.Editor.updateBlock(blockRef.uuid, updatedContent);
                        }
                    }
                    
                    logseq.UI.showMsg('❌ 图像生成超时', 'error');
                }
            } else {
                console.error('❌ 图像生成任务状态未知:', taskStatus);
                logseq.UI.showMsg(`❌ 图像生成任务状态未知：${taskStatus}`, 'error');
            }
            
        } catch (error) {
            console.error('❌ 轮询图像生成任务状态时发生错误:', error);
            
            if (attempts < maxAttempts) {
                console.log(`⏳ 轮询出错，${intervalMs}ms 后重试...`);
                setTimeout(pollStatus, intervalMs);
            } else {
                console.error('❌ 图像生成任务轮询最终失败');
                
                // 获取当前块内容并更新错误信息
                const currentBlock = await logseq.Editor.getBlock(blockRef.uuid);
                if (currentBlock) {
                    let updatedContent = currentBlock.content;
                    
                    // 查找并替换占位符
                    const placeholderRegex = /🎨\s*\*\*正在生成图片\.\.\.\*\*\s*\(任务ID:\s*[^)]+\)[\s\S]*?!\[生成中\.\.\.\]\(\)/;
                    if (placeholderRegex.test(updatedContent)) {
                        const errorMessage = `❌ **图像生成失败：网络或服务错误**\n🔧 **诊断步骤：**\n1. 检查桥接服务是否正常运行\n2. 验证网络连接状态\n3. 确认API配置是否正确\n4. 查看服务日志获取详细错误信息\n\n**错误详情：** ${error instanceof Error ? error.message : '连接失败'}`;
                        updatedContent = updatedContent.replace(placeholderRegex, errorMessage);
                        await logseq.Editor.updateBlock(blockRef.uuid, updatedContent);
                    }
                }
                
                logseq.UI.showMsg('❌ 图像生成失败：网络错误或服务不可用', 'error');
            }
        }
    };
    
    // 开始轮询
    pollStatus();
}

async function pollQwenVideoTaskStatus(
    taskId: string, 
    bridgeServiceUrl: string, 
    blockRef: { uuid: string },
    apiType: 't2v' | 'i2v' = 't2v',
    prompt?: string,
    maxAttempts: number = 120,
    intervalMs: number = 4000
): Promise<void> {
    let attempts = 0;
    
    const poll = async (): Promise<void> => {
        try {
            attempts++;
            console.log(`🔄 轮询Qwen视频任务状态 (${attempts}/${maxAttempts}):`, taskId);
            
            const statusUrl = bridgeServiceUrl.replace(/\/$/, '') + `/api/qwen-${apiType}/task/${taskId}`;
            const response = await fetch(statusUrl);
            
            if (!response.ok) {
                throw new Error(`状态查询失败: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.task) {
                const task = result.task;
                
                switch (task.status) {
                    case 'completed':
                        // 任务完成，插入最终的视频链接作为子块
                        const videoMarkdown = `![${task.filename}](${task.filePath})`;
                        await logseq.Editor.insertBlock(blockRef.uuid, videoMarkdown, { sibling: false });
                        
                        logseq.UI.showMsg(
                            `🎬 Qwen视频生成完成！\n文件名：${task.filename}`,
                            'success',
                            { timeout: 5000 }
                        );
                        
                        console.log('✅ Qwen视频任务完成，文件已保存:', task.filePath);
                        return;
                        
                    case 'failed':
                        const errorMessage = task.error || '视频生成失败';
                        const errorMarkdown = `❌ Qwen视频生成失败：${errorMessage}`;
                        await logseq.Editor.insertBlock(blockRef.uuid, errorMarkdown, { sibling: false });
                        
                        logseq.UI.showMsg(
                            `❌ Qwen视频生成失败：${errorMessage}`,
                            'error',
                            { timeout: 8000 }
                        );
                        
                        console.error('❌ Qwen视频任务失败:', errorMessage);
                        return;
                        
                    case 'pending':
                    case 'processing':
                        // 任务仍在进行中
                        if (attempts >= maxAttempts) {
                            const timeoutMarkdown = `⏰ Qwen视频生成超时，任务ID: ${taskId}`;
                            await logseq.Editor.insertBlock(blockRef.uuid, timeoutMarkdown, { sibling: false });
                            
                            logseq.UI.showMsg(
                                `⏰ Qwen视频生成超时`,
                                'warning',
                                { timeout: 8000 }
                            );
                            
                            console.warn('⏰ Qwen视频任务轮询超时:', taskId);
                            return;
                        }
                        
                        // 动态调整轮询间隔
                        const elapsedTime = attempts * intervalMs;
                        let nextInterval = intervalMs;
                        if (elapsedTime < 60 * 1000) { // 前1分钟
                            nextInterval = 4000; // 4秒
                        } else if (elapsedTime < 4 * 60 * 1000) { // 1-4分钟
                            nextInterval = 8000; // 8秒
                        } else { // 4分钟后
                            nextInterval = 15000; // 15秒
                        }
                        
                        console.log(`🎬 Qwen视频生成中... (${task.status}, ${attempts}/${maxAttempts})`);
                        
                        // 继续轮询
                        setTimeout(poll, nextInterval);
                        break;
                        
                    default:
                        throw new Error(`未知任务状态: ${task.status}`);
                }
            } else {
                throw new Error('无效的响应格式');
            }
        } catch (error) {
            console.error('❌ 轮询Qwen视频任务状态失败:', error);
            
            if (attempts >= maxAttempts) {
                const errorMarkdown = `❌ Qwen视频生成状态检查失败：${error instanceof Error ? error.message : '未知错误'}`;
                await logseq.Editor.insertBlock(blockRef.uuid, errorMarkdown, { sibling: false });
                
                logseq.UI.showMsg(
                    `❌ Qwen视频生成状态检查失败`,
                    'error',
                    { timeout: 8000 }
                );
                return;
            }
            
            // 出错时也继续重试
            setTimeout(poll, intervalMs);
        }
    };
    
    // 开始轮询
    setTimeout(poll, intervalMs);
}

async function pollQwenTTSTaskStatus(
    taskId: string, 
    bridgeServiceUrl: string, 
    blockRef: { uuid: string },
    maxAttempts: number = 30,
    intervalMs: number = 2000
): Promise<void> {
    let attempts = 0;
    
    const poll = async (): Promise<void> => {
        try {
            attempts++;
            console.log(`🔄 轮询Qwen TTS任务状态 (${attempts}/${maxAttempts}):`, taskId);
            
            const statusUrl = bridgeServiceUrl.replace(/\/$/, '') + `/api/qwen-tts/task/${taskId}`;
            const response = await fetch(statusUrl);
            
            if (!response.ok) {
                throw new Error(`状态查询失败: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.task) {
                const task = result.task;
                
                switch (task.status) {
                    case 'completed':
                        // 任务完成，插入最终的音频链接作为子块
                        const audioMarkdown = `![${task.filename}](${task.filePath})`;
                        await logseq.Editor.insertBlock(blockRef.uuid, audioMarkdown, { sibling: false });
                        
                        logseq.UI.showMsg(
                            `🎵 Qwen语音生成完成！\n文件名：${task.filename}`,
                            'success',
                            { timeout: 5000 }
                        );
                        
                        console.log('✅ Qwen TTS任务完成，文件已保存:', task.filePath);
                        return;
                        
                    case 'failed':
                        // 任务失败，插入错误信息作为子块
                        const errorMarkdown = `❌ Qwen语音生成失败：${task.error || '未知错误'}`;
                        await logseq.Editor.insertBlock(blockRef.uuid, errorMarkdown, { sibling: false });
                        
                        logseq.UI.showMsg(
                            `❌ Qwen语音生成失败：${task.error || '未知错误'}`,
                            'error',
                            { timeout: 8000 }
                        );
                        
                        console.error('❌ Qwen TTS任务失败:', task.error);
                        return;
                        
                    case 'processing':
                    case 'pending':
                        // 任务仍在处理中，继续轮询
                        if (attempts >= maxAttempts) {
                            const timeoutMarkdown = `⏰ Qwen语音生成超时，请稍后手动检查任务：${taskId}`;
                            await logseq.Editor.insertBlock(blockRef.uuid, timeoutMarkdown, { sibling: false });
                            
                            logseq.UI.showMsg(
                                `⏰ Qwen语音生成超时，任务ID：${taskId}`,
                                'warning',
                                { timeout: 10000 }
                            );
                            
                            console.warn('⏰ Qwen TTS任务轮询超时:', taskId);
                            return;
                        }
                        
                        // 不更新进度提示，保留原始提示词
                        // 进度信息通过控制台日志显示
                        console.log(`🎵 Qwen语音生成中... (${task.status}, ${attempts}/${maxAttempts})`);
                        
                        // 继续轮询
                        setTimeout(poll, intervalMs);
                        break;
                        
                    default:
                        throw new Error(`未知任务状态: ${task.status}`);
                }
            } else {
                throw new Error('无效的响应格式');
            }
        } catch (error) {
            console.error('❌ 轮询Qwen TTS任务状态失败:', error);
            
            if (attempts >= maxAttempts) {
                const errorMarkdown = `❌ Qwen语音生成状态检查失败：${error instanceof Error ? error.message : '未知错误'}`;
                await logseq.Editor.insertBlock(blockRef.uuid, errorMarkdown, { sibling: false });
                
                logseq.UI.showMsg(
                    `❌ Qwen语音生成状态检查失败`,
                    'error',
                    { timeout: 8000 }
                );
                return;
            }
            
            // 出错时也继续重试
            setTimeout(poll, intervalMs);
        }
    };
    
    // 开始轮询
    setTimeout(poll, intervalMs);
}

/**
 * 直接调用 GPT 进行对话，绕过智能路由器
 * @param blockId 当前块ID
 * @param content 用户输入内容
 */
async function performDirectChat(blockId: string, content: string): Promise<void> {
    try {
        const settings = await getSettings();
        
        // 提取用户输入（移除命令本身）
        let userInput = content.replace('/gpt', '').trim();
        
        // 使用设置中的默认系统提示词
        let systemPrompt = settings.defaultSystemPrompt;
        
        // 检查是否有自定义系统提示词（格式：[系统提示词] 用户问题）
        const customSystemMatch = userInput.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (customSystemMatch) {
            systemPrompt = customSystemMatch[1];
            userInput = customSystemMatch[2];
        }
        
        if (!userInput.trim()) {
            await logseq.Editor.insertBlock(blockId, '❌ 请输入问题。\n💡 使用方法: /gpt 你的问题\n💡 自定义系统提示词: /gpt [系统提示词] 你的问题', { sibling: false });
            return;
        }
        
        // 直接调用 openaiStream 进行对话
        await openaiStream(blockId, userInput, {
            system_content: systemPrompt
        });
        
    } catch (error) {
        console.error('直接对话失败:', error);
        await logseq.Editor.insertBlock(blockId, `❌ 对话失败: ${error instanceof Error ? error.message : '未知错误'}`, { sibling: false });
    }
}

export {
    settingsSchema,
    summary,
    openaiStream,
    openaiMessage,
    generateAdvancedQuery,
    generatePageSummary,
    getBacklinkGraphContent,
    generateGraphBasedResponse,
    detectImages,
    detectFiles,
    performOCR,
    performFileAnalysis,
    performImageGeneration,
    performImageEdit,
    performTextToSpeech,
    performQwenTextToSpeech,
    performQwenTextToVideo,
    performQwenImageToVideo,
    performQwenQueryVideoTask,
    analyzeUserIntent,
    callMCPTool,
    performDirectChat
}