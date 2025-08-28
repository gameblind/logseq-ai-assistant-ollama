import winston from 'winston';
import chalk from 'chalk';

// 轮询请求缓存，用于减少重复日志
const pollingCache = new Map<string, { count: number, lastTime: number }>();
const POLLING_CACHE_TIMEOUT = 10000; // 10秒

// 自定义格式化函数
const customFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  // 检查是否为轮询请求
  const isPolling = meta.endpoint && typeof meta.endpoint === 'string' && (
    meta.endpoint.includes('/api/image/task/') ||
    meta.endpoint.includes('/api/tts/task/') ||
    meta.endpoint.includes('/api/health')
  );
  
  // 如果是轮询请求，进行缓存处理
  if (isPolling && meta.endpoint) {
    const cacheKey = `${meta.method}-${meta.endpoint}`;
    const now = Date.now();
    const cached = pollingCache.get(cacheKey);
    
    if (cached && (now - cached.lastTime) < POLLING_CACHE_TIMEOUT) {
      cached.count++;
      cached.lastTime = now;
      // 每10次轮询才显示一次
      if (cached.count % 10 !== 0) {
        return ''; // 跳过此日志
      }
      message = `${message} (${cached.count}次轮询)`;
    } else {
      pollingCache.set(cacheKey, { count: 1, lastTime: now });
    }
  }
  
  let log = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(meta).length > 0) {
    // 突出显示关键信息
    const metaStr = JSON.stringify(meta, null, 0);
    
    // 根据日志类型添加颜色
    if (meta.endpoint) {
      if (meta.method === 'POST') {
        log += ` ${chalk.red.bold(metaStr)}`; // POST请求用红色
      } else if (meta.method === 'GET' && !isPolling) {
        log += ` ${chalk.green.bold(metaStr)}`; // 非轮询GET请求用绿色
      } else {
        log += ` ${chalk.gray(metaStr)}`; // 轮询请求用灰色
      }
    } else if (meta.taskId || meta.status) {
      log += ` ${chalk.yellow.bold(metaStr)}`; // 任务状态用黄色
    } else if (meta.error) {
      log += ` ${chalk.red.bold(metaStr)}`; // 错误信息用红色
    } else {
      log += ` ${chalk.cyan(metaStr)}`; // 其他信息用青色
    }
  }
  
  return log;
});

// 创建logger实例
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true })
  ),
  defaultMeta: { service: 'mcp-bridge' },
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    })
  ]
});

// 如果不是生产环境，添加文件日志
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
  
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
}

// 处理未捕获的异常
logger.exceptions.handle(
  new winston.transports.File({ filename: 'logs/exceptions.log' })
);

// 处理未处理的Promise拒绝
logger.rejections.handle(
  new winston.transports.File({ filename: 'logs/rejections.log' })
);

export default logger;