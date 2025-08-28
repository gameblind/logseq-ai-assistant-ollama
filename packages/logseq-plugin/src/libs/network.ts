/**
 * 网络请求工具模块
 * 提供统一的重试机制、超时控制和错误处理
 */

export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    signal?: AbortSignal;
}

export interface RetryableRequestOptions extends RequestOptions {
    retries?: number;
    retryDelay?: number;
    retryCondition?: (error: Error, attempt: number) => boolean;
}

/**
 * 默认重试条件：网络错误、超时错误、5xx服务器错误
 */
function defaultRetryCondition(error: Error, attempt: number): boolean {
    if (attempt >= 3) return false;
    
    // 网络连接错误
    if (error.message.includes('fetch') || 
        error.message.includes('network') || 
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('timeout')) {
        return true;
    }
    
    // HTTP 5xx 服务器错误
    if (error.message.includes('500') || 
        error.message.includes('502') || 
        error.message.includes('503') || 
        error.message.includes('504')) {
        return true;
    }
    
    return false;
}

/**
 * 创建带超时的 fetch 请求
 */
export async function fetchWithTimeout(
    url: string, 
    options: RequestOptions = {}
): Promise<Response> {
    const {
        timeout = 10000,
        signal,
        ...fetchOptions
    } = options;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // 如果传入了外部 signal，也要监听它
    if (signal) {
        signal.addEventListener('abort', () => controller.abort());
    }
    
    try {
        const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        
        throw error;
    }
}

/**
 * 带重试机制的网络请求
 */
export async function fetchWithRetry(
    url: string,
    options: RetryableRequestOptions = {}
): Promise<Response> {
    const {
        retries = 3,
        retryDelay = 1000,
        retryCondition = defaultRetryCondition,
        ...requestOptions
    } = options;
    
    let lastError: Error;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetchWithTimeout(url, requestOptions);
            
            // 检查 HTTP 状态码
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                
                // 4xx 客户端错误通常不需要重试
                if (response.status >= 400 && response.status < 500) {
                    throw error;
                }
                
                // 5xx 服务器错误可以重试
                if (attempt < retries && retryCondition(error, attempt)) {
                    lastError = error;
                    await delay(retryDelay * Math.pow(2, attempt)); // 指数退避
                    continue;
                }
                
                throw error;
            }
            
            return response;
        } catch (error) {
            lastError = error as Error;
            
            // 如果是最后一次尝试，或者不满足重试条件，直接抛出错误
            if (attempt >= retries || !retryCondition(lastError, attempt)) {
                throw lastError;
            }
            
            // 等待后重试
            await delay(retryDelay * Math.pow(2, attempt));
        }
    }
    
    throw lastError!;
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 桥接服务专用请求函数
 */
export async function bridgeServiceRequest(
    endpoint: string,
    bridgeServiceUrl: string,
    options: RetryableRequestOptions = {}
): Promise<any> {
    const url = `${bridgeServiceUrl}${endpoint}`;
    
    const defaultOptions: RetryableRequestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        timeout: 15000,
        retries: 2,
        retryDelay: 1000,
        ...options
    };
    
    try {
        const response = await fetchWithRetry(url, defaultOptions);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Bridge service error (${response.status}): ${errorText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Bridge service request failed: ${endpoint}`, error);
        
        // 提供更友好的错误信息
        if (error instanceof Error) {
            if (error.message.includes('timeout')) {
                throw new Error('桥接服务响应超时，请检查服务状态或网络连接');
            } else if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch')) {
                throw new Error('无法连接到桥接服务，请确认服务已启动并检查配置的服务地址');
            } else if (error.message.includes('404')) {
                throw new Error('桥接服务端点不存在，可能是服务版本不匹配');
            } else if (error.message.includes('500')) {
                throw new Error('桥接服务内部错误，请查看服务日志');
            }
        }
        
        throw error;
    }
}

/**
 * 健康检查函数
 */
export async function checkBridgeServiceHealth(bridgeServiceUrl: string): Promise<boolean> {
    try {
        const response = await fetchWithTimeout(`${bridgeServiceUrl}/api/health`, {
            method: 'GET',
            timeout: 5000
        });
        
        return response.ok;
    } catch (error) {
        console.warn('Bridge service health check failed:', error);
        return false;
    }
}

/**
 * 连接状态管理
 */
export class ConnectionManager {
    private static instance: ConnectionManager;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private isHealthy = false;
    private bridgeServiceUrl = '';
    
    static getInstance(): ConnectionManager {
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager();
        }
        return ConnectionManager.instance;
    }
    
    startHealthCheck(bridgeServiceUrl: string, intervalMs = 30000) {
        this.bridgeServiceUrl = bridgeServiceUrl;
        this.stopHealthCheck();
        
        // 立即检查一次
        this.performHealthCheck();
        
        // 定期健康检查
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, intervalMs);
    }
    
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
    
    private async performHealthCheck() {
        const wasHealthy = this.isHealthy;
        this.isHealthy = await checkBridgeServiceHealth(this.bridgeServiceUrl);
        
        // 状态变化时记录日志
        if (wasHealthy !== this.isHealthy) {
            if (this.isHealthy) {
                console.log('✅ 桥接服务连接已恢复');
            } else {
                console.warn('❌ 桥接服务连接中断');
            }
        }
    }
    
    isServiceHealthy(): boolean {
        return this.isHealthy;
    }
    
    getServiceUrl(): string {
        return this.bridgeServiceUrl;
    }
}