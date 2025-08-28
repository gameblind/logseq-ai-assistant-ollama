interface LanguageMessages {
    [key: string]: {
        [key: string]: string
    };
}

export const messages: LanguageMessages ={
    "en": {
        "aiProvider-description": "Choose your AI provider: OpenAI or Ollama (local).",
        "openaiKey-description": "Your OpenAI API key. You can get one at https://platform.openai.com/account/api-keys.",
        "openaiAddress-description": "You can add the OpenAI proxy address. The default value is `https://api.openai.com`.",
        "GPTModel-description": "You can choose the ChatGPT model. The default value is `gpt-3.5-turbo`.",
        "ollamaAddress-description": "Your Ollama server address. The default value is `http://localhost:11434`.",
        "ollamaModel-description": "The Ollama model name you want to use (e.g., llama2, codellama, mistral).",
        "apiKey-error": "Please set your OpenAI API Key in the plugin configuration.",
        "address-error": "Please set your OpenAI proxy address in the plugin configuration.",
        "ollamaAddress-error": "Please set your Ollama server address in the plugin configuration.",
        "ollamaModel-error": "Please set your Ollama model name in the plugin configuration.",
        "generateAdvancedQuery-description": "Prompt for generating logseq advanced query code, which can be customized.",
        "isTextQuery-description": "Whether to enable word selection query, when enabled, it will query other associated blocks. Note that it may affect the user experience.",
        "isStreamingOutput-description": "Is stream output enabled for GPT? If enabled, there is a possibility of output failure.",
        "gpt-summary-description": "Generate a concise summary of the current page content (within 144 characters)."
    },
    "zh-CN": {
        "aiProvider-description": "选择您的AI提供商：OpenAI 或 Ollama（本地）。",
        "openaiKey-description": "您的 OpenAI key. 您可从网站获取 https://platform.openai.com/account/api-keys.",
        "openaiAddress-description": "您可以自定义代理地址. 默认使用 OpenAI 的官方地址 `https://api.openai.com`.",
        "GPTModel-description": "您可以选择 GPT 模型. 默认使用 `gpt-3.5-turbo`.",
        "ollamaAddress-description": "您的 Ollama 服务器地址. 默认使用 `http://localhost:11434`.",
        "ollamaModel-description": "您要使用的 Ollama 模型名称（例如：llama2, codellama, mistral）。",
        "apiKey-error": "请在插件配置中先设置您的 OpenAI Key",
        "address-error": "请在插件配置中先设置您的 OpenAI 代理地址",
        "ollamaAddress-error": "请在插件配置中先设置您的 Ollama 服务器地址",
        "ollamaModel-error": "请在插件配置中先设置您的 Ollama 模型名称",
        "generateAdvancedQuery-description": "生成 logseq 高级查询代码的提示词，可自行定义.",
        "isTextQuery-description": "是否开启划词查询，当开启后，将会查询其他关联的块。注意可能会影响使用体验。",
        "isStreamingOutput-description": "是否为 gpt 开启流式输出，如果开启，可能会出现输出失败的情况。",
        "gpt-summary-description": "生成当前页面内容的简洁摘要（144字以内）。"
    },
}