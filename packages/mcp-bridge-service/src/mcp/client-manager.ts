import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServiceConfig, MCPClientConnection, ToolCallRequest, ToolCallResponse, ResourceRequest, ResourceResponse } from '../config/types';
import { logger } from '../utils/logger';
import { loggingService } from '../services/logging-service';

// MCP客户端接口
interface MCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<any[]>;
  listResources(): Promise<any[]>;
  listPrompts(): Promise<any[]>;
  callTool(name: string, args: any): Promise<any>;
  readResource(uri: string): Promise<any>;
  getPrompt(name: string, args?: any): Promise<any>;
}

// 真实的MCP客户端实现
class RealMCPClient implements MCPClient {
  private config: MCPServiceConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private process: ChildProcess | null = null;
  private connected = false;

  constructor(config: MCPServiceConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      if (!this.config.command) {
        throw new Error('MCP service command is required');
      }

      // 创建传输层
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || []
      });

      // 创建客户端
      this.client = new Client({
        name: 'mcp-bridge-service',
        version: '1.0.0'
      }, {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      });

      // 连接到MCP服务
      await this.client.connect(this.transport);
      this.connected = true;
      
      logger.info(`Connected to MCP service: ${this.config.name}`);
    } catch (error) {
      logger.error(`Failed to connect to MCP service ${this.config.name}:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
      
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      
      this.connected = false;
      logger.info(`Disconnected from MCP service: ${this.config.name}`);
    } catch (error) {
      logger.error(`Error disconnecting from MCP service ${this.config.name}:`, error);
    }
  }

  async listTools(): Promise<any[]> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to MCP service');
    }
    
    try {
      const response = await this.client.listTools();
      return response.tools || [];
    } catch (error) {
      logger.error(`Failed to list tools for service ${this.config.name}:`, error);
      throw error;
    }
  }

  async listResources(): Promise<any[]> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to MCP service');
    }
    
    try {
      const response = await this.client.listResources();
      return response.resources || [];
    } catch (error) {
      logger.error(`Failed to list resources for service ${this.config.name}:`, error);
      throw error;
    }
  }

  async listPrompts(): Promise<any[]> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to MCP service');
    }
    
    try {
      const response = await this.client.listPrompts();
      return response.prompts || [];
    } catch (error) {
      logger.error(`Failed to list prompts for service ${this.config.name}:`, error);
      throw error;
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to MCP service');
    }
    
    try {
      const response = await this.client.callTool({ name, arguments: args });
      return response.content;
    } catch (error) {
      logger.error(`Failed to call tool ${name} for service ${this.config.name}:`, error);
      throw error;
    }
  }

  async readResource(uri: string): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to MCP service');
    }
    
    try {
      const response = await this.client.readResource({ uri });
      return response.contents;
    } catch (error) {
      logger.error(`Failed to read resource ${uri} for service ${this.config.name}:`, error);
      throw error;
    }
  }

  async getPrompt(name: string, args?: any): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to MCP service');
    }
    
    try {
      const response = await this.client.getPrompt({ name, arguments: args });
      return response;
    } catch (error) {
      logger.error(`Failed to get prompt ${name} for service ${this.config.name}:`, error);
      throw error;
    }
  }
}

export class MCPClientManager extends EventEmitter {
  private connections: Map<string, MCPClientConnection> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private maxRetries: number;
  private retryDelay: number;
  private connectionTimeout: number;

  constructor(options: {
    maxRetries?: number;
    retryDelay?: number;
    connectionTimeout?: number;
  } = {}) {
    super();
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.connectionTimeout = options.connectionTimeout || 30000;
  }

  async addService(config: MCPServiceConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      await this.removeService(config.id);
    }

    const connection: MCPClientConnection = {
      id: config.id,
      config,
      client: new RealMCPClient(config), // 真实的MCP客户端
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: []
    };

    this.connections.set(config.id, connection);
    
    if (config.enabled) {
      await this.connectService(config.id);
    }

    this.emit('serviceAdded', config.id);
  }

  async removeService(serviceId: string): Promise<void> {
    const connection = this.connections.get(serviceId);
    if (!connection) return;

    await this.disconnectService(serviceId);
    this.connections.delete(serviceId);
    
    const timer = this.reconnectTimers.get(serviceId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(serviceId);
    }

    this.emit('serviceRemoved', serviceId);
  }

  async connectService(serviceId: string): Promise<void> {
    const connection = this.connections.get(serviceId);
    if (!connection) {
      throw new Error(`Service ${serviceId} not found`);
    }

    if (connection.status === 'connected' || connection.status === 'connecting') {
      return;
    }

    connection.status = 'connecting';
    this.emit('serviceStatusChanged', serviceId, 'connecting');

    try {
      await Promise.race([
        connection.client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout)
        )
      ]);

      // 获取服务能力
      const [tools, resources, prompts] = await Promise.all([
        connection.client.listTools().catch(() => []),
        connection.client.listResources().catch(() => []),
        connection.client.listPrompts().catch(() => [])
      ]);

      connection.tools = tools;
      connection.resources = resources;
      connection.prompts = prompts;
      connection.status = 'connected';
      connection.connectedAt = new Date();
      connection.lastError = undefined;

      logger.info(`Successfully connected to service: ${serviceId}`);
      this.emit('serviceStatusChanged', serviceId, 'connected');
      this.emit('serviceConnected', serviceId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      connection.status = 'error';
      connection.lastError = errorMessage;
      
      logger.error(`Failed to connect to service ${serviceId}:`, error);
      this.emit('serviceStatusChanged', serviceId, 'error');
      this.emit('serviceError', serviceId, errorMessage);

      // 安排重连
      this.scheduleReconnect(serviceId);
    }
  }

  async disconnectService(serviceId: string): Promise<void> {
    const connection = this.connections.get(serviceId);
    if (!connection) return;

    if (connection.status === 'connected' || connection.status === 'connecting') {
      try {
        await connection.client.disconnect();
      } catch (error) {
        logger.warn(`Error disconnecting from service ${serviceId}:`, error);
      }
    }

    connection.status = 'disconnected';
    this.emit('serviceStatusChanged', serviceId, 'disconnected');
    this.emit('serviceDisconnected', serviceId);
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    const startTime = Date.now();
    const connection = this.connections.get(request.serviceId);
    
    if (!connection) {
      return {
        success: false,
        error: `Service ${request.serviceId} not found`,
        metadata: {
          executionTime: Date.now() - startTime,
          serviceId: request.serviceId,
          toolName: request.toolName
        }
      };
    }

    if (connection.status !== 'connected') {
      return {
        success: false,
        error: `Service ${request.serviceId} is not connected (status: ${connection.status})`,
        metadata: {
          executionTime: Date.now() - startTime,
          serviceId: request.serviceId,
          toolName: request.toolName
        }
      };
    }

    try {
      const result = await connection.client.callTool(request.toolName, request.arguments);
      const duration = Date.now() - startTime;
      
      // 记录成功的工具调用日志
      loggingService.logMCPToolCall({
        serviceId: request.serviceId,
        toolName: request.toolName,
        arguments: request.arguments,
        result,
        duration
      });
      
      return {
        success: true,
        result,
        metadata: {
          executionTime: duration,
          serviceId: request.serviceId,
          toolName: request.toolName
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const duration = Date.now() - startTime;
      
      // 记录失败的工具调用日志
      loggingService.logMCPToolCall({
        serviceId: request.serviceId,
        toolName: request.toolName,
        arguments: request.arguments,
        error: errorMessage,
        duration
      });
      
      return {
        success: false,
        error: errorMessage,
        metadata: {
          executionTime: duration,
          serviceId: request.serviceId,
          toolName: request.toolName
        }
      };
    }
  }

  async readResource(request: ResourceRequest): Promise<ResourceResponse> {
    const connection = this.connections.get(request.serviceId);
    
    if (!connection) {
      return {
        success: false,
        error: `Service ${request.serviceId} not found`,
        metadata: {
          serviceId: request.serviceId,
          uri: request.uri
        }
      };
    }

    if (connection.status !== 'connected') {
      return {
        success: false,
        error: `Service ${request.serviceId} is not connected`,
        metadata: {
          serviceId: request.serviceId,
          uri: request.uri
        }
      };
    }

    try {
      const result = await connection.client.readResource(request.uri);
      
      return {
        success: true,
        content: JSON.stringify(result),
        mimeType: 'application/json',
        metadata: {
          serviceId: request.serviceId,
          uri: request.uri,
          size: JSON.stringify(result).length
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return {
        success: false,
        error: errorMessage,
        metadata: {
          serviceId: request.serviceId,
          uri: request.uri
        }
      };
    }
  }

  getServices(): MCPClientConnection[] {
    return Array.from(this.connections.values());
  }

  getService(serviceId: string): MCPClientConnection | undefined {
    return this.connections.get(serviceId);
  }

  getConnectedServices(): MCPClientConnection[] {
    return this.getServices().filter(conn => conn.status === 'connected');
  }

  getAllTools(): Array<{ serviceId: string; tool: any }> {
    const tools: Array<{ serviceId: string; tool: any }> = [];
    
    for (const connection of this.connections.values()) {
      if (connection.status === 'connected') {
        for (const tool of connection.tools) {
          tools.push({ serviceId: connection.id, tool });
        }
      }
    }
    
    return tools;
  }

  async connectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map(serviceId => 
      this.connectService(serviceId).catch(error => {
        logger.error(`Failed to connect service ${serviceId}:`, error);
      })
    );
    await Promise.all(promises);
  }

  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map(serviceId => 
      this.disconnectService(serviceId).catch(error => {
        logger.error(`Failed to disconnect service ${serviceId}:`, error);
      })
    );
    await Promise.all(promises);
  }

  clear(): void {
    this.connections.clear();
  }

  private scheduleReconnect(serviceId: string): void {
    const existingTimer = this.reconnectTimers.get(serviceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(serviceId);
      const connection = this.connections.get(serviceId);
      
      if (connection && connection.config.enabled && connection.status === 'error') {
        logger.info(`Attempting to reconnect to service: ${serviceId}`);
        await this.connectService(serviceId);
      }
    }, this.retryDelay);

    this.reconnectTimers.set(serviceId, timer);
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down MCP Client Manager');
    
    // 清理重连定时器
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // 断开所有连接
    const disconnectPromises = Array.from(this.connections.keys()).map(serviceId => 
      this.disconnectService(serviceId)
    );
    
    await Promise.allSettled(disconnectPromises);
    this.connections.clear();
    
    this.removeAllListeners();
  }
}