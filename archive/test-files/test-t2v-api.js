#!/usr/bin/env node

/**
 * GPT T2V API 测试脚本
 * 用于验证阿里云 DashScope 文生视频 API 是否正常工作
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置信息
const CONFIG = {
    API_KEY: process.env.DASHSCOPE_API_KEY || '', // 从环境变量获取 API Key
    BASE_URL: 'https://dashscope.aliyuncs.com',
    MODEL: 'wan2.2-t2v-plus', // 默认模型
    TEST_PROMPT: '一只可爱的小猫在阳光明媚的花园里玩耍'
};

// 颜色输出函数
const colors = {
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

// 日志函数
const log = {
    info: (msg) => console.log(colors.blue('ℹ'), msg),
    success: (msg) => console.log(colors.green('✓'), msg),
    error: (msg) => console.log(colors.red('✗'), msg),
    warning: (msg) => console.log(colors.yellow('⚠'), msg),
    step: (msg) => console.log(colors.cyan('→'), msg)
};

// HTTP 请求函数
function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve({ statusCode: res.statusCode, data: result });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

// 创建视频生成任务
async function createVideoTask(prompt) {
    log.step(`创建视频生成任务...`);
    
    const options = {
        hostname: 'dashscope.aliyuncs.com',
        port: 443,
        path: '/api/v1/services/aigc/video-generation/video-synthesis',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.API_KEY}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable'
        }
    };

    const requestData = {
        model: CONFIG.MODEL,
        input: {
            prompt: prompt
        },
        parameters: {
            size: '1920*1080'
        }
    };

    try {
        const response = await makeRequest(options, requestData);
        
        if (response.statusCode === 200 && response.data.output) {
            const taskId = response.data.output.task_id;
            log.success(`任务创建成功！任务ID: ${colors.bold(taskId)}`);
            return taskId;
        } else {
            log.error(`任务创建失败: ${JSON.stringify(response.data, null, 2)}`);
            return null;
        }
    } catch (error) {
        log.error(`请求失败: ${error.message}`);
        return null;
    }
}

// 查询任务状态
async function queryTaskStatus(taskId) {
    const options = {
        hostname: 'dashscope.aliyuncs.com',
        port: 443,
        path: `/api/v1/tasks/${taskId}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${CONFIG.API_KEY}`
        }
    };

    try {
        const response = await makeRequest(options);
        
        if (response.statusCode === 200) {
            return response.data;
        } else {
            log.error(`查询失败: ${JSON.stringify(response.data, null, 2)}`);
            return null;
        }
    } catch (error) {
        log.error(`查询请求失败: ${error.message}`);
        return null;
    }
}

// 轮询任务状态
async function pollTaskStatus(taskId, maxAttempts = 20) {
    log.step(`开始轮询任务状态 (最多 ${maxAttempts} 次)...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        log.info(`第 ${attempt}/${maxAttempts} 次查询...`);
        
        const result = await queryTaskStatus(taskId);
        
        if (!result) {
            log.warning('查询失败，继续重试...');
            await sleep(15000); // 等待 15 秒
            continue;
        }

        const status = result.output?.task_status;
        
        switch (status) {
            case 'SUCCEEDED':
                log.success('视频生成成功！');
                if (result.output?.video_url) {
                    log.success(`视频下载链接: ${colors.bold(result.output.video_url)}`);
                    return result;
                } else {
                    log.warning('未找到视频下载链接，检查响应结构...');
                    console.log('完整响应数据:', JSON.stringify(result, null, 2));
                }
                return result;
                
            case 'FAILED':
                log.error('视频生成失败！');
                if (result.output?.message) {
                    log.error(`失败原因: ${result.output.message}`);
                }
                return result;
                
            case 'RUNNING':
            case 'PENDING':
                log.info(`任务状态: ${status}，继续等待...`);
                break;
                
            default:
                log.warning(`未知状态: ${status}`);
        }
        
        if (attempt < maxAttempts) {
            await sleep(15000); // 等待 15 秒后重试
        }
    }
    
    log.warning('轮询超时，但任务可能仍在进行中');
    log.info(`您可以稍后手动查询任务状态: ${colors.bold(taskId)}`);
    return null;
}

// 睡眠函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 下载视频文件
async function downloadVideo(videoUrl, filename = null) {
    if (!filename) {
        const urlParts = videoUrl.split('/');
        const urlFilename = urlParts[urlParts.length - 1].split('?')[0];
        filename = `generated_video_${Date.now()}_${urlFilename}`;
    }
    
    log.step(`开始下载视频: ${filename}`);
    
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        
        https.get(videoUrl, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`下载失败，状态码: ${response.statusCode}`));
                return;
            }
            
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize) {
                    const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
                    process.stdout.write(`\r下载进度: ${progress}%`);
                }
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log(''); // 换行
                log.success(`视频下载完成: ${colors.bold(filename)}`);
                resolve(filename);
            });
            
        }).on('error', (error) => {
            fs.unlink(filename, () => {}); // 删除不完整的文件
            reject(error);
        });
    });
}

// 检查配置
function checkConfig() {
    console.log(colors.bold('\n🎬 GPT T2V API 测试工具\n'));
    
    if (!CONFIG.API_KEY) {
        log.error('未找到 DASHSCOPE_API_KEY 环境变量！');
        log.info('请设置环境变量: export DASHSCOPE_API_KEY="your-api-key"');
        process.exit(1);
    }
    
    log.success(`API Key: ${CONFIG.API_KEY.substring(0, 8)}...`);
    log.info(`测试提示词: "${CONFIG.TEST_PROMPT}"`);
    log.info(`使用模型: ${CONFIG.MODEL}`);
    console.log();
}

// 主函数
async function main() {
    try {
        checkConfig();
        
        // 创建任务
        const taskId = await createVideoTask(CONFIG.TEST_PROMPT);
        
        if (!taskId) {
            log.error('无法创建视频生成任务，测试失败！');
            process.exit(1);
        }
        
        console.log();
        
        // 轮询状态
        const result = await pollTaskStatus(taskId);
        
        console.log();
        
        if (result && result.output?.task_status === 'SUCCEEDED') {
            log.success(colors.bold('🎉 API 测试成功！视频生成功能正常工作！'));
            
            // 下载生成的视频
            if (result.output?.video_url) {
                try {
                    const filename = await downloadVideo(result.output.video_url);
                    log.success(`✅ 视频已保存到本地: ${filename}`);
                } catch (error) {
                    log.error(`❌ 视频下载失败: ${error.message}`);
                }
            }
        } else if (result && result.output?.task_status === 'FAILED') {
            log.error(colors.bold('❌ API 测试失败！视频生成出现错误！'));
        } else {
            log.warning(colors.bold('⏰ API 测试超时，但功能可能正常（任务仍在进行中）'));
            log.info(`任务ID: ${colors.bold(taskId)}`);
        }
        
    } catch (error) {
        log.error(`测试过程中出现错误: ${error.message}`);
        process.exit(1);
    }
}

// 处理命令行参数
if (process.argv.length > 2) {
    const customPrompt = process.argv.slice(2).join(' ');
    CONFIG.TEST_PROMPT = customPrompt;
    log.info(`使用自定义提示词: "${customPrompt}"`);
}

// 运行测试
main().catch(error => {
    log.error(`未处理的错误: ${error.message}`);
    process.exit(1);
});