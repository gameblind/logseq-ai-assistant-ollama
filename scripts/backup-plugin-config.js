/**
 * Logseq AI Assistant 插件配置备份脚本
 * 
 * 使用方法：
 * 1. 在 Logseq 中打开开发者工具 (F12 或 Cmd+Option+I)
 * 2. 切换到 Console 标签
 * 3. 复制并粘贴此脚本到控制台
 * 4. 按回车执行
 */

(function() {
    'use strict';
    
    // 配置项映射表
    const configKeys = [
        // AI 提供商配置
        'aiProvider',
        'openaiKey', 
        'openaiAddress',
        'GPTModel',
        'ollamaAddress',
        'ollamaModel',
        
        // 图像生成配置
        'imageApiKey',
        'imageApiAddress', 
        'imageModel',
        'imageEditModel',
        'imageEditQuality',
        'imageEditResponseFormat',
        'imageEditSize',
        'imageEditCount',
        
        // TTS 配置
        'ttsApiKey',
        'ttsApiAddress',
        'ttsModel', 
        'ttsVoice',
        'ttsResponseFormat',
        'ttsSpeed',
        
        // Qwen TTS 配置
        'dashscopeApiKey',
        'qwenTtsModel',
        'qwenTtsVoice',
        'qwenTtsFormat',
        'qwenVideoT2VModel',
        'qwenVideoI2VModel', 
        'qwenVideoResolution',
        'qwenVideoPromptExtend',
        
        // Beta 功能
        'isStreamingOutput',
        'isTextQuery'
    ];
    
    /**
     * 备份插件配置
     */
    function backupConfig() {
        try {
            if (typeof logseq === 'undefined' || !logseq.settings) {
                throw new Error('无法访问 Logseq 设置，请确保在 Logseq 环境中运行此脚本');
            }
            
            const backup = {
                timestamp: new Date().toISOString(),
                pluginId: 'logseq-ai-assistant-ollama',
                version: '1.1.3',
                settings: {}
            };
            
            // 备份所有配置项
            configKeys.forEach(key => {
                if (logseq.settings[key] !== undefined) {
                    backup.settings[key] = logseq.settings[key];
                }
            });
            
            // 保存到 localStorage
            const backupKey = 'ai-assistant-config-backup';
            localStorage.setItem(backupKey, JSON.stringify(backup, null, 2));
            
            console.log('✅ 配置备份成功！');
            console.log('📅 备份时间:', backup.timestamp);
            console.log('📊 备份项目数:', Object.keys(backup.settings).length);
            console.log('💾 存储位置: localStorage["' + backupKey + '"]');
            
            // 显示备份内容（隐藏敏感信息）
            const displaySettings = { ...backup.settings };
            ['openaiKey', 'imageApiKey', 'ttsApiKey', 'dashscopeApiKey'].forEach(key => {
                if (displaySettings[key]) {
                    displaySettings[key] = displaySettings[key].substring(0, 8) + '***';
                }
            });
            
            console.log('📋 备份内容预览:');
            console.table(displaySettings);
            
            // 提供下载选项
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ai-assistant-config-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('💾 配置文件已自动下载');
            
            return backup;
            
        } catch (error) {
            console.error('❌ 备份失败:', error.message);
            return null;
        }
    }
    
    /**
     * 恢复插件配置
     */
    function restoreConfig(backupData) {
        try {
            if (typeof logseq === 'undefined' || !logseq.updateSettings) {
                throw new Error('无法访问 Logseq 设置 API，请确保在 Logseq 环境中运行此脚本');
            }
            
            let backup;
            if (typeof backupData === 'string') {
                backup = JSON.parse(backupData);
            } else if (backupData && typeof backupData === 'object') {
                backup = backupData;
            } else {
                // 尝试从 localStorage 恢复
                const stored = localStorage.getItem('ai-assistant-config-backup');
                if (!stored) {
                    throw new Error('未找到备份数据，请提供备份数据或确保已执行备份');
                }
                backup = JSON.parse(stored);
            }
            
            if (!backup.settings) {
                throw new Error('备份数据格式无效');
            }
            
            console.log('🔄 开始恢复配置...');
            console.log('📅 备份时间:', backup.timestamp);
            
            let restoredCount = 0;
            
            // 逐项恢复配置
            Object.keys(backup.settings).forEach(key => {
                try {
                    logseq.updateSettings({ [key]: backup.settings[key] });
                    restoredCount++;
                    console.log(`✅ ${key}: 已恢复`);
                } catch (error) {
                    console.warn(`⚠️ ${key}: 恢复失败 -`, error.message);
                }
            });
            
            console.log(`🎉 配置恢复完成！成功恢复 ${restoredCount} 项配置`);
            
            // 清理备份数据
            localStorage.removeItem('ai-assistant-config-backup');
            console.log('🧹 临时备份数据已清理');
            
            return true;
            
        } catch (error) {
            console.error('❌ 恢复失败:', error.message);
            return false;
        }
    }
    
    /**
     * 显示帮助信息
     */
    function showHelp() {
        console.log(`
🔧 Logseq AI Assistant 配置管理工具

📋 可用命令:
  • aiBackup.backup()     - 备份当前配置
  • aiBackup.restore()    - 从 localStorage 恢复配置
  • aiBackup.restore(data) - 从指定数据恢复配置
  • aiBackup.help()       - 显示此帮助信息

💡 使用示例:
  1. 备份配置: aiBackup.backup()
  2. 恢复配置: aiBackup.restore()
  3. 手动恢复: aiBackup.restore(yourBackupData)

⚠️ 注意事项:
  • 请在移除旧插件前执行备份
  • 请在安装新插件后执行恢复
  • 敏感信息（API密钥）会被安全处理
`);
    }
    
    // 将函数暴露到全局作用域
    window.aiBackup = {
        backup: backupConfig,
        restore: restoreConfig,
        help: showHelp
    };
    
    // 显示欢迎信息
    console.log('🚀 AI Assistant 配置管理工具已加载');
    console.log('💡 输入 aiBackup.help() 查看使用说明');
    
})();

// 自动显示帮助信息
if (typeof window !== 'undefined' && window.aiBackup) {
    window.aiBackup.help();
}