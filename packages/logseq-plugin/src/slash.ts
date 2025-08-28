import * as api from '@/libs';
import '@logseq/libs';
import { getSettings } from '@/libs/settings';
import { smartRouter } from '@/libs/smart-router';

export async function slash () {
    await logseq.Editor.registerSlashCommand('gpt-block', 
        async () => {
            let { uuid }: any = await logseq.Editor.getCurrentBlock();
            let content = await api.summary(uuid, true);
            content += '\nPlease try to summarize the content of the above text.'
            await api.openaiStream(content, uuid);
    });

    await logseq.Editor.registerSlashCommand('gpt-think',
        async() => {
            let { content, uuid }: any = await logseq.Editor.getCurrentBlock();
            
            // 使用智能路由器处理用户输入
            await smartRouter.routeUserInput(uuid, content, {
                isStreaming: true
            });
    });

    await logseq.Editor.registerSlashCommand('gpt',
        async() => {
            let { content, uuid }: any = await logseq.Editor.getCurrentBlock();
            
            // 直接调用 GPT 进行对话，绕过智能路由器
            await api.performDirectChat(uuid, content);
    });

    await logseq.Editor.registerSlashCommand('aihey', 
        async () => {
            let { uuid, content, parent }: any = await logseq.Editor.getCurrentBlock();
            const system_content: string|undefined = (await logseq.Editor.getBlock(parent.id))?.content || undefined;
            const settings = await getSettings();

            // 使用智能路由器处理用户输入
            await smartRouter.routeUserInput(uuid, content, {
                isStreaming: settings.isStreamingOutput,
                systemContent: system_content
            });
    });

    await logseq.Editor.registerSlashCommand('gpt-summary', 
        async () => {
            let { uuid }: any = await logseq.Editor.getCurrentBlock();
            await api.generatePageSummary(uuid);
    });

    await logseq.Editor.registerSlashCommand('gpt-graph', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const currentPage = await logseq.Editor.getCurrentPage();
            if (!currentPage) {
                logseq.UI.showMsg('无法获取当前页面信息，请确保在页面中使用此命令', 'error');
                return;
            }

            const userInput = currentBlock.content?.replace('/gpt-graph', '').trim();
            if (!userInput) {
                logseq.UI.showMsg('请输入问题。/gpt-graph 命令会基于当前页面的双链和标签搜索相关内容来回答问题。', 'warning');
                return;
            }

            logseq.UI.showMsg(`正在基于页面 "${currentPage.name}" 的双链和标签搜索相关内容...`, 'info');
            
            try {
                 const { uuid }: any = await logseq.Editor.getCurrentBlock();
                 const settings = await getSettings();
                 const model = settings.aiProvider === 'openai' ? settings.gptModel : settings.ollamaModel;
                 const apiKey = settings.openaiKey;
                 const baseUrl = settings.aiProvider === 'openai' ? settings.openaiAddress : settings.ollamaAddress;
                 
                 await api.generateGraphBasedResponse(currentPage.name, userInput, model, apiKey, baseUrl, uuid);
                 logseq.UI.showMsg('基于图库的回答已生成', 'success');
             } catch (error) {
                 console.error('图库搜索失败:', error);
                 logseq.UI.showMsg('图库搜索失败，请检查设置', 'error');
             }
    });

    await logseq.Editor.registerSlashCommand('gpt-ocr', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 检测当前块中的图片
            const images = api.detectImages(content);
            
            if (images.length === 0) {
                logseq.UI.showMsg('当前块中未找到图片。请确保块中包含图片引用，如：![](../assets/image.png) 或 ![](https://example.com/image.jpg)', 'warning');
                return;
            }

            logseq.UI.showMsg(`找到 ${images.length} 张图片，正在进行 OCR 识别...`, 'info');
            
            try {
                await api.performOCR(currentBlock.uuid, images);
                logseq.UI.showMsg('OCR 识别完成', 'success');
            } catch (error) {
                console.error('OCR 识别失败:', error);
                logseq.UI.showMsg('OCR 识别失败，请检查设置和图片路径', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-file', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 检测当前块中的文件
            const { images, files } = api.detectFiles(content);
            
            if (files.length === 0 && images.length === 0) {
                logseq.UI.showMsg('当前块中未找到文件。请确保块中包含文件引用，如：[文档](../assets/document.pdf) 或 ![图片](../assets/image.png)', 'warning');
                return;
            }

            // 合并所有文件（包括图片）
            const allFiles = [...files, ...images];
            logseq.UI.showMsg(`找到 ${allFiles.length} 个文件，正在进行分析...`, 'info');
            
            try {
                await api.performFileAnalysis(currentBlock.uuid, allFiles);
                logseq.UI.showMsg('文件分析完成', 'success');
            } catch (error) {
                console.error('文件分析失败:', error);
                logseq.UI.showMsg('文件分析失败，请检查设置和文件路径', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-image', 
        async () => {
            // 尝试获取当前编辑器的实时内容
            let currentContent = '';
            try {
                // 获取当前编辑器的输入内容
                const editingContent = await logseq.Editor.getEditingBlockContent();
                if (editingContent) {
                    currentContent = editingContent;
                } else {
                    // 如果无法获取编辑内容，回退到获取当前块
                    const currentBlock = await logseq.Editor.getCurrentBlock();
                    if (!currentBlock) {
                        logseq.UI.showMsg('无法获取当前块信息', 'error');
                        return;
                    }
                    currentContent = currentBlock.content || '';
                }
            } catch (error) {
                // 如果API不支持，回退到传统方式
                const currentBlock = await logseq.Editor.getCurrentBlock();
                if (!currentBlock) {
                    logseq.UI.showMsg('无法获取当前块信息', 'error');
                    return;
                }
                currentContent = currentBlock.content || '';
            }
            
            // 提取提示词（移除命令本身）
            let prompt = currentContent.replace('/gpt-image', '').trim();
            
            // 如果没有提示词，尝试从用户输入中提取
            if (!prompt) {
                // 检查是否是刚输入命令的情况，给用户一个机会输入提示词
                const hasOnlyCommand = currentContent.trim() === '/gpt-image';
                if (hasOnlyCommand) {
                    logseq.UI.showMsg('请在 /gpt-image 后面输入生图提示词。例如：/gpt-image 一只可爱的小猫在花园里玩耍', 'warning');
                    return;
                }
                
                // 如果内容不为空但提取不到提示词，可能是格式问题
                if (currentContent.trim()) {
                    // 尝试更宽松的提取方式
                    const parts = currentContent.split('/gpt-image');
                    if (parts.length > 1) {
                        prompt = parts[parts.length - 1].trim();
                    }
                }
                
                // 最终检查
                if (!prompt) {
                    logseq.UI.showMsg('请输入生图提示词。例如：/gpt-image 一只可爱的小猫在花园里玩耍', 'warning');
                    return;
                }
            }
            
            // 获取当前块信息用于后续操作
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }
            
            // 检测当前块中的图片
            const images = api.detectImages(currentContent);
            
            if (images.length > 0) {
                logseq.UI.showMsg(`检测到 ${images.length} 张图片，正在进行图生图...`, 'info');
            } else {
                logseq.UI.showMsg('正在进行文生图...', 'info');
            }
            
            try {
                await api.performImageGeneration(currentBlock.uuid, prompt, images);
                logseq.UI.showMsg('图片生成完成', 'success');
            } catch (error) {
                console.error('图片生成失败:', error);
                logseq.UI.showMsg('图片生成失败，请检查设置和网络连接', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-imgedit', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 提取编辑提示词（移除命令本身）
            let prompt = content.replace('/gpt-imgedit', '').trim();
            
            if (!prompt) {
                logseq.UI.showMsg('请在 /gpt-imgedit 后面输入编辑提示词。例如：/gpt-imgedit 将图片中的天空改为夜空', 'warning');
                return;
            }
            
            // 检测当前块中的图片
            const images = api.detectImages(content);
            
            if (images.length === 0) {
                logseq.UI.showMsg('当前块中未找到图片。请确保块中包含图片引用，如：![](../assets/image.png) 或 ![](https://example.com/image.jpg)', 'warning');
                return;
            }

            // 检测遮罩图片（查找包含 mask 关键词的图片）
            const maskImages = images.filter(img => 
                img.toLowerCase().includes('mask') || 
                img.toLowerCase().includes('遮罩')
            );
            
            // 分离原图和遮罩
            const sourceImages = images.filter(img => 
                !img.toLowerCase().includes('mask') && 
                !img.toLowerCase().includes('遮罩')
            );
            
            if (sourceImages.length === 0) {
                logseq.UI.showMsg('未找到源图片。请确保至少有一张不包含"mask"或"遮罩"关键词的图片', 'warning');
                return;
            }

            const maskImage = maskImages.length > 0 ? maskImages[0] : null;
            
            if (maskImage) {
                logseq.UI.showMsg(`找到源图片 ${sourceImages.length} 张，遮罩图片 1 张，正在进行精确图片编辑...`, 'info');
            } else {
                logseq.UI.showMsg(`找到 ${sourceImages.length} 张图片，正在进行图片编辑...`, 'info');
            }
            
            try {
                await api.performImageEdit(currentBlock.uuid, prompt, sourceImages, maskImage);
                logseq.UI.showMsg('图片编辑完成', 'success');
            } catch (error) {
                console.error('图片编辑失败:', error);
                logseq.UI.showMsg('图片编辑失败，请检查设置和网络连接', 'error');
            }
        }
    );

    await logseq.Editor.registerSlashCommand('gpt-tts', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 提取要转换的文本（移除命令本身）
            let textToConvert = content.replace('/gpt-tts', '').trim();
            
            // 如果命令后没有文本，使用当前块的所有文本内容（不包含子块）
            if (!textToConvert) {
                // 获取当前块的纯文本内容，排除命令本身
                const blockContent = content.replace('/gpt-tts', '').trim();
                if (blockContent) {
                    textToConvert = blockContent;
                } else {
                    // 如果当前块只有命令，提示用户输入文本
                    logseq.UI.showMsg('请在 /gpt-tts 后面输入要转换为语音的文本，或在当前块中添加文本内容', 'warning');
                    return;
                }
            }
            
            // 清理文本内容，移除Markdown格式和特殊字符
            textToConvert = textToConvert
                .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片链接
                .replace(/\[.*?\]\(.*?\)/g, '$1') // 移除普通链接，保留文本
                .replace(/#{1,6}\s*/g, '') // 移除标题标记
                .replace(/\*\*(.*?)\*\*/g, '$1') // 移除粗体标记
                .replace(/\*(.*?)\*/g, '$1') // 移除斜体标记
                .replace(/`(.*?)`/g, '$1') // 移除代码标记
                .replace(/\n+/g, ' ') // 将换行符替换为空格
                .trim();
            
            if (!textToConvert) {
                logseq.UI.showMsg('没有找到可转换的文本内容', 'warning');
                return;
            }
            
            // 检查文本长度（TTS API通常有字符限制）
            if (textToConvert.length > 4000) {
                logseq.UI.showMsg(`文本过长（${textToConvert.length} 字符），建议控制在4000字符以内以获得最佳效果`, 'warning');
                // 截取前4000个字符
                textToConvert = textToConvert.substring(0, 4000) + '...';
            }
            
            logseq.UI.showMsg(`正在将文本转换为语音（${textToConvert.length} 字符）...`, 'info');
            
            try {
                await api.performTextToSpeech(currentBlock.uuid, textToConvert);
                logseq.UI.showMsg('语音生成完成', 'success');
            } catch (error) {
                console.error('语音生成失败:', error);
                logseq.UI.showMsg('语音生成失败，请检查TTS设置和网络连接', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-qwen-tts', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 提取要转换的文本（移除命令本身）
            let textToConvert = content.replace('/gpt-qwen-tts', '').trim();
            
            // 如果命令后没有文本，使用当前块的所有文本内容（不包含子块）
            if (!textToConvert) {
                // 获取当前块的纯文本内容，排除命令本身
                const blockContent = content.replace('/gpt-qwen-tts', '').trim();
                if (blockContent) {
                    textToConvert = blockContent;
                } else {
                    // 如果当前块只有命令，提示用户输入文本
                    logseq.UI.showMsg('请在 /gpt-qwen-tts 后面输入要转换为语音的文本，或在当前块中添加文本内容', 'warning');
                    return;
                }
            }
            
            // 清理文本内容，移除Markdown格式和特殊字符
            textToConvert = textToConvert
                .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片链接
                .replace(/\[.*?\]\(.*?\)/g, '$1') // 移除普通链接，保留文本
                .replace(/#{1,6}\s*/g, '') // 移除标题标记
                .replace(/\*\*(.*?)\*\*/g, '$1') // 移除粗体标记
                .replace(/\*(.*?)\*/g, '$1') // 移除斜体标记
                .replace(/`(.*?)`/g, '$1') // 移除代码标记
                .replace(/\n+/g, ' ') // 将换行符替换为空格
                .trim();
            
            if (!textToConvert) {
                logseq.UI.showMsg('没有找到可转换的文本内容', 'warning');
                return;
            }
            
            // 检查文本长度（TTS API通常有字符限制）
            if (textToConvert.length > 4000) {
                logseq.UI.showMsg(`文本过长（${textToConvert.length} 字符），建议控制在4000字符以内以获得最佳效果`, 'warning');
                // 截取前4000个字符
                textToConvert = textToConvert.substring(0, 4000) + '...';
            }
            
            logseq.UI.showMsg(`正在使用Qwen-TTS将文本转换为语音（${textToConvert.length} 字符）...`, 'info');
            
            try {
                await api.performQwenTextToSpeech(currentBlock.uuid, textToConvert);
                logseq.UI.showMsg('Qwen语音生成完成', 'success');
            } catch (error) {
                console.error('Qwen语音生成失败:', error);
                logseq.UI.showMsg('Qwen语音生成失败，请检查TTS设置和网络连接', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-qwen-t2v', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 提取视频生成提示词（移除命令本身）
            let prompt = content.replace('/gpt-qwen-t2v', '').trim();
            
            // 检查是否只有命令没有提示词
            if (!prompt) {
                const hasOnlyCommand = content.trim() === '/gpt-qwen-t2v';
                if (hasOnlyCommand) {
                    logseq.UI.showMsg('请在 /gpt-qwen-t2v 后面输入视频生成提示词。例如：/gpt-qwen-t2v 一只可爱的小猫在花园里玩耍', 'warning');
                    return;
                }
                
                // 如果内容不为空但提取不到提示词，可能是格式问题
                if (content.trim()) {
                    // 尝试更宽松的提取方式
                    const parts = content.split('/gpt-qwen-t2v');
                    if (parts.length > 1) {
                        prompt = parts[parts.length - 1].trim();
                    }
                }
                
                // 最终检查
                if (!prompt) {
                    logseq.UI.showMsg('请输入视频生成提示词。例如：/gpt-qwen-t2v 一只可爱的小猫在花园里玩耍', 'warning');
                    return;
                }
            }
            
            // 检查提示词长度限制
            if (prompt.length > 800) {
                logseq.UI.showMsg(`提示词过长（${prompt.length} 字符），请控制在800字符以内`, 'warning');
                return;
            }
            
            logseq.UI.showMsg(`正在使用Qwen文生视频生成视频（${prompt.length} 字符）...`, 'info');
            
            try {
                await api.performQwenTextToVideo(currentBlock.uuid, prompt);
                logseq.UI.showMsg('Qwen文生视频任务已创建', 'success');
            } catch (error) {
                console.error('Qwen文生视频失败:', error);
                logseq.UI.showMsg('Qwen文生视频失败，请检查设置和网络连接', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-qwen-i2v', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 提取视频生成提示词（移除命令本身）
            let prompt = content.replace('/gpt-qwen-i2v', '').trim();
            
            // 检查是否只有命令没有提示词
            if (!prompt) {
                const hasOnlyCommand = content.trim() === '/gpt-qwen-i2v';
                if (hasOnlyCommand) {
                    logseq.UI.showMsg('请在 /gpt-qwen-i2v 后面输入视频生成提示词。例如：/gpt-qwen-i2v 让这张图片中的人物动起来', 'warning');
                    return;
                }
                
                // 如果内容不为空但提取不到提示词，可能是格式问题
                if (content.trim()) {
                    // 尝试更宽松的提取方式
                    const parts = content.split('/gpt-qwen-i2v');
                    if (parts.length > 1) {
                        prompt = parts[parts.length - 1].trim();
                    }
                }
                
                // 最终检查
                if (!prompt) {
                    logseq.UI.showMsg('请输入视频生成提示词。例如：/gpt-qwen-i2v 让这张图片中的人物动起来', 'warning');
                    return;
                }
            }
            
            // 检查提示词长度限制
            if (prompt.length > 800) {
                logseq.UI.showMsg(`提示词过长（${prompt.length} 字符），请控制在800字符以内`, 'warning');
                return;
            }
            
            // 检测当前块中的图片
            const images = api.detectImages(content);
            
            if (images.length === 0) {
                logseq.UI.showMsg('未检测到图片，请在当前块中添加图片后再使用图生视频功能', 'warning');
                return;
            }
            
            if (images.length > 1) {
                logseq.UI.showMsg(`检测到 ${images.length} 张图片，将使用第一张图片进行视频生成`, 'info');
            }
            
            const imagePath = images[0];
            logseq.UI.showMsg(`正在使用Qwen图生视频生成视频（${prompt.length} 字符）...`, 'info');
            
            try {
                await api.performQwenImageToVideo(currentBlock.uuid, prompt, imagePath);
                logseq.UI.showMsg('Qwen图生视频任务已创建', 'success');
            } catch (error) {
                console.error('Qwen图生视频失败:', error);
                logseq.UI.showMsg('Qwen图生视频失败，请检查设置和网络连接', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('gpt-qwen-query-task', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }
            
            try {
                // 获取当前块内容
                const blockContent = currentBlock.content || '';
                
                // 提取任务ID（支持多种格式）
                let taskId = '';
                
                // 尝试从命令参数中提取任务ID（支持更宽泛的字符集）
                const commandMatch = blockContent.match(/\/gpt-qwen-query-task\s+([\w\-]+)/i);
                if (commandMatch) {
                    taskId = commandMatch[1];
                } else {
                    // 尝试从块内容中提取任务ID（支持多种格式）
                    const taskIdPatterns = [
                        /任务ID[：:]\s*([\w\-]+)/i,
                        /task[_\s]*id[：:]?\s*([\w\-]+)/i,
                        /ID[：:]\s*([\w\-]+)/i
                    ];
                    
                    for (const pattern of taskIdPatterns) {
                        const match = blockContent.match(pattern);
                        if (match) {
                            taskId = match[1];
                            break;
                        }
                    }
                }
                
                if (!taskId) {
                    await logseq.Editor.insertBlock(currentBlock.uuid, '❌ 错误：未找到任务ID\n💡 使用方法: /gpt-qwen-query-task <任务ID>', { sibling: false });
                    return;
                }
                
                console.log('🔍 手动查询视频任务:', taskId);
                logseq.UI.showMsg('正在查询视频生成任务状态...', 'info');
                
                // 调用查询函数
                await api.performQwenQueryVideoTask(currentBlock.uuid, taskId);
                
            } catch (error) {
                console.error('任务查询处理错误:', error);
                logseq.UI.showMsg('任务查询失败，请检查控制台错误信息', 'error');
            }
    });

    await logseq.Editor.registerSlashCommand('auto_generate_image', 
        async () => {
            const currentBlock = await logseq.Editor.getCurrentBlock();
            if (!currentBlock) {
                logseq.UI.showMsg('无法获取当前块信息', 'error');
                return;
            }

            const content = currentBlock.content || '';
            
            // 提取提示词（移除命令本身）
            let prompt = content.replace('/auto_generate_image', '').trim();
            
            // 如果没有提示词，提示用户
            if (!prompt) {
                logseq.UI.showMsg('请在 /auto_generate_image 后面输入生图提示词。例如：/auto_generate_image 可爱的小猫', 'warning');
                return;
            }
            
            // 自动简化提示词：如果超过100字符，截取前100字符
            const maxLength = 100;
            if (prompt.length > maxLength) {
                prompt = prompt.substring(0, maxLength);
                logseq.UI.showMsg(`提示词已自动简化为前${maxLength}字符`, 'info');
            }
            
            // 检测当前块中的图片
            const images = api.detectImages(content);
            
            if (images.length > 0) {
                logseq.UI.showMsg(`使用简化模式进行图生图...`, 'info');
            } else {
                logseq.UI.showMsg('使用简化模式进行文生图...', 'info');
            }
            
            try {
                await api.performImageGeneration(currentBlock.uuid, prompt, images);
                logseq.UI.showMsg('图片生成完成', 'success');
            } catch (error) {
                console.error('图片生成失败:', error);
                logseq.UI.showMsg('图片生成失败，请检查设置和网络连接', 'error');
            }
    });
}