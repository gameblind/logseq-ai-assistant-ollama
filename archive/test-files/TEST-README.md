# 图片编辑API测试工具

为了帮助调试图片编辑功能，我创建了两个独立的测试工具。您可以使用这些工具来验证API配置和调用是否正常工作。

## 🌐 Web版测试工具 (test-image-edit.html)

### 使用方法
1. 在浏览器中打开 `test-image-edit.html` 文件
2. 填写以下配置信息：
   - **API地址**: 您的图片编辑API端点 (例如: `https://api.example.com/v1/images/edits`)
   - **API Key**: 您的API密钥
   - **模型**: 选择 `gpt-image-1` 或 `qwen-image-edit`
   - **选择图片**: 上传要编辑的图片文件
   - **选择遮罩**: 上传遮罩图片文件（可选，PNG格式，透明区域表示要编辑的部分）
   - **编辑提示词**: 描述您想要的编辑效果
3. 点击 "🚀 测试图片编辑" 按钮
4. 查看测试结果和编辑后的图片

### 特点
- ✅ 可视化界面，易于使用
- ✅ 实时显示请求和响应过程
- ✅ 支持图片预览和下载
- ✅ 详细的错误信息显示

## 🖥️ Node.js版测试工具 (test-image-edit.js)

### 安装依赖
```bash
npm install form-data node-fetch
```

### 配置
编辑 `test-image-edit.js` 文件顶部的 `CONFIG` 对象：

```javascript
const CONFIG = {
    apiUrl: 'https://your-api-endpoint.com/v1/images/edits', // 您的API地址
    apiKey: 'your-api-key-here', // 您的API Key
    model: 'gpt-image-1', // 或 'qwen-image-edit'
    imagePath: './test-image.jpg', // 测试图片的路径
    prompt: '将背景改为蓝天白云' // 编辑提示词
};
```

### 使用方法
1. 编辑 `test-image-edit.js` 文件中的 CONFIG 对象：
   ```javascript
   const CONFIG = {
       apiUrl: 'https://ai.comfly.chat/v1/images/edits',
       apiKey: 'your-api-key-here',
       model: 'gpt-image-1',
       imagePath: './test-image.jpg', // 图片文件路径
       maskPath: './mask.png', // 遮罩文件路径 (可选)
       prompt: '给这张图片添加一些彩虹色彩',
       quality: 'auto',
       responseFormat: 'url',
       size: 'auto',
       n: 1
   };
   ```

2. 运行测试脚本：
   ```bash
   node test-image-edit.js
   ```

### 特点
- ✅ 命令行界面，适合自动化测试
- ✅ 详细的日志输出
- ✅ 自动保存编辑后的图片
- ✅ 完整的错误处理和依赖检查

## 🔧 测试步骤建议

### 根据您提供的API文档，现在已预填正确的API地址：
- **API地址**: `https://ai.comfly.chat/v1/images/edits`
- **支持模型**: `gpt-image-1`、`dall-e-2`
- **支持格式**: PNG、WEBP、JPG（每个文件 <25MB）
- **新增参数支持**:
  - **mask**: 遮罩图片文件（可选，PNG格式，透明区域表示要编辑的部分）
  - **quality**: 质量设置（仅gpt-image-1）- auto/high/medium/low
  - **response_format**: 响应格式 - url/b64_json
  - **size**: 图片尺寸 - auto/1024x1024/1536x1024/1024x1536等
  - **n**: 生成数量 (1-10)

### 关于遮罩(Mask)参数的重要说明

- **格式要求**: 必须是PNG格式的图片文件
- **尺寸要求**: 遮罩图片的尺寸必须与原图完全相同
- **透明度设置**: 完全透明的像素（alpha值为0）表示要编辑的区域
- **使用场景**: 精确控制图片编辑的区域，例如只修改背景或特定物体
- **可选参数**: 如果不提供遮罩，API会根据提示词自动判断编辑区域

### 测试步骤：

1. **首先使用Web版测试工具**
   - API地址已预填为 `https://ai.comfly.chat/v1/images/edits`
   - API Key已预填为测试token
   - 选择模型（推荐 `gpt-image-1`）
   - 配置参数（可选）：
     - 质量设置（仅gpt-image-1有效）
     - 响应格式（url或b64_json）
     - 图片尺寸（auto或具体尺寸）
     - 生成数量（1-10张）
   - 上传测试图片
   - 输入编辑提示词（如："带上眼镜"）
   - 点击测试按钮

2. **然后使用Node.js版测试工具**
   - API地址已预填为 `https://ai.comfly.chat/v1/images/edits`
   - API Key已预填为测试token
   - 配置参数：图片路径、提示词、质量、响应格式、尺寸、数量等
   - 运行：`node test-image-edit.js`

3. **常见问题排查**
   - 验证API Key是否有效（从您的API服务提供商获取）
   - 确认图片格式支持（PNG、JPG、WEBP，<25MB）
   - 检查网络连接
   - 确认账户余额充足

## 📝 测试结果分析

### 成功的响应应该包含：
```json
{
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

### 常见错误类型：
- **401 Unauthorized**: API Key无效或过期
- **403 Forbidden**: 权限不足或账户余额不足
- **400 Bad Request**: 请求参数错误
- **500 Internal Server Error**: API服务器内部错误

## 🚀 使用这些工具的优势

1. **独立测试**: 与Logseq插件环境隔离，排除插件相关问题
2. **详细日志**: 完整的请求/响应信息，便于调试
3. **快速验证**: 无需重新构建插件即可测试API配置
4. **多种格式**: Web和命令行两种方式，适应不同使用场景

请使用这些工具测试您的API配置，并将测试结果反馈给我，这样我们就能更准确地定位和解决问题！