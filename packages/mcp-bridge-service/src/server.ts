import express from 'express';
import cors from 'cors';
import path from 'path';
import { createRoutes } from './api/routes';
import { MCPClientManager } from './mcp/client-manager';
import { ConfigManager } from './config/manager';
import { logger } from './utils/logger';
import { BridgeConfig } from './config/types';

export class BridgeServer {
  private app: express.Application;
  private server: any;
  private clientManager: MCPClientManager;
  private configManager: ConfigManager;
  private config: BridgeConfig;

  constructor(configPath?: string) {
    this.app = express();
    this.configManager = new ConfigManager(configPath);
    this.clientManager = new MCPClientManager();
    this.config = this.configManager.getConfig();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // CORS配置 - 允许Logseq插件访问
    this.app.use(cors({
      origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'app://logseq.com',
        'capacitor://localhost',
        'http://localhost:*',
        'https://logseq.com'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // 解析JSON请求体
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 请求日志
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: req.method !== 'GET' ? req.body : undefined
      });
      next();
    });
  }

  private setupRoutes(): void {
    // 静态文件服务 - 配置界面
    const publicPath = path.join(__dirname, '..', 'public');
    this.app.use('/ui', express.static(publicPath));
    
    // 静态文件服务 - 生成的图片文件
    this.app.use('/images', express.static('/tmp', {
      setHeaders: (res, path) => {
        // 设置适当的缓存头
        res.setHeader('Cache-Control', 'public, max-age=3600');
        // 设置CORS头以允许跨域访问
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    }));
    
    // API路由
    this.app.use('/api', createRoutes(this.clientManager, this.configManager));

    // 根路径 - 重定向到配置界面
    this.app.get('/', (req, res) => {
      res.redirect('/ui');
    });
    
    // API信息端点
    this.app.get('/info', (req, res) => {
      res.json({
        name: 'Logseq MCP Bridge Service',
        version: process.env.npm_package_version || '1.0.0',
        description: 'Bridge service for connecting Logseq plugins to MCP servers',
        endpoints: {
          health: '/api/health',
          services: '/api/services',
          tools: '/api/tools',
          config: '/api/config',
          ui: '/ui'
        },
        documentation: 'https://github.com/your-repo/logseq-mcp-bridge'
      });
    });

    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        availableEndpoints: [
          '/api/health',
          '/api/services',
          '/api/tools',
          '/api/config'
        ]
      });
    });
  }

  private setupErrorHandling(): void {
    // 全局错误处理
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error:', error);
      
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString()
      });
    });

    // 进程错误处理
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // 优雅关闭
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      this.shutdown();
    });
  }

  public async start(): Promise<void> {
    try {
      // 加载配置
      // 配置已在构造函数中加载
      this.config = this.configManager.getConfig();
      
      logger.info('Configuration loaded:', {
        port: this.config.server.port,
        logLevel: this.config.server.logLevel,
        servicesCount: this.config.services.length
      });

      // 启动HTTP服务器
      const port = this.config.server.port;
      this.server = this.app.listen(port, () => {
        logger.info(`Bridge service started on port ${port}`);
        logger.info(`Configuration UI: http://localhost:${port}/ui`);
        logger.info(`Health check: http://localhost:${port}/api/health`);
        logger.info(`API info: http://localhost:${port}/info`);
      });

      // 异步初始化MCP服务连接（不阻塞HTTP服务器启动）
      this.initializeMCPServices().catch(error => {
        logger.error('Failed to initialize MCP services:', error);
      });

      // 监听配置变更
      this.configManager.on('configChanged', async (newConfig) => {
        logger.info('Configuration changed, reloading services...');
        await this.reloadServices(newConfig);
      });

    } catch (error) {
      logger.error('Failed to start bridge service:', error);
      throw error;
    }
  }

  private async initializeMCPServices(): Promise<void> {
    const enabledServices = this.config.services.filter(service => service.enabled);
    
    logger.info(`Initializing ${enabledServices.length} MCP services...`);

    for (const serviceConfig of enabledServices) {
      try {
        await this.clientManager.addService(serviceConfig);
        logger.info(`Service ${serviceConfig.name} added successfully`);
      } catch (error) {
        logger.error(`Failed to add service ${serviceConfig.name}:`, error);
      }
    }

    // 连接所有服务
    await this.clientManager.connectAll();
  }

  private async reloadServices(newConfig: BridgeConfig): Promise<void> {
    try {
      // 断开所有现有连接
      await this.clientManager.disconnectAll();
      
      // 清除所有服务
      this.clientManager.clear();
      
      // 重新初始化服务
      this.config = newConfig;
      await this.initializeMCPServices();
      
      logger.info('Services reloaded successfully');
    } catch (error) {
      logger.error('Failed to reload services:', error);
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down bridge service...');

    try {
      // 断开所有MCP连接
      await this.clientManager.disconnectAll();
      
      // 关闭HTTP服务器
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => {
            logger.info('HTTP server closed');
            resolve();
          });
        });
      }
      
      logger.info('Bridge service shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    } finally {
      process.exit(0);
    }
  }

  public getApp(): express.Application {
    return this.app;
  }

  public getClientManager(): MCPClientManager {
    return this.clientManager;
  }

  public getConfigManager(): ConfigManager {
    return this.configManager;
  }
}

// 如果直接运行此文件，启动服务器
if (require.main === module) {
  const configPath = process.argv[2]; // 可选的配置文件路径
  const server = new BridgeServer(configPath);
  
  server.start().catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default BridgeServer;