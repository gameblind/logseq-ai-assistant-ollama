import { ConfigManager } from '../config/manager';
import { logger } from '../utils/logger';
import { loggingService } from './logging-service';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// AI能力类型定义
export type AICapabilityType = 'text-to-image' | 'image-to-image' | 'edit-image' | 'text-to-speech' | 'text-to-video' | 'image-to-video';

// 任务状态
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

// 基础任务接口
export interface BaseTask {
  id: string;
  type: AICapabilityType;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  result?: any;
}

// 文生图任务
export interface TextToImageTask extends BaseTask {
  type: 'text-to-image';
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  outputPath?: string;
}

// 图生图任务
export interface ImageToImageTask extends BaseTask {
  type: 'image-to-image';
  prompt: string;
  inputImage: string; // base64 或 URL
  strength?: number;
  model?: string;
  outputPath?: string;
}

// 编辑图像任务
export interface EditImageTask extends BaseTask {
  type: 'edit-image';
  prompt: string;
  inputImage: string;
  maskImage?: string;
  model?: string;
  outputPath?: string;
}

// TTS任务
export interface TextToSpeechTask extends BaseTask {
  type: 'text-to-speech';
  text: string;
  voice?: string;
  model?: string;
  speed?: number;
  format?: string;
  outputPath?: string;
}

// 文生视频任务
export interface TextToVideoTask extends BaseTask {
  type: 'text-to-video';
  prompt: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  model?: string;
  outputPath?: string;
}

// 图生视频任务
export interface ImageToVideoTask extends BaseTask {
  type: 'image-to-video';
  prompt?: string;
  inputImage: string;
  duration?: number;
  fps?: number;
  model?: string;
  outputPath?: string;
}

export type AITask = TextToImageTask | ImageToImageTask | EditImageTask | TextToSpeechTask | TextToVideoTask | ImageToVideoTask;

// AI能力服务
export class AICapabilitiesService {
  private tasks = new Map<string, AITask>();
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  // 生成任务ID
  private generateTaskId(type: AICapabilityType): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${type.replace(/-/g, '_')}_${timestamp}_${random}`;
  }

  // 创建文生图任务
  async createTextToImageTask(params: {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    style?: string;
    outputPath?: string;
  }): Promise<string> {
    const taskId = this.generateTaskId('text-to-image');
    const task: TextToImageTask = {
      id: taskId,
      type: 'text-to-image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...params
    };

    this.tasks.set(taskId, task);
    logger.info(`Created text-to-image task: ${taskId}`);

    // 异步处理任务
    this.processTextToImageTask(taskId).catch(error => {
      logger.error(`Error processing text-to-image task ${taskId}:`, error);
      this.updateTaskStatus(taskId, 'failed', error.message);
    });

    return taskId;
  }

  // 创建图生图任务
  async createImageToImageTask(params: {
    prompt: string;
    inputImage: string;
    strength?: number;
    model?: string;
    outputPath?: string;
  }): Promise<string> {
    const taskId = this.generateTaskId('image-to-image');
    const task: ImageToImageTask = {
      id: taskId,
      type: 'image-to-image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...params
    };

    this.tasks.set(taskId, task);
    logger.info(`Created image-to-image task: ${taskId}`);

    // 异步处理任务
    this.processImageToImageTask(taskId).catch(error => {
      logger.error(`Error processing image-to-image task ${taskId}:`, error);
      this.updateTaskStatus(taskId, 'failed', error.message);
    });

    return taskId;
  }

  // 创建编辑图像任务
  async createEditImageTask(params: {
    prompt: string;
    inputImage: string;
    maskImage?: string;
    model?: string;
    outputPath?: string;
  }): Promise<string> {
    const taskId = this.generateTaskId('edit-image');
    const task: EditImageTask = {
      id: taskId,
      type: 'edit-image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...params
    };

    this.tasks.set(taskId, task);
    logger.info(`Created edit-image task: ${taskId}`);

    // 异步处理任务
    this.processEditImageTask(taskId).catch(error => {
      logger.error(`Error processing edit-image task ${taskId}:`, error);
      this.updateTaskStatus(taskId, 'failed', error.message);
    });

    return taskId;
  }

  // 创建TTS任务
  async createTextToSpeechTask(params: {
    text: string;
    voice?: string;
    model?: string;
    speed?: number;
    format?: string;
    outputPath?: string;
  }): Promise<string> {
    const taskId = this.generateTaskId('text-to-speech');
    const task: TextToSpeechTask = {
      id: taskId,
      type: 'text-to-speech',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...params
    };

    this.tasks.set(taskId, task);
    logger.info(`Created text-to-speech task: ${taskId}`);

    // 异步处理任务
    this.processTextToSpeechTask(taskId).catch(error => {
      logger.error(`Error processing text-to-speech task ${taskId}:`, error);
      this.updateTaskStatus(taskId, 'failed', error.message);
    });

    return taskId;
  }

  // 创建文生视频任务
  async createTextToVideoTask(params: {
    prompt: string;
    duration?: number;
    fps?: number;
    resolution?: string;
    model?: string;
    outputPath?: string;
  }): Promise<string> {
    const taskId = this.generateTaskId('text-to-video');
    const task: TextToVideoTask = {
      id: taskId,
      type: 'text-to-video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...params
    };

    this.tasks.set(taskId, task);
    logger.info(`Created text-to-video task: ${taskId}`);

    // 异步处理任务
    this.processTextToVideoTask(taskId).catch(error => {
      logger.error(`Error processing text-to-video task ${taskId}:`, error);
      this.updateTaskStatus(taskId, 'failed', error.message);
    });

    return taskId;
  }

  // 创建图生视频任务
  async createImageToVideoTask(params: {
    prompt?: string;
    inputImage: string;
    duration?: number;
    fps?: number;
    model?: string;
    outputPath?: string;
  }): Promise<string> {
    const taskId = this.generateTaskId('image-to-video');
    const task: ImageToVideoTask = {
      id: taskId,
      type: 'image-to-video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...params
    };

    this.tasks.set(taskId, task);
    logger.info(`Created image-to-video task: ${taskId}`);

    // 异步处理任务
    this.processImageToVideoTask(taskId).catch(error => {
      logger.error(`Error processing image-to-video task ${taskId}:`, error);
      this.updateTaskStatus(taskId, 'failed', error.message);
    });

    return taskId;
  }

  // 获取任务状态
  getTask(taskId: string): AITask | undefined {
    return this.tasks.get(taskId);
  }

  // 获取所有任务
  getAllTasks(): AITask[] {
    return Array.from(this.tasks.values());
  }

  // 获取指定类型的任务
  getTasksByType(type: AICapabilityType): AITask[] {
    return Array.from(this.tasks.values()).filter(task => task.type === type);
  }

  // 更新任务状态
  private updateTaskStatus(taskId: string, status: TaskStatus, error?: string, result?: any): void {
    const task = this.tasks.get(taskId);
    if (task) {
      const oldStatus = task.status;
      task.status = status;
      task.updatedAt = Date.now();
      if (error) task.error = error;
      if (result) task.result = result;
      this.tasks.set(taskId, task);
      
      // 记录任务状态变更日志
      loggingService.logTaskStatusChange({
        taskId,
        taskType: task.type,
        oldStatus,
        newStatus: status,
        details: result ? { result } : undefined,
        error
      });
    }
  }

  // 处理文生图任务
  private async processTextToImageTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as TextToImageTask;
    if (!task) return;

    try {
      this.updateTaskStatus(taskId, 'processing');
      
      const apiConfig = this.configManager.getApiConfig();
      const response = await fetch(apiConfig.imageApiAddress, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.imageApiKey}`
        },
        body: JSON.stringify({
          model: task.model || apiConfig.imageModel || 'dall-e-3',
          prompt: task.prompt,
          size: task.size || '1024x1024',
          quality: task.quality || 'standard',
          response_format: 'b64_json',
          n: 1
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      const imageData = data.data[0].b64_json;
      
      // 保存图片
      let outputPath = task.outputPath;
      if (outputPath && imageData) {
        const buffer = Buffer.from(imageData, 'base64');
        await fs.promises.writeFile(outputPath, buffer);
        logger.info(`Text-to-image task completed: ${taskId}, saved to: ${outputPath}`);
      }

      this.updateTaskStatus(taskId, 'completed', undefined, {
        imageData,
        outputPath
      });
    } catch (error) {
      logger.error(`Text-to-image task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理图生图任务
  private async processImageToImageTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as ImageToImageTask;
    if (!task) return;

    try {
      this.updateTaskStatus(taskId, 'processing');
      
      // 这里需要根据具体的API实现图生图功能
      // 目前作为占位符实现
      logger.info(`Processing image-to-image task: ${taskId}`);
      
      // 模拟处理时间
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      this.updateTaskStatus(taskId, 'completed', undefined, {
        message: 'Image-to-image processing completed (placeholder)'
      });
    } catch (error) {
      logger.error(`Image-to-image task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理编辑图像任务
  private async processEditImageTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as EditImageTask;
    if (!task) return;

    try {
      this.updateTaskStatus(taskId, 'processing');
      
      const apiConfig = this.configManager.getApiConfig();
      
      // 构建表单数据
      const formData = new FormData();
      formData.append('prompt', task.prompt);
      formData.append('model', task.model || apiConfig.imageEditModel || 'dall-e-2');
      formData.append('size', '1024x1024');
      formData.append('response_format', 'b64_json');
      
      // 添加图片数据
      if (task.inputImage.startsWith('data:')) {
        // Base64 数据
        const base64Data = task.inputImage.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        formData.append('image', new Blob([buffer]), 'image.png');
      }
      
      if (task.maskImage) {
        const maskBase64Data = task.maskImage.split(',')[1];
        const maskBuffer = Buffer.from(maskBase64Data, 'base64');
        formData.append('mask', new Blob([maskBuffer]), 'mask.png');
      }

      const response = await fetch(`${apiConfig.imageApiAddress}/edits`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiConfig.imageApiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      const imageData = data.data[0].b64_json;
      
      // 保存图片
      let outputPath = task.outputPath;
      if (outputPath && imageData) {
        const buffer = Buffer.from(imageData, 'base64');
        await fs.promises.writeFile(outputPath, buffer);
        logger.info(`Edit-image task completed: ${taskId}, saved to: ${outputPath}`);
      }

      this.updateTaskStatus(taskId, 'completed', undefined, {
        imageData,
        outputPath
      });
    } catch (error) {
      logger.error(`Edit-image task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理TTS任务
  private async processTextToSpeechTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as TextToSpeechTask;
    if (!task) return;

    try {
      this.updateTaskStatus(taskId, 'processing');
      
      const apiConfig = this.configManager.getApiConfig();
      
      // 检查是否使用阿里云TTS
      if (apiConfig.dashscopeApiKey) {
        await this.processQwenTTSTask(taskId);
        return;
      }
      
      // 使用OpenAI兼容的TTS API
      const response = await fetch(apiConfig.ttsApiAddress, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.ttsApiKey}`
        },
        body: JSON.stringify({
          model: task.model || apiConfig.ttsModel || 'tts-1',
          input: task.text,
          voice: task.voice || apiConfig.ttsVoice || 'alloy',
          response_format: task.format || apiConfig.ttsResponseFormat || 'mp3',
          speed: task.speed || parseFloat(apiConfig.ttsSpeed) || 1.0
        })
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      
      // 保存音频文件
      let outputPath = task.outputPath;
      if (outputPath) {
        await fs.promises.writeFile(outputPath, Buffer.from(audioBuffer));
        logger.info(`TTS task completed: ${taskId}, saved to: ${outputPath}`);
      }

      this.updateTaskStatus(taskId, 'completed', undefined, {
        audioData: Buffer.from(audioBuffer).toString('base64'),
        outputPath
      });
    } catch (error) {
      logger.error(`TTS task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理阿里云TTS任务
  private async processQwenTTSTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as TextToSpeechTask;
    if (!task) return;

    try {
      const apiConfig = this.configManager.getApiConfig();
      
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/synthesize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.dashscopeApiKey}`
        },
        body: JSON.stringify({
          model: task.model || apiConfig.qwenTtsModel || 'cosyvoice-v1',
          input: {
            text: task.text
          },
          parameters: {
            voice: task.voice || apiConfig.qwenTtsVoice || 'longwan',
            format: task.format || apiConfig.qwenTtsFormat || 'mp3'
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Qwen TTS API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      
      if (data.output?.audio_url) {
        // 下载音频文件
        const audioResponse = await fetch(data.output.audio_url);
        const audioBuffer = await audioResponse.arrayBuffer();
        
        // 保存音频文件
        let outputPath = task.outputPath;
        if (outputPath) {
          await fs.promises.writeFile(outputPath, Buffer.from(audioBuffer));
          logger.info(`Qwen TTS task completed: ${taskId}, saved to: ${outputPath}`);
        }

        this.updateTaskStatus(taskId, 'completed', undefined, {
          audioData: Buffer.from(audioBuffer).toString('base64'),
          outputPath,
          audioUrl: data.output.audio_url
        });
      } else {
        throw new Error('No audio URL in response');
      }
    } catch (error) {
      logger.error(`Qwen TTS task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理文生视频任务（占位符实现）
  private async processTextToVideoTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as TextToVideoTask;
    if (!task) return;

    try {
      this.updateTaskStatus(taskId, 'processing');
      
      logger.info(`Processing text-to-video task: ${taskId}`);
      logger.warn('Text-to-video functionality is not yet implemented');
      
      // 模拟处理时间
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      this.updateTaskStatus(taskId, 'failed', 'Text-to-video functionality is not yet implemented');
    } catch (error) {
      logger.error(`Text-to-video task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理图生视频任务（占位符实现）
  private async processImageToVideoTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId) as ImageToVideoTask;
    if (!task) return;

    try {
      this.updateTaskStatus(taskId, 'processing');
      
      logger.info(`Processing image-to-video task: ${taskId}`);
      logger.warn('Image-to-video functionality is not yet implemented');
      
      // 模拟处理时间
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      this.updateTaskStatus(taskId, 'failed', 'Image-to-video functionality is not yet implemented');
    } catch (error) {
      logger.error(`Image-to-video task failed: ${taskId}`, error);
      this.updateTaskStatus(taskId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 清理过期任务（可选）
  cleanupExpiredTasks(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [taskId, task] of this.tasks.entries()) {
      if (now - task.createdAt > maxAge) {
        this.tasks.delete(taskId);
        logger.info(`Cleaned up expired task: ${taskId}`);
      }
    }
  }
}