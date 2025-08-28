#!/usr/bin/env node

import { BridgeServer } from './server';
import { logger } from './utils/logger';

/**
 * 主入口文件
 * 启动 Logseq MCP Bridge Service
 */
async function main() {
  try {
    // 从命令行参数获取配置文件路径
    const configPath = process.argv[2];
    
    logger.info('Starting Logseq MCP Bridge Service...');
    
    if (configPath) {
      logger.info(`Using config file: ${configPath}`);
    } else {
      logger.info('Using default configuration');
    }
    
    // 创建并启动服务器
    const server = new BridgeServer(configPath);
    await server.start();
    
    logger.info('Bridge service is running successfully');
    
  } catch (error) {
    logger.error('Failed to start bridge service:', error);
    process.exit(1);
  }
}

// 启动应用
if (require.main === module) {
  main();
}

export { BridgeServer } from './server';
export { MCPClientManager } from './mcp/client-manager';
export { ConfigManager } from './config/manager';
export * from './config/types';