/**
 * 配置管理增强模块
 * 提供配置验证、缓存、安全性和动态更新功能
 */

import { getSettings } from './settings';

export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export interface ServiceConfig {
    bridgeServiceUrl: string;
    openaiKey: string;
    openaiAddress: string;
    ollamaAddress: string;
    ollamaModel: string;
    imageApiKey?: string;
    imageApiAddress?: string;
    imageModel?: string;
    dashscopeApiKey?: string;
}

/**
 * 配置管理器类
 */
export class ConfigManager {
    private static instance: ConfigManager;
    private configCache: ServiceConfig | null = null;
    private cacheTimestamp = 0;
    private readonly CACHE_TTL = 30000; // 30秒缓存
    private configChangeListeners: Array<(config: ServiceConfig) => void> = [];
    
    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }
    
    /**
     * 获取配置（带缓存）
     */
    async getConfig(forceRefresh = false): Promise<ServiceConfig> {
        const now = Date.now();
        
        if (!forceRefresh && 
            this.configCache && 
            (now - this.cacheTimestamp) < this.CACHE_TTL) {
            return this.configCache;
        }
        
        try {
            const settings = await getSettings();
            const config: ServiceConfig = {
                bridgeServiceUrl: settings.bridgeServiceUrl || '',
                openaiKey: settings.openaiKey || '',
                openaiAddress: settings.openaiAddress || '',
                ollamaAddress: settings.ollamaAddress || '',
                ollamaModel: settings.ollamaModel || '',
                imageApiKey: settings.imageApiKey,
                imageApiAddress: settings.imageApiAddress,
                imageModel: settings.imageModel,
                dashscopeApiKey: settings.dashscopeApiKey
            };
            
            // 更新缓存
            const oldConfig = this.configCache;
            this.configCache = config;
            this.cacheTimestamp = now;
            
            // 如果配置发生变化，通知监听器
            if (oldConfig && JSON.stringify(oldConfig) !== JSON.stringify(config)) {
                this.notifyConfigChange(config);
            }
            
            return config;
        } catch (error) {
            console.error('获取配置失败:', error);
            throw new Error('无法获取插件配置');
        }
    }
    
    /**
     * 验证配置
     */
    async validateConfig(config?: ServiceConfig): Promise<ConfigValidationResult> {
        const currentConfig = config || await this.getConfig();
        const errors: string[] = [];
        const warnings: string[] = [];
        
        // 必需配置检查
        if (!currentConfig.bridgeServiceUrl) {
            errors.push('桥接服务地址未配置');
        } else {
            // 验证URL格式
            try {
                new URL(currentConfig.bridgeServiceUrl);
            } catch {
                errors.push('桥接服务地址格式无效');
            }
        }
        
        if (!currentConfig.openaiKey) {
            warnings.push('OpenAI API Key未配置，AI对话功能将不可用');
        }
        
        if (!currentConfig.openaiAddress) {
            warnings.push('OpenAI服务地址未配置');
        } else {
            try {
                new URL(currentConfig.openaiAddress);
            } catch {
                errors.push('OpenAI服务地址格式无效');
            }
        }
        
        if (!currentConfig.ollamaAddress) {
            warnings.push('Ollama服务地址未配置');
        } else {
            try {
                new URL(currentConfig.ollamaAddress);
            } catch {
                errors.push('Ollama服务地址格式无效');
            }
        }
        
        if (!currentConfig.ollamaModel) {
            warnings.push('Ollama模型未配置');
        }
        
        // 可选配置检查
        if (!currentConfig.imageApiKey) {
            warnings.push('图像生成API Key未配置，图像生成功能将不可用');
        }
        
        if (!currentConfig.dashscopeApiKey) {
            warnings.push('DashScope API Key未配置，视频生成功能将不可用');
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
    
    /**
     * 检查特定功能是否可用
     */
    async isFeatureAvailable(feature: 'ai-chat' | 'image-generation' | 'video-generation' | 'bridge-service'): Promise<boolean> {
        const config = await this.getConfig();
        
        switch (feature) {
            case 'ai-chat':
                return !!(config.openaiKey && config.openaiAddress);
            case 'image-generation':
                return !!(config.imageApiKey && config.imageApiAddress);
            case 'video-generation':
                return !!config.dashscopeApiKey;
            case 'bridge-service':
                return !!config.bridgeServiceUrl;
            default:
                return false;
        }
    }
    
    /**
     * 获取安全的配置（隐藏敏感信息）
     */
    async getSafeConfig(): Promise<Partial<ServiceConfig>> {
        const config = await this.getConfig();
        
        return {
            bridgeServiceUrl: config.bridgeServiceUrl,
            openaiAddress: config.openaiAddress,
            ollamaAddress: config.ollamaAddress,
            ollamaModel: config.ollamaModel,
            imageApiAddress: config.imageApiAddress,
            imageModel: config.imageModel,
            // API Keys 用星号替换
            openaiKey: config.openaiKey ? this.maskApiKey(config.openaiKey) : '',
            imageApiKey: config.imageApiKey ? this.maskApiKey(config.imageApiKey) : '',
            dashscopeApiKey: config.dashscopeApiKey ? this.maskApiKey(config.dashscopeApiKey) : ''
        };
    }
    
    /**
     * 添加配置变更监听器
     */
    onConfigChange(listener: (config: ServiceConfig) => void): void {
        this.configChangeListeners.push(listener);
    }
    
    /**
     * 移除配置变更监听器
     */
    removeConfigChangeListener(listener: (config: ServiceConfig) => void): void {
        const index = this.configChangeListeners.indexOf(listener);
        if (index > -1) {
            this.configChangeListeners.splice(index, 1);
        }
    }
    
    /**
     * 清除配置缓存
     */
    clearCache(): void {
        this.configCache = null;
        this.cacheTimestamp = 0;
    }
    
    /**
     * 通知配置变更
     */
    private notifyConfigChange(config: ServiceConfig): void {
        this.configChangeListeners.forEach(listener => {
            try {
                listener(config);
            } catch (error) {
                console.error('配置变更监听器执行失败:', error);
            }
        });
    }
    
    /**
     * 掩码API Key
     */
    private maskApiKey(apiKey: string): string {
        if (apiKey.length <= 8) {
            return '*'.repeat(apiKey.length);
        }
        
        const start = apiKey.substring(0, 4);
        const end = apiKey.substring(apiKey.length - 4);
        const middle = '*'.repeat(apiKey.length - 8);
        
        return `${start}${middle}${end}`;
    }
}

/**
 * 配置验证工具函数
 */
export async function validateCurrentConfig(): Promise<ConfigValidationResult> {
    const configManager = ConfigManager.getInstance();
    return await configManager.validateConfig();
}

/**
 * 获取当前配置
 */
export async function getCurrentConfig(): Promise<ServiceConfig> {
    const configManager = ConfigManager.getInstance();
    return await configManager.getConfig();
}

/**
 * 检查功能可用性
 */
export async function checkFeatureAvailability(): Promise<{
    aiChat: boolean;
    imageGeneration: boolean;
    videoGeneration: boolean;
    bridgeService: boolean;
}> {
    const configManager = ConfigManager.getInstance();
    
    return {
        aiChat: await configManager.isFeatureAvailable('ai-chat'),
        imageGeneration: await configManager.isFeatureAvailable('image-generation'),
        videoGeneration: await configManager.isFeatureAvailable('video-generation'),
        bridgeService: await configManager.isFeatureAvailable('bridge-service')
    };
}