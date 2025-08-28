#!/usr/bin/env node

/**
 * 视频下载工具
 * 用于下载已生成的视频文件
 * 使用方法: node download-video.js <video_url> [filename]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

// 日志函数
const log = {
    info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    step: (msg) => console.log(`${colors.blue}→${colors.reset} ${msg}`)
};

// 下载视频文件
async function downloadVideo(videoUrl, filename = null) {
    if (!filename) {
        const urlParts = videoUrl.split('/');
        const urlFilename = urlParts[urlParts.length - 1].split('?')[0];
        filename = `downloaded_video_${Date.now()}_${urlFilename}`;
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
                
                // 显示文件信息
                const stats = fs.statSync(filename);
                const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                log.info(`文件大小: ${fileSizeMB} MB`);
                log.info(`保存路径: ${path.resolve(filename)}`);
                
                resolve(filename);
            });
            
        }).on('error', (error) => {
            fs.unlink(filename, () => {}); // 删除不完整的文件
            reject(error);
        });
    });
}

// 主函数
async function main() {
    console.log(`\n${colors.bold('🎬 视频下载工具')}\n`);
    
    // 检查命令行参数
    if (process.argv.length < 3) {
        log.error('请提供视频URL');
        console.log('\n使用方法:');
        console.log('  node download-video.js <video_url> [filename]');
        console.log('\n示例:');
        console.log('  node download-video.js "https://example.com/video.mp4"');
        console.log('  node download-video.js "https://example.com/video.mp4" "my_video.mp4"');
        process.exit(1);
    }
    
    const videoUrl = process.argv[2];
    const filename = process.argv[3] || null;
    
    log.info(`视频URL: ${videoUrl}`);
    if (filename) {
        log.info(`指定文件名: ${filename}`);
    }
    
    try {
        const downloadedFile = await downloadVideo(videoUrl, filename);
        log.success(`🎉 视频下载成功！`);
        log.info(`您可以使用以下命令播放视频:`);
        console.log(`  open "${downloadedFile}"  # macOS`);
        console.log(`  vlc "${downloadedFile}"   # VLC播放器`);
    } catch (error) {
        log.error(`❌ 下载失败: ${error.message}`);
        process.exit(1);
    }
}

// 运行主函数
main().catch(error => {
    log.error(`程序执行出错: ${error.message}`);
    process.exit(1);
});