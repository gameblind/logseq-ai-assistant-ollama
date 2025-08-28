import '@logseq/libs';
import { settingsSchema } from '@/libs';
import { getSettings } from './libs/settings';
import { ConnectionManager } from './libs/network';
import { ConfigManager } from './libs/config-manager';
import { slash } from './slash';
import { select } from './select/select';

async function main () {
    await logseq.useSettingsSchema(await settingsSchema());
    
    // 初始化配置管理器和连接管理器
    try {
        // 初始化配置管理器
        const configManager = new ConfigManager();
        const config = await configManager.getConfig();
        
        // 验证配置
         const validationResult = await configManager.validateConfig(config);
         if (validationResult.warnings.length > 0) {
             console.warn('配置警告:', validationResult.warnings);
             logseq.UI.showMsg('配置存在问题，请检查设置', 'warning');
         }
         if (validationResult.errors.length > 0) {
             console.error('配置错误:', validationResult.errors);
             logseq.UI.showMsg('配置错误，请检查设置', 'error');
         }
         
         // 初始化连接管理器
         if (config.bridgeServiceUrl) {
             const connectionManager = ConnectionManager.getInstance();
             connectionManager.startHealthCheck(config.bridgeServiceUrl);
             console.log('🔗 桥接服务连接管理器已启动');
             
             // 检查功能可用性
             const aiChatAvailable = await configManager.isFeatureAvailable('ai-chat');
             const imageGenAvailable = await configManager.isFeatureAvailable('image-generation');
             const videoGenAvailable = await configManager.isFeatureAvailable('video-generation');
             const bridgeAvailable = await configManager.isFeatureAvailable('bridge-service');
             
             console.log('可用功能:', {
                 'AI对话': aiChatAvailable,
                 '图像生成': imageGenAvailable,
                 '视频生成': videoGenAvailable,
                 '桥接服务': bridgeAvailable
             });
         }
    } catch (error) {
         console.error('插件初始化失败:', error);
         const errorMessage = error instanceof Error ? error.message : '未知错误';
         logseq.UI.showMsg(`插件初始化失败: ${errorMessage}`, 'error');
     }
    
    await slash();
    await select();
}

// bootstrap
logseq.ready(main).catch(console.error);