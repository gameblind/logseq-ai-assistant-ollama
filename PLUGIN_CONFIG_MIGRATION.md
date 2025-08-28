# Logseq AI Assistant 插件配置备份与迁移指南

## 📋 概述

由于项目结构重构，插件目录从根目录移动到了 `packages/logseq-plugin/`，您需要重新加载插件。本指南将帮助您备份现有配置并迁移到新版本。

## 🔍 Logseq 插件配置存储机制

Logseq 插件的配置通过以下方式存储：

### 1. 插件设置存储位置
- **存储方式**: Logseq 使用 `logseq.settings` API 存储插件配置
- **存储位置**: 配置保存在 Logseq 的本地数据库中，与特定图谱关联
- **配置范围**: 每个图谱都有独立的插件配置

### 2. 配置项列表

当前插件包含以下配置项：

#### AI 提供商配置
- `aiProvider`: AI 提供商 (openai/ollama)
- `openaiKey`: OpenAI API 密钥
- `openaiAddress`: OpenAI API 地址
- `GPTModel`: ChatGPT 模型
- `ollamaAddress`: Ollama 服务器地址
- `ollamaModel`: Ollama 模型

#### 图像生成配置
- `imageApiKey`: 图像 API 密钥
- `imageApiAddress`: 图像 API 地址
- `imageModel`: 图像生成模型
- `imageEditModel`: 图像编辑模型
- `imageEditQuality`: 图像编辑质量
- `imageEditResponseFormat`: 图像编辑响应格式
- `imageEditSize`: 图像编辑尺寸
- `imageEditCount`: 图像编辑数量

#### TTS 配置
- `ttsApiKey`: TTS API 密钥
- `ttsApiAddress`: TTS API 地址
- `ttsModel`: TTS 模型
- `ttsVoice`: TTS 语音
- `ttsResponseFormat`: TTS 音频格式
- `ttsSpeed`: TTS 语速

#### Qwen TTS 配置
- `dashscopeApiKey`: DashScope API 密钥
- `qwenTtsModel`: Qwen TTS 模型
- `qwenTtsVoice`: Qwen TTS 语音
- `qwenTtsFormat`: Qwen TTS 音频格式
- `qwenVideoT2VModel`: Qwen 文生视频模型
- `qwenVideoI2VModel`: Qwen 图生视频模型
- `qwenVideoResolution`: Qwen 视频分辨率
- `qwenVideoPromptExtend`: 提示词扩展

#### Beta 功能
- `isStreamingOutput`: 流式输出
- `isTextQuery`: 文本查询

## 📤 配置备份方法

### 方法一：手动记录配置（推荐）

1. **打开 Logseq 设置**
   - 点击右上角设置图标
   - 选择 "插件" 标签
   - 找到 "AI-Assistant-Ollama" 插件
   - 点击插件设置图标

2. **记录当前配置**
   ```
   AI Provider: [记录当前选择]
   OpenAI API Key: [记录您的密钥]
   OpenAI Address: [记录API地址]
   ChatGPT Model: [记录模型选择]
   Ollama Address: [记录地址]
   Ollama Model: [记录模型]
   
   [记录其他所有自定义配置...]
   ```

3. **截图备份**
   - 对插件设置页面进行截图
   - 确保所有配置项都清晰可见

### 方法二：导出配置文件

1. **找到 Logseq 数据目录**
   - macOS: `~/Library/Application Support/Logseq/`
   - Windows: `%APPDATA%\Logseq\`
   - Linux: `~/.config/Logseq/`

2. **备份插件配置**
   ```bash
   # 备份整个 Logseq 配置目录
   cp -r "~/Library/Application Support/Logseq" ~/logseq-backup-$(date +%Y%m%d)
   ```

### 方法三：使用浏览器开发者工具

1. **打开开发者工具**
   - 在 Logseq 中按 `F12` 或 `Cmd+Option+I`
   - 切换到 "Console" 标签

2. **导出插件配置**
   ```javascript
   // 获取当前插件配置
   console.log('AI Assistant Plugin Settings:', logseq.settings);
   
   // 导出为 JSON
   JSON.stringify(logseq.settings, null, 2);
   ```

3. **保存配置**
   - 复制输出的 JSON 内容
   - 保存到文本文件中

## 📥 配置迁移步骤

### 1. 移除旧插件

1. **在 Logseq 中移除旧插件**
   - 进入 Logseq 设置 → 插件
   - 找到 "AI-Assistant-Ollama" 插件
   - 点击 "移除" 或 "禁用"

### 2. 安装新插件

1. **选择新的插件目录**
   - 点击 "Load unpacked plugin"
   - 选择目录：`packages/logseq-plugin/`
   - 或选择构建后的目录：`packages/logseq-plugin/dist/`

2. **确认插件加载**
   - 检查插件是否出现在插件列表中
   - 确认插件状态为 "已启用"

### 3. 恢复配置

1. **打开新插件设置**
   - 找到新加载的 "AI-Assistant-Ollama" 插件
   - 点击设置图标

2. **逐项恢复配置**
   - 根据备份的配置信息
   - 逐一填入各项设置
   - 特别注意 API 密钥等敏感信息

3. **测试配置**
   - 保存设置后测试插件功能
   - 确认 AI 服务连接正常
   - 验证各项功能是否工作正常

## ⚠️ 注意事项

### 配置兼容性
- ✅ **完全兼容**: 所有配置项保持不变
- ✅ **无需修改**: 配置格式和选项完全一致
- ✅ **功能保持**: 所有功能和特性保持不变

### 常见问题

1. **插件无法加载**
   - 确认选择的是正确的目录 (`packages/logseq-plugin/`)
   - 检查目录中是否包含 `package.json` 文件
   - 尝试选择 `dist/` 目录

2. **配置丢失**
   - Logseq 的插件配置与插件目录绑定
   - 更换目录后需要重新配置
   - 这是 Logseq 的正常行为

3. **功能异常**
   - 检查 API 密钥是否正确填入
   - 验证网络连接和服务地址
   - 查看浏览器控制台是否有错误信息

## 🔄 自动化迁移脚本（高级用户）

如果您熟悉 JavaScript，可以使用以下脚本快速迁移配置：

```javascript
// 在旧插件移除前，在控制台运行此脚本备份配置
const backupConfig = {
  timestamp: new Date().toISOString(),
  settings: { ...logseq.settings }
};
localStorage.setItem('ai-assistant-backup', JSON.stringify(backupConfig));
console.log('配置已备份到 localStorage');

// 在新插件加载后，运行此脚本恢复配置
const backup = JSON.parse(localStorage.getItem('ai-assistant-backup'));
if (backup && backup.settings) {
  Object.keys(backup.settings).forEach(key => {
    logseq.updateSettings({ [key]: backup.settings[key] });
  });
  console.log('配置已恢复');
  localStorage.removeItem('ai-assistant-backup');
}
```

## 📞 技术支持

如果在迁移过程中遇到问题：

1. **检查项目文档**: [README.md](README.md)
2. **查看架构说明**: [docs/MCP_ARCHITECTURE.md](docs/MCP_ARCHITECTURE.md)
3. **提交 Issue**: 在项目仓库中创建问题报告

---

**重要提醒**: 配置迁移是一次性操作，完成后您就可以正常使用重构后的插件了。新的项目结构提供了更好的开发体验和更清晰的代码组织。