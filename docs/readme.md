<h1 align="center">Logseq AI Assistant with Ollama Support 🤖</h1>

> A powerful AI assistant plugin for Logseq with comprehensive text generation, image generation, and OCR capabilities. Supports both OpenAI and Ollama backends.

![](assets/ai-assistant.gif)

[![Release](https://github.com/UNICKCHENG/logseq-ai-assistant/actions/workflows/main.yml/badge.svg)](https://github.com/UNICKCHENG/logseq-ai-assistant/actions/workflows/main.yml)
[![download](https://img.shields.io/github/downloads/UNICKCHENG/logseq-ai-assistant/total?color=%230095FF)](https://github.com/UNICKCHENG/logseq-ai-assistant/releases)
[![release](https://img.shields.io/github/v/release/UNICKCHENG/logseq-ai-assistant)](https://github.com/UNICKCHENG/logseq-ai-assistant/releases)
[![logseq](https://img.shields.io/github/v/release/logseq/logseq?label=logseq)](https://github.com/logseq/logseq/releases)


## 🎉Usage

### Installing Plugins

![](assets/ai-assistant-plugin-marketplace.png)

### Setting up API

#### OpenAI Configuration
- `openaiKey`：your openai key, which can be found on [openai.com](https://platform.openai.com/account/api-keys).
- `openaiUrl`：You can also use your own proxy address, which defaults to the official address `https://api.openai.com`.

#### Image Generation Configuration
- `imageApiKey`：API key for image generation (can be the same as OpenAI key)
- `imageApiAddress`：API endpoint for image generation
- `imageModel`：Model to use for image generation (e.g., dall-e-3)

#### 🔒 Security Notice
**Important**: Never share your API keys publicly or commit them to version control. Store them securely and rotate them regularly. These keys provide access to paid services and should be treated as sensitive credentials.

![](assets/ai-assistant-plugin-settings.png)

### Usage

#### Text Generation
- `/gpt` Use OpenAI GPT API for text generation and conversation
- `/gpt-stream` Use streaming mode for real-time text generation
- `/gpt-page` Generate content based on current page context
- `/gpt-graph` Generate responses using knowledge graph and backlinks

#### Image Generation
- `/gpt-image` Generate images from text prompts (with 1000 character limit and auto-truncation)
- `/auto_generate_image` Automatically generate images based on current context
- Support for both text-to-image and image-to-image generation
- Automatic image download and local storage
- Support for local images in assets directory
- Intelligent fallback from image-to-image to text-to-image when needed
- Smart prompt length management with automatic truncation for optimal results

#### OCR (Optical Character Recognition)
- `/gpt-ocr` Extract text from images using OCR
- Support for multiple image formats
- Works with both local and network images

#### Video Generation (New! 🎬)
- `/gpt-t2v` Generate videos from text descriptions (Text-to-Video)
- `/gpt-i2v` Generate videos from images (Image-to-Video)
- Support for both local and network images as input
- Automatic video download and storage in assets directory
- Intelligent task status polling with optimized intervals
- Smart image path handling (local files converted to Base64)

## ✨ Features

### 🖼️ Advanced Image Generation
- **Text-to-Image**: Generate images from text descriptions
- **Image-to-Image**: Transform existing images based on new prompts
- **Image Editing**: Edit existing images using the `gpt-image-1` model (generates actual edited images)
- **Local Image Support**: Process images from your assets directory
- **Smart Fallback**: Automatically falls back to text-to-image when image-to-image fails
- **Error Recovery**: Preserves original content when generation fails

### 🧠 Intelligent Text Processing
- **Context-Aware Generation**: Uses page context and backlinks for better responses
- **Streaming Support**: Real-time text generation with streaming API
- **Graph-Based Responses**: Leverages Logseq's knowledge graph for enhanced answers

### 🔧 Robust Error Handling
- **Graceful Degradation**: Maintains functionality even when primary methods fail
- **Content Preservation**: Never loses original content during processing
- **Detailed Error Messages**: Clear feedback when operations fail

### 🎬 Advanced Video Generation
- **Text-to-Video (T2V)**: Generate videos from text descriptions using Qwen's video generation API
- **Image-to-Video (I2V)**: Transform static images into dynamic videos
- **Smart Image Processing**: Automatic conversion of local images to Base64 format
- **Intelligent Polling**: Optimized task status checking (4s intervals for first minute, 15s thereafter)
- **Automatic Storage**: Videos are automatically downloaded and saved to Logseq assets directory
- **Progress Tracking**: Real-time status updates during video generation process

### 🎯 Recent Improvements

#### v1.2.0 - Video Generation Support 🎬
- ✅ Added Text-to-Video (T2V) functionality with `/gpt-t2v` command
- ✅ Added Image-to-Video (I2V) functionality with `/gpt-i2v` command
- ✅ Implemented MCP bridge service for Qwen video generation API
- ✅ Smart image path handling with automatic Base64 conversion for local files
- ✅ Intelligent task status polling with optimized intervals (4s → 15s)
- ✅ Automatic video download and storage in Logseq assets directory
- ✅ Real-time progress tracking and status updates
- ✅ Fixed prompt display issues by switching from updateBlock to insertBlock
- ✅ Comprehensive error handling and user feedback
- ✅ Support for both local and network images in I2V mode

#### v1.1.3 - Image Editing Enhancements
- ✅ Added image editing functionality with /gpt-imgedit command
- ✅ Migrated to gpt-image-1 model for advanced image editing (generates actual edited images)
- ✅ Updated Image Edit API: Migrated from chat completion to multipart/form-data format for gpt-image-1 compatibility
- ✅ Fixed image generation prompt validation
- ✅ Enhanced image-to-image functionality for local images
- ✅ Improved error handling and user feedback
- ✅ Optimized image output format and alt text handling
- ✅ Removed unnecessary URL displays in outputs
- ✅ Fixed nested alt text extraction issues
- ✅ Added proper file extensions for generated images
- ✅ Fixed critical bug where original images were deleted on failure

## 📖 Usage Examples

### Text Generation
```
/gpt What is the meaning of life?
/gpt-stream Explain quantum physics in simple terms
/gpt-page Summarize this page content
/gpt-graph What are the connections between these concepts?
```

### Image Generation
```
/gpt-image A beautiful sunset over mountains
/gpt-image ![existing-image.jpg](assets/photo.jpg) Make this image more colorful
```

### Image Editing
```
/gpt-imgedit ![photo.jpg](assets/photo.jpg) Change the sky to a starry night
/gpt-imgedit ![landscape.png](assets/landscape.png) Add a rainbow in the background
/gpt-imgedit ![portrait.jpg](assets/portrait.jpg) Make the person smile
```

**Note**: The image editing feature generates actual edited images based on your prompts and saves them to your assets directory.

### OCR Text Extraction
```
/gpt-ocr ![document.png](assets/document.png)
```

### Video Generation
```
# Text-to-Video: Generate video from text description
/gpt-t2v A cat playing with a ball in a sunny garden

# Image-to-Video: Generate video from existing image
/gpt-i2v ![photo.jpg](assets/photo.jpg) Make this image come alive with gentle movement

# Advanced I2V with detailed prompt
/gpt-i2v ![landscape.png](assets/landscape.png) Add flowing water and swaying trees to create a peaceful nature scene
```

**Note**: 
- Video generation may take 1-4 minutes depending on complexity
- Generated videos are automatically saved to your assets directory
- Both local images (from assets) and network images are supported for I2V
- The system will show progress updates during generation

## 🚀 Local development

**step 1 > Verify the local environment**

```bash
node -v
npm -v
git -v
```

**step 2 > Install dependencies**

```bash
# > step 1 download source code
git clone https://github.com/UNICKCHENG/logseq-ai-assistant.git
cd logseq-ai-assistant
# > step 2 installing dependencies
npm install
```

**step 4 > Build plugin**

```bash
npm run build
```


## ✍️Changelog

You can see more information at [CHANGTLOG](CHANGELOG.md)

## 💖 Credits

- https://github.com/logseq/logseq
- https://platform.openai.com
- https://github.com/pengx17/logseq-plugin-template-react
- https://github.com/briansunter/logseq-plugin-gpt3-openai
- Thanks to all open source projects for sharing ideas and techniques
