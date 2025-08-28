import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

// 接口调用日志类型
export interface APICallLog {
  id: string;
  timestamp: string;
  method: string;
  endpoint: string;
  requestBody?: any;
  responseStatus: number;
  responseBody?: any;
  duration: number;
  userAgent?: string;
  ip?: string;
  error?: string;
}

// 任务状态变更日志
export interface TaskStatusLog {
  id: string;
  taskId: string;
  taskType: string;
  timestamp: string;
  oldStatus: string;
  newStatus: string;
  details?: any;
  error?: string;
}

// MCP工具调用日志
export interface MCPToolCallLog {
  id: string;
  timestamp: string;
  serviceId: string;
  toolName: string;
  arguments: any;
  result?: any;
  error?: string;
  duration: number;
}

export class LoggingService {
  private apiCallLogs: APICallLog[] = [];
  private taskStatusLogs: TaskStatusLog[] = [];
  private mcpToolCallLogs: MCPToolCallLog[] = [];
  private maxLogEntries = 1000; // 最大日志条目数
  private logDirectory: string;

  constructor() {
    this.logDirectory = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private trimLogs<T>(logs: T[]): T[] {
    if (logs.length > this.maxLogEntries) {
      return logs.slice(-this.maxLogEntries);
    }
    return logs;
  }

  // 记录API调用日志
  logAPICall(data: Omit<APICallLog, 'id' | 'timestamp'>): string {
    const logEntry: APICallLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...data
    };

    this.apiCallLogs.push(logEntry);
    this.apiCallLogs = this.trimLogs(this.apiCallLogs);

    // 记录到文件
    this.writeLogToFile('api-calls', logEntry);
    
    logger.info('API Call logged', {
      id: logEntry.id,
      method: logEntry.method,
      endpoint: logEntry.endpoint,
      status: logEntry.responseStatus,
      duration: logEntry.duration
    });

    return logEntry.id;
  }

  // 记录任务状态变更日志
  logTaskStatusChange(data: Omit<TaskStatusLog, 'id' | 'timestamp'>): string {
    const logEntry: TaskStatusLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...data
    };

    this.taskStatusLogs.push(logEntry);
    this.taskStatusLogs = this.trimLogs(this.taskStatusLogs);

    // 记录到文件
    this.writeLogToFile('task-status', logEntry);
    
    logger.info('Task status change logged', {
      id: logEntry.id,
      taskId: logEntry.taskId,
      taskType: logEntry.taskType,
      oldStatus: logEntry.oldStatus,
      newStatus: logEntry.newStatus
    });

    return logEntry.id;
  }

  // 记录MCP工具调用日志
  logMCPToolCall(data: Omit<MCPToolCallLog, 'id' | 'timestamp'>): string {
    const logEntry: MCPToolCallLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...data
    };

    this.mcpToolCallLogs.push(logEntry);
    this.mcpToolCallLogs = this.trimLogs(this.mcpToolCallLogs);

    // 记录到文件
    this.writeLogToFile('mcp-tool-calls', logEntry);
    
    logger.info('MCP tool call logged', {
      id: logEntry.id,
      serviceId: logEntry.serviceId,
      toolName: logEntry.toolName,
      duration: logEntry.duration,
      success: !logEntry.error
    });

    return logEntry.id;
  }

  // 写入日志到文件
  private writeLogToFile(type: string, logEntry: any): void {
    try {
      const today = new Date().toISOString().split('T')[0];
      const filename = `${type}-${today}.jsonl`;
      const filepath = path.join(this.logDirectory, filename);
      
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(filepath, logLine, 'utf8');
    } catch (error) {
      logger.error('Failed to write log to file:', error);
    }
  }

  // 获取API调用日志
  getAPICallLogs(limit?: number, offset?: number): APICallLog[] {
    const logs = [...this.apiCallLogs].reverse(); // 最新的在前
    if (limit !== undefined) {
      const start = offset || 0;
      return logs.slice(start, start + limit);
    }
    return logs;
  }

  // 获取任务状态日志
  getTaskStatusLogs(taskId?: string, limit?: number, offset?: number): TaskStatusLog[] {
    let logs = [...this.taskStatusLogs].reverse();
    
    if (taskId) {
      logs = logs.filter(log => log.taskId === taskId);
    }
    
    if (limit !== undefined) {
      const start = offset || 0;
      return logs.slice(start, start + limit);
    }
    return logs;
  }

  // 获取MCP工具调用日志
  getMCPToolCallLogs(serviceId?: string, toolName?: string, limit?: number, offset?: number): MCPToolCallLog[] {
    let logs = [...this.mcpToolCallLogs].reverse();
    
    if (serviceId) {
      logs = logs.filter(log => log.serviceId === serviceId);
    }
    
    if (toolName) {
      logs = logs.filter(log => log.toolName === toolName);
    }
    
    if (limit !== undefined) {
      const start = offset || 0;
      return logs.slice(start, start + limit);
    }
    return logs;
  }

  // 获取统计信息
  getStatistics(): {
    totalAPICalls: number;
    totalTaskStatusChanges: number;
    totalMCPToolCalls: number;
    recentAPICallsCount: number;
    recentTaskStatusChangesCount: number;
    recentMCPToolCallsCount: number;
  } {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    return {
      totalAPICalls: this.apiCallLogs.length,
      totalTaskStatusChanges: this.taskStatusLogs.length,
      totalMCPToolCalls: this.mcpToolCallLogs.length,
      recentAPICallsCount: this.apiCallLogs.filter(log => log.timestamp > oneHourAgo).length,
      recentTaskStatusChangesCount: this.taskStatusLogs.filter(log => log.timestamp > oneHourAgo).length,
      recentMCPToolCallsCount: this.mcpToolCallLogs.filter(log => log.timestamp > oneHourAgo).length
    };
  }

  // 清理旧日志
  clearOldLogs(daysToKeep: number = 7): void {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    
    this.apiCallLogs = this.apiCallLogs.filter(log => log.timestamp > cutoffDate);
    this.taskStatusLogs = this.taskStatusLogs.filter(log => log.timestamp > cutoffDate);
    this.mcpToolCallLogs = this.mcpToolCallLogs.filter(log => log.timestamp > cutoffDate);
    
    logger.info('Old logs cleared', {
      cutoffDate,
      remainingAPICalls: this.apiCallLogs.length,
      remainingTaskStatusLogs: this.taskStatusLogs.length,
      remainingMCPToolCalls: this.mcpToolCallLogs.length
    });
  }

  // 导出日志
  exportLogs(type: 'api-calls' | 'task-status' | 'mcp-tool-calls' | 'all', format: 'json' | 'csv' = 'json'): string {
    let data: any = [];
    
    switch (type) {
      case 'api-calls':
        data = this.apiCallLogs;
        break;
      case 'task-status':
        data = this.taskStatusLogs;
        break;
      case 'mcp-tool-calls':
        data = this.mcpToolCallLogs;
        break;
      case 'all':
        data = {
          apiCalls: this.apiCallLogs,
          taskStatus: this.taskStatusLogs,
          mcpToolCalls: this.mcpToolCallLogs
        };
        break;
    }
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else {
      // CSV格式实现（简化版）
      if (Array.isArray(data) && data.length > 0) {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(item => 
          Object.values(item).map(value => 
            typeof value === 'object' ? JSON.stringify(value) : String(value)
          ).join(',')
        );
        return [headers, ...rows].join('\n');
      }
      return '';
    }
  }
}

// 单例实例
export const loggingService = new LoggingService();