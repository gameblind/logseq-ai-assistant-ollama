#!/usr/bin/env node

/**
 * 插件API调试脚本
 * 模拟插件的API调用方式，用于对比和诊断问题
 */

const https = require('https');
const fs = require('fs');

// 配置信息 - 模拟插件的默认设置
const CONFIG = {
    API_KEY: process.env.DASHSCOPE_API_KEY || '',
    BASE_URL: 'https://dashscope.aliyuncs.com',
    MODEL: 'wan2.2-t2v-plus', // 插件默认模型
    RESOLUTION: '1280*720', // 插件默认分辨率
    PROMPT_EXTEND: true, // 插件默认启用提示词扩展
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
                    resolve({ 
                        statusCode: res.statusCode, 
                        headers: res.headers,
                        data: result 
                    });
                } catch (e) {
                    resolve({ 
                        statusCode: res.statusCode, 
                        headers: res.headers,
                        data: body 
                    });
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

// 创建视频生成任务 - 模拟插件方式
async function createVideoTaskPluginStyle(prompt) {
    log.step(`使用插件方式创建视频生成任务...`);
    
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
            size: CONFIG.RESOLUTION
        }
    };

    // 如果启用提示词扩展，添加相关参数
    if (CONFIG.PROMPT_EXTEND) {
        requestData.parameters.prompt_extend = true;
    }

    console.log('\n' + colors.bold('📤 插件方式请求详情:'));
    console.log('URL:', `https://${options.hostname}${options.path}`);
    console.log('Headers:', JSON.stringify({
        'Authorization': `Bearer ${CONFIG.API_KEY.substring(0, 8)}...`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
    }, null, 2));
    console.log('Body:', JSON.stringify(requestData, null, 2));

    try {
        const response = await makeRequest(options, requestData);
        
        console.log('\n' + colors.bold('📥 插件方式响应详情:'));
        console.log('Status Code:', response.statusCode);
        console.log('Headers:', JSON.stringify(response.headers, null, 2));
        console.log('Response Data:', JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200 && response.data.output) {
            const taskId = response.data.output.task_id;
            log.success(`插件方式任务创建成功！任务ID: ${colors.bold(taskId)}`);
            return taskId;
        } else {
            log.error(`插件方式任务创建失败: ${JSON.stringify(response.data, null, 2)}`);
            return null;
        }
    } catch (error) {
        log.error(`插件方式请求失败: ${error.message}`);
        return null;
    }
}

// 创建视频生成任务 - 原始测试脚本方式
async function createVideoTaskOriginalStyle(prompt) {
    log.step(`使用原始测试脚本方式创建视频生成任务...`);
    
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
        model: 'wan2.2-t2v-plus', // 原始测试脚本的模型
        input: {
            prompt: prompt
        },
        parameters: {
            size: '1920*1080' // 原始测试脚本的分辨率
        }
    };

    console.log('\n' + colors.bold('📤 原始方式请求详情:'));
    console.log('URL:', `https://${options.hostname}${options.path}`);
    console.log('Headers:', JSON.stringify({
        'Authorization': `Bearer ${CONFIG.API_KEY.substring(0, 8)}...`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
    }, null, 2));
    console.log('Body:', JSON.stringify(requestData, null, 2));

    try {
        const response = await makeRequest(options, requestData);
        
        console.log('\n' + colors.bold('📥 原始方式响应详情:'));
        console.log('Status Code:', response.statusCode);
        console.log('Headers:', JSON.stringify(response.headers, null, 2));
        console.log('Response Data:', JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200 && response.data.output) {
            const taskId = response.data.output.task_id;
            log.success(`原始方式任务创建成功！任务ID: ${colors.bold(taskId)}`);
            return taskId;
        } else {
            log.error(`原始方式任务创建失败: ${JSON.stringify(response.data, null, 2)}`);
            return null;
        }
    } catch (error) {
        log.error(`原始方式请求失败: ${error.message}`);
        return null;
    }
}

// 检查配置
function checkConfig() {
    console.log(colors.bold('\n🔍 插件API调试工具\n'));
    
    if (!CONFIG.API_KEY) {
        log.error('未找到 DASHSCOPE_API_KEY 环境变量！');
        log.info('请设置环境变量: export DASHSCOPE_API_KEY="your-api-key"');
        process.exit(1);
    }
    
    log.success(`API Key: ${CONFIG.API_KEY.substring(0, 8)}...`);
    log.info(`测试提示词: "${CONFIG.TEST_PROMPT}"`);
    
    console.log('\n' + colors.bold('📋 配置对比:'));
    console.log(`插件模型: ${CONFIG.MODEL}`);
    console.log(`插件分辨率: ${CONFIG.RESOLUTION}`);
    console.log(`插件提示词扩展: ${CONFIG.PROMPT_EXTEND}`);
    console.log(`原始脚本模型: wan2.2-t2v-plus`);
    console.log(`原始脚本分辨率: 1920*1080`);
    console.log(`原始脚本提示词扩展: 未设置`);
    console.log();
}

// 主函数
async function main() {
    try {
        checkConfig();
        
        // 测试插件方式
        log.step(colors.bold('🧪 测试插件API调用方式'));
        const pluginTaskId = await createVideoTaskPluginStyle(CONFIG.TEST_PROMPT);
        
        console.log('\n' + '='.repeat(80) + '\n');
        
        // 测试原始方式
        log.step(colors.bold('🧪 测试原始脚本API调用方式'));
        const originalTaskId = await createVideoTaskOriginalStyle(CONFIG.TEST_PROMPT);
        
        console.log('\n' + '='.repeat(80) + '\n');
        
        // 总结结果
        console.log(colors.bold('📊 测试结果总结:'));
        console.log(`插件方式: ${pluginTaskId ? colors.green('成功') : colors.red('失败')} ${pluginTaskId ? `(任务ID: ${pluginTaskId})` : ''}`);
        console.log(`原始方式: ${originalTaskId ? colors.green('成功') : colors.red('失败')} ${originalTaskId ? `(任务ID: ${originalTaskId})` : ''}`);
        
        if (pluginTaskId && originalTaskId) {
            log.success(colors.bold('🎉 两种方式都成功！插件API调用没有问题。'));
        } else if (!pluginTaskId && !originalTaskId) {
            log.error(colors.bold('❌ 两种方式都失败！可能是API Key或网络问题。'));
        } else if (!pluginTaskId && originalTaskId) {
            log.warning(colors.bold('⚠️  插件方式失败，原始方式成功！可能是插件配置问题。'));
            log.info('建议检查插件设置中的模型、分辨率或提示词扩展配置。');
        } else {
            log.warning(colors.bold('⚠️  原始方式失败，插件方式成功！可能是测试脚本配置问题。'));
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