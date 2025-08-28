import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging-service';
import { logger } from '../utils/logger';

// 扩展Request接口以包含开始时间
declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      logId?: string;
    }
  }
}

// API调用日志记录中间件
export function apiLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 记录请求开始时间
  req.startTime = Date.now();
  
  // 获取客户端IP
  const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] as string || 'unknown';
  
  // 获取User-Agent
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // 保存原始的res.json和res.send方法
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  
  let responseBody: any;
  let responseSent = false;
  
  // 重写res.json方法以捕获响应体
  res.json = function(body: any) {
    if (!responseSent) {
      responseBody = body;
      logAPICall();
      responseSent = true;
    }
    return originalJson(body);
  };
  
  // 重写res.send方法以捕获响应体
  res.send = function(body: any) {
    if (!responseSent) {
      responseBody = body;
      logAPICall();
      responseSent = true;
    }
    return originalSend(body);
  };
  
  // 监听响应结束事件
  res.on('finish', () => {
    if (!responseSent) {
      logAPICall();
      responseSent = true;
    }
  });
  
  function logAPICall() {
    try {
      const duration = req.startTime ? Date.now() - req.startTime : 0;
      
      // 过滤敏感信息
      const sanitizedRequestBody = sanitizeRequestBody(req.body);
      const sanitizedResponseBody = sanitizeResponseBody(responseBody);
      
      const logId = loggingService.logAPICall({
        method: req.method,
        endpoint: req.originalUrl || req.url,
        requestBody: sanitizedRequestBody,
        responseStatus: res.statusCode,
        responseBody: sanitizedResponseBody,
        duration,
        userAgent,
        ip: Array.isArray(ip) ? ip[0] : ip
      });
      
      req.logId = logId;
    } catch (error) {
      logger.error('Failed to log API call:', error);
    }
  }
  
  next();
}

// 清理请求体中的敏感信息
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }
  
  const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'authorization'];
  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  // 递归处理嵌套对象
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeRequestBody(sanitized[key]);
    }
  }
  
  return sanitized;
}

// 清理响应体中的敏感信息
function sanitizeResponseBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }
  
  const sensitiveFields = ['token', 'apiKey', 'secret', 'authorization'];
  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  // 递归处理嵌套对象
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeResponseBody(sanitized[key]);
    }
  }
  
  return sanitized;
}

// 错误日志记录中间件
export function errorLoggingMiddleware(error: Error, req: Request, res: Response, next: NextFunction): void {
  try {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] as string || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    loggingService.logAPICall({
      method: req.method,
      endpoint: req.originalUrl || req.url,
      requestBody: sanitizeRequestBody(req.body),
      responseStatus: res.statusCode || 500,
      duration,
      userAgent,
      ip: Array.isArray(ip) ? ip[0] : ip,
      error: error.message
    });
  } catch (logError) {
    logger.error('Failed to log error:', logError);
  }
  
  next(error);
}

// 跳过日志记录的路径
const skipLoggingPaths = [
  '/health',
  '/favicon.ico',
  '/robots.txt'
];

// 条件日志记录中间件
export function conditionalLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 检查是否应该跳过日志记录
  const shouldSkip = skipLoggingPaths.some(path => req.path === path) ||
                     req.path.startsWith('/static/') ||
                     req.path.startsWith('/assets/');
  
  if (shouldSkip) {
    return next();
  }
  
  return apiLoggingMiddleware(req, res, next);
}