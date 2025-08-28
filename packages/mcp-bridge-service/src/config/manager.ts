import * as fs from 'fs';
import * as path from 'path';
import * as joi from 'joi';
import { EventEmitter } from 'events';
import { BridgeConfig, MCPServiceConfig, APIConfig } from './types';
import { logger } from '../utils/logger';

const serviceConfigSchema = joi.object({
  id: joi.string().required(),
  name: joi.string().required(),
  description: joi.string().optional(),
  type: joi.string().valid('stdio', 'sse', 'websocket').required(),
  command: joi.string().when('type', { is: 'stdio', then: joi.required() }),
  args: joi.array().items(joi.string()).optional(),
  env: joi.object().pattern(joi.string(), joi.string()).optional(),
  url: joi.string().when('type', { is: joi.not('stdio'), then: joi.required() }),
  enabled: joi.boolean().default(true),
  tools: joi.array().items(joi.object({
    name: joi.string().required(),
    description: joi.string().required(),
    logseqCommand: joi.string().optional(),
    inputSchema: joi.any().optional()
  })).optional(),
  resources: joi.array().items(joi.object({
    uri: joi.string().required(),
    name: joi.string().required(),
    description: joi.string().optional(),
    mimeType: joi.string().optional()
  })).optional(),
  prompts: joi.array().items(joi.object({
    name: joi.string().required(),
    description: joi.string().required(),
    arguments: joi.any().optional()
  })).optional()
});

const configSchema = joi.object({
  server: joi.object({
    port: joi.number().port().default(3000),
    host: joi.string().default('0.0.0.0'),
    logLevel: joi.string().default('info'),
    cors: joi.object({
      origin: joi.array().items(joi.string()).default(['*']),
      credentials: joi.boolean().default(true)
    }).default()
  }).default(),
  
  api: joi.object({
    imageApiAddress: joi.string().default('https://gpt-best.apifox.cn'),
    imageApiKey: joi.string().allow('').default(''),
    imageModel: joi.string().default('qwen-image'),
    imageEditModel: joi.string().default('qwen-image-edit'),
    imageEditQuality: joi.string().default('auto'),
    imageEditResponseFormat: joi.string().default('b64_json'),
    imageEditSize: joi.string().default('auto'),
    imageEditCount: joi.string().default('1'),
    ttsApiAddress: joi.string().default(''),
    ttsApiKey: joi.string().default(''),
    ttsModel: joi.string().default('tts-1'),
    ttsVoice: joi.string().default('alloy'),
    ttsResponseFormat: joi.string().default('mp3'),
    ttsSpeed: joi.string().default('1.0'),
    requestTimeout: joi.number().default(30),
    dashscopeApiKey: joi.string().allow('').default(''),
    qwenTtsModel: joi.string().default('cosyvoice-v1'),
    qwenTtsVoice: joi.string().default('longxiaochun'),
    qwenTtsFormat: joi.string().default('mp3'),
    // Qwen 视频生成配置
    qwenVideoT2VModel: joi.string().default('qwen-vl-max'),
    qwenVideoI2VModel: joi.string().default('qwen-vl-max'),
    qwenVideoResolution: joi.string().default('720p'),
    qwenVideoPromptExtend: joi.boolean().default(true)
  }).default(),
  
  services: joi.array().items(serviceConfigSchema).default([])
});

export class ConfigManager extends EventEmitter {
  private config: BridgeConfig;
  private configPath: string;
  private watchers: Array<(config: BridgeConfig) => void> = [];

  constructor(configPath?: string) {
    super();
    this.configPath = configPath || path.join(process.cwd(), 'config.json');
    this.config = this.getDefaultConfig();
    this.loadConfig();
  }

  private getDefaultConfig(): BridgeConfig {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        logLevel: 'info',
        cors: {
          origin: ['*'],
          credentials: true
        }
      },
      api: {
        imageApiAddress: 'https://gpt-best.apifox.cn',
        imageApiKey: '',
        imageModel: 'qwen-image',
        imageEditModel: 'qwen-image-edit',
        imageEditQuality: 'auto',
        imageEditResponseFormat: 'b64_json',
        imageEditSize: 'auto',
        imageEditCount: '1',
        ttsApiAddress: '',
        ttsApiKey: '',
        ttsModel: 'tts-1',
        ttsVoice: 'alloy',
        ttsResponseFormat: 'mp3',
        ttsSpeed: '1.0',
        requestTimeout: 30,
        dashscopeApiKey: '',
        qwenTtsModel: 'cosyvoice-v1',
        qwenTtsVoice: 'longxiaochun',
        qwenTtsFormat: 'mp3',
        // Qwen 视频生成配置
        qwenVideoT2VModel: 'qwen-vl-max',
        qwenVideoI2VModel: 'qwen-vl-max',
        qwenVideoResolution: '720p',
        qwenVideoPromptExtend: true
      },
      services: []
    };
  }

  private loadConfig(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        logger.info('Configuration file not found, creating default config', { path: this.configPath });
        this.saveConfig();
        return;
      }

      const configData = fs.readFileSync(this.configPath, 'utf8');
      const parsedConfig = JSON.parse(configData);
      const validatedConfig = this.validateConfig(parsedConfig);
      
      this.config = validatedConfig;
      logger.info('Configuration loaded successfully', { configPath: this.configPath });
      this.emit('configChanged', this.config);
    } catch (error) {
      logger.error('Failed to load configuration', error);
      throw error;
    }
  }

  private validateConfig(config: any): BridgeConfig {
    const result = configSchema.validate(config, { allowUnknown: false });
    if (result.error) {
      throw new Error(`Configuration validation failed: ${result.error.message}`);
    }
    return result.value;
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      logger.info('Configuration saved successfully');
    } catch (error) {
      logger.error('Failed to save configuration', error);
      throw error;
    }
  }

  private notifyWatchers(): void {
    this.watchers.forEach(watcher => {
      try {
        watcher(this.config);
      } catch (error) {
        logger.error('Error in config watcher', error);
      }
    });
  }

  getConfig(): BridgeConfig {
    return { ...this.config };
  }

  getServices(): MCPServiceConfig[] {
    return this.config.services;
  }

  getService(id: string): MCPServiceConfig | undefined {
    return this.config.services.find(service => service.id === id);
  }

  getApiConfig(): APIConfig {
    return { ...this.config.api };
  }

  updateApiConfig(updates: Partial<APIConfig>): void {
    this.config.api = {
      ...this.config.api,
      ...updates
    };
    this.saveConfig();
    this.notifyWatchers();
  }

  addService(service: MCPServiceConfig): void {
    const existingIndex = this.config.services.findIndex(s => s.id === service.id);
    if (existingIndex >= 0) {
      throw new Error(`Service with id '${service.id}' already exists`);
    }

    this.config.services.push(service);
    this.saveConfig();
    this.notifyWatchers();
  }

  updateService(serviceId: string, updates: Partial<MCPServiceConfig>): void {
    const serviceIndex = this.config.services.findIndex(service => service.id === serviceId);
    if (serviceIndex === -1) {
      throw new Error(`Service with id '${serviceId}' not found`);
    }

    this.config.services[serviceIndex] = {
      ...this.config.services[serviceIndex],
      ...updates
    };
    this.saveConfig();
    this.notifyWatchers();
  }

  removeService(serviceId: string): void {
    const serviceIndex = this.config.services.findIndex(service => service.id === serviceId);
    if (serviceIndex === -1) {
      throw new Error(`Service with id '${serviceId}' not found`);
    }

    this.config.services.splice(serviceIndex, 1);
    this.saveConfig();
    this.notifyWatchers();
  }

  watch(callback: (config: BridgeConfig) => void): () => void {
    this.watchers.push(callback);
    return () => {
      const index = this.watchers.indexOf(callback);
      if (index > -1) {
        this.watchers.splice(index, 1);
      }
    };
  }

  reload(): void {
    this.loadConfig();
  }
}