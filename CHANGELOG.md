## [1.2.0] (2024-12-20)

### Features

* **video-generation:** 🎬 Add comprehensive video generation capabilities
  * **text-to-video:** Add `/gpt-t2v` command for generating videos from text descriptions
  * **image-to-video:** Add `/gpt-i2v` command for generating videos from images
  * **mcp-bridge:** Implement MCP bridge service integration for Qwen video generation API
  * **smart-polling:** Intelligent task status polling with optimized intervals (4s → 15s)
  * **auto-storage:** Automatic video download and storage in Logseq assets directory
  * **image-processing:** Smart image path handling with automatic Base64 conversion for local files
  * **progress-tracking:** Real-time progress tracking and status updates
  * **error-handling:** Comprehensive error handling and user feedback
  * **multi-format:** Support for both local and network images in I2V mode

### Bug Fixes

* **prompt-display:** Fix prompt display issues by switching from updateBlock to insertBlock
* **image-path:** Resolve "No such file or directory" errors in I2V functionality
* **user-experience:** Improve user feedback and error messages for video generation

### Documentation

* **video-guide:** Add comprehensive video generation usage guide
* **api-docs:** Update API documentation with video generation endpoints
* **examples:** Add detailed usage examples for T2V and I2V commands

## [1.1.4] (2024-12-19)

### Features

* **gpt-command:** 为/gpt命令添加系统提示词支持，显著提升回复质量
* **settings:** 添加可配置的GPT系统提示词设置，用户可自定义AI行为

## [1.1.3] (2024-12-19)

### Features

* **prompt-management:** Add intelligent prompt length management with 1000 character limit and auto-truncation
* **auto-generate:** Add new `/auto_generate_image` command for context-based image generation
* **image-optimization:** Enhanced image generation with smart truncation and consistent processing
* **user-experience:** Improved error handling and user feedback for image generation
* **file-organization:** Better asset management and file handling
* **api-integration:** Enhanced API integration with improved error handling

### Security

* **sensitive-data:** Remove hardcoded API keys from test files
* **documentation:** Add security warnings for API key management

## [1.1.2](https://github.com/UNICKCHENG/logseq-ai-assistant/compare/v1.1.1...v1.1.2) (2023-07-05)


### Bug Fixes

* **openai-stream:** fix the error of json ([be4e1e5](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/be4e1e595d2804d3a3aa3e366980eb676b511be5))

## [1.1.1](https://github.com/UNICKCHENG/logseq-ai-assistant/compare/v1.1.0...v1.1.1) (2023-06-14)


### Bug Fixes

* **gpt:** fix some bug ([696ed75](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/696ed7561b2fa1c3afccd425eb54e5a11f71be09))

# [1.1.0](https://github.com/UNICKCHENG/logseq-ai-assistant/compare/v1.0.0...v1.1.0) (2023-06-11)


### Features

* **aihey-query-beta:** add a beta command ([45c8a07](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/45c8a07385f378671b5dc3ed342ac530b62caaee))
* **aihey:** add aihey command ([79ca7cf](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/79ca7cf104a7e8e326566a323d769c99e5bddb16))
* **language:** add Chinese language support ([5ce625f](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/5ce625f4508818e73ecab0fe383205e75c04b6ad))
* **select:** add selected search ([8963bd9](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/8963bd9ea402ab540672dc71cf57a14248f727dd))

# 1.0.0 (2023-05-31)


### Features

* **command:** add gpt-block to summary content ([8fd3bb5](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/8fd3bb5510a390ab822ba86a15b8abc39d1916f7))
* support openai ([992cf66](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/992cf666f04e87198dc364ae2b7a95ed07ae29fd))
* support stream output ([b2cdafa](https://github.com/UNICKCHENG/logseq-ai-assistant/commit/b2cdafa8338024b8ff0fee8207b5ef42aa13959a))
