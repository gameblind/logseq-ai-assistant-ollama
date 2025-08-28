# 🚀 快速迁移指南

> **5分钟完成插件配置迁移**

## 📋 迁移原因

项目结构已优化，插件目录从根目录移动到 `packages/logseq-plugin/`，需要重新加载插件。

## ⚡ 快速步骤

### 1️⃣ 备份配置（2分钟）

**方法一：手动记录（推荐）**
```
1. 打开 Logseq → 设置 → 插件
2. 找到 "AI-Assistant-Ollama" → 点击设置图标
3. 截图或记录所有配置项（特别是 API 密钥）
```

**方法二：自动备份脚本**
```
1. 在 Logseq 中按 F12 打开开发者工具
2. 切换到 Console 标签
3. 复制粘贴 scripts/backup-plugin-config.js 内容
4. 按回车执行，配置会自动下载
```

### 2️⃣ 重新加载插件（1分钟）

```
1. Logseq 设置 → 插件 → 移除旧的 "AI-Assistant-Ollama"
2. 点击 "Load unpacked plugin"
3. 选择新目录: packages/logseq-plugin/
4. 确认插件已加载并启用
```

### 3️⃣ 恢复配置（2分钟）

```
1. 点击新插件的设置图标
2. 根据备份信息逐项填入配置
3. 保存设置
4. 测试插件功能
```

## 🔧 关键配置项

**必须配置的项目：**
- ✅ AI Provider (openai/ollama)
- ✅ API Key (OpenAI Key 或 Ollama 地址)
- ✅ API Address
- ✅ Model 选择

**可选配置项目：**
- 🎨 图像生成设置
- 🔊 TTS 语音设置
- 🎬 视频生成设置
- ⚙️ Beta 功能开关

## ❓ 常见问题

**Q: 插件无法加载？**
A: 确保选择 `packages/logseq-plugin/` 目录，不是根目录

**Q: 配置全部丢失？**
A: 这是正常现象，Logseq 插件配置与目录绑定，需要重新配置

**Q: 功能不正常？**
A: 检查 API 密钥是否正确填入，网络连接是否正常

**Q: 找不到新目录？**
A: 确保已执行项目重构，新目录在 `packages/logseq-plugin/`

## 📞 需要帮助？

- 📖 **详细指南**: [PLUGIN_CONFIG_MIGRATION.md](PLUGIN_CONFIG_MIGRATION.md)
- 🛠️ **备份脚本**: [scripts/backup-plugin-config.js](scripts/backup-plugin-config.js)
- 📋 **项目文档**: [README.md](README.md)

---

**💡 提示**: 迁移完成后，插件功能和性能完全不变，只是目录结构更加清晰！