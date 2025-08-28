import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { lang } from './language';
import prompts from '@/prompt/query.toml?raw';
import toml from 'toml';

export const settingsSchema = async() => {
    return [
        {
            key: "aiProvider",
            type: "enum",
            default: "openai",
            title: "AI Provider",
            enumChoices: ["openai", "ollama"],
            description: (await lang()).message('aiProvider-description'),
        },
        {
            key: "openaiKey",
            type: "string",
            default: "",
            title: "OpenAI API Key",
            description: (await lang()).message("openaiKey-description"),
        },
        {
            key: "openaiAddress",
            type: "string",
            default: "https://api.openai.com",
            title: "OpenAI Address",
            description: (await lang()).message('openaiAddress-description'),
        },
        {
            key: "GPTModel",
            type: "enum",
            default: "gpt-3.5-turbo",
            title: "ChatGPT Models",
            enumChoices: ["gpt-3.5-turbo", "gpt-3.5-turbo-16k", "gpt-4", "gpt-4-32k", "gpt-3.5-turbo-0613", "gpt-4-0613", "gpt-4o", "gpt-5-nano-2025-08-07"],
            description: (await lang()).message('GPTModel-description'),
        },
        {
            key: "ollamaAddress",
            type: "string",
            default: "http://localhost:11434",
            title: "Ollama Server Address",
            description: (await lang()).message('ollamaAddress-description'),
        },
        {
            key: "ollamaModel",
            type: "string",
            default: "llama2",
            title: "Ollama Model",
            description: (await lang()).message('ollamaModel-description'),
        },
        {
            type: "heading",
            title: "Image Generation",
        },
        {
            key: "imageApiKey",
            type: "string",
            default: "",
            title: "Image API Key",
            description: "API Key for image generation service",
        },
        {
            key: "imageApiAddress",
            type: "string",
            default: "https://gpt-best.apifox.cn",
            title: "Image API Address",
            description: "Base URL for image generation API",
        },
        {
            key: "imageModel",
            type: "enum",
            default: "qwen-image",
            title: "Image Generation Model",
            enumChoices: ["qwen-image", "dall-e-3"],
            description: "Model for text-to-image and image-to-image generation",
        },
        {
            key: "imageEditModel",
            type: "enum",
            default: "qwen-image-edit",
            title: "Image Edit Model",
            enumChoices: ["gpt-image-1", "qwen-image-edit"],
            description: "Model for image editing operations",
        },
        {
            key: "imageEditQuality",
            type: "enum",
            default: "auto",
            title: "Image Edit Quality",
            enumChoices: ["auto", "high", "medium", "low"],
            description: "Quality setting for image editing (gpt-image-1 only)",
        },
        {
            key: "imageEditResponseFormat",
            type: "enum",
            default: "b64_json",
            title: "Image Edit Response Format",
            enumChoices: ["url", "b64_json"],
            description: "Response format for edited images",
        },
        {
            key: "imageEditSize",
            type: "enum",
            default: "auto",
            title: "Image Edit Size",
            enumChoices: ["auto", "1024x1024", "1536x1024", "1024x1536"],
            description: "Size for edited images",
        },
        {
            key: "imageEditCount",
            type: "enum",
            default: "1",
            title: "Image Edit Count",
            enumChoices: ["1", "2", "3", "4", "5"],
            description: "Number of edited images to generate (1-5)",
        },
        {
            type: "heading",
            title: "Text-to-Speech (TTS)",
        },
        {
            key: "ttsApiKey",
            type: "string",
            default: "",
            title: "TTS API Key",
            description: "API Key for text-to-speech service",
        },
        {
            key: "ttsApiAddress",
            type: "string",
            default: "https://api.openai.com",
            title: "TTS API Address",
            description: "Base URL for TTS API (e.g., https://api.openai.com)",
        },
        {
            key: "ttsModel",
            type: "enum",
            default: "tts-1",
            title: "TTS Model",
            enumChoices: ["tts-1", "tts-1-hd"],
            description: "Text-to-speech model (tts-1-hd for higher quality)",
        },
        {
            key: "ttsVoice",
            type: "enum",
            default: "alloy",
            title: "TTS Voice",
            enumChoices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "Chelsie", "Cherry", "Ethan", "Serena", "Dylan", "Jada", "Sunny"],
            description: "Voice style for text-to-speech (OpenAI: alloy/echo/fable/onyx/nova/shimmer, Qwen: Chelsie/Cherry/Ethan/Serena/Dylan/Jada/Sunny)",
        },
        {
            key: "ttsResponseFormat",
            type: "enum",
            default: "mp3",
            title: "TTS Audio Format",
            enumChoices: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
            description: "Audio format for generated speech",
        },
        {
            key: "ttsSpeed",
            type: "enum",
            default: "1.0",
            title: "TTS Speed",
            enumChoices: ["0.25", "0.5", "0.75", "1.0", "1.25", "1.5", "2.0", "3.0", "4.0"],
            description: "Speech speed (0.25-4.0, 1.0 is normal)",
        },
        {
            type: "heading",
            title: "Qwen TTS (阿里云DashScope)",
        },
        {
            key: "dashscopeApiKey",
            type: "string",
            default: "",
            title: "DashScope API Key",
            description: "阿里云DashScope API密钥 (格式: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)",
        },
        {
            key: "qwenTtsModel",
            type: "enum",
            default: "qwen-tts",
            title: "Qwen TTS Model",
            enumChoices: ["qwen-tts", "qwen-tts-2025-05-22", "qwen-tts-latest"],
            description: "Qwen TTS模型选择 (qwen-tts: 基础版本, qwen-tts-2025-05-22: 特定版本, qwen-tts-latest: 最新版本)",
        },
        {
            key: "qwenTtsVoice",
            type: "enum",
            default: "Chelsie",
            title: "Qwen TTS Voice",
            enumChoices: ["Chelsie", "Cherry", "Ethan", "Serena", "Dylan", "Jada", "Sunny"],
            description: "Qwen TTS音色选择:\n\n【标准音色】\n• Cherry(女声) - 活泼灵动，中英双语标准音\n• Chelsie(女声) - 柔和亲切，中英双语标准音\n• Serena(女声) - 优雅知性，中英双语标准音\n• Ethan(男声) - 沉稳磁性，中英双语标准音\n\n【方言音色】\n• Dylan(男声) - 地道京味儿，带有标志性的儿化音\n• Jada(女声) - 吴侬软语，细腻婉转的上海口音\n• Sunny(女声) - 麻辣川普，热情直率的四川口音",
        },
        {
            key: "qwenTtsFormat",
            type: "enum",
            default: "mp3",
            title: "Qwen TTS Audio Format",
            enumChoices: ["mp3", "wav", "flac", "opus"],
            description: "Qwen TTS音频格式",
        },
        {
            key: "qwenVideoT2VModel",
            type: "enum",
            default: "wan2.2-t2v-plus",
            title: "Qwen Text-to-Video Model",
            enumChoices: ["wan2.2-t2v-plus", "wanx2.1-t2v-turbo", "wanx2.1-t2v-plus"],
            description: "Qwen文生视频模型选择 (wan2.2-t2v-plus: 万相2.2专业版, wanx2.1-t2v-turbo: 万相2.1极速版, wanx2.1-t2v-plus: 万相2.1专业版)",
        },
        {
            key: "qwenVideoI2VModel",
            type: "enum",
            default: "wan2.2-i2v-plus",
            title: "Qwen Image-to-Video Model",
            enumChoices: ["wan2.2-i2v-flash", "wan2.2-i2v-plus", "wanx2.1-i2v-plus", "wanx2.1-i2v-turbo"],
            description: "Qwen图生视频模型选择 (wan2.2-i2v-flash: 万相2.2极速版, wan2.2-i2v-plus: 万相2.2专业版, wanx2.1-i2v-plus: 万相2.1专业版, wanx2.1-i2v-turbo: 万相2.1极速版)",
        },
        {
            key: "qwenVideoResolution",
            type: "enum",
            default: "1280*720",
            title: "Qwen Video Resolution",
            enumChoices: ["1920*1080", "1280*720", "854*480"],
            description: "Qwen视频分辨率 (1920*1080: 1080P, 1280*720: 720P, 854*480: 480P)",
        },
        {
            key: "qwenVideoPromptExtend",
            type: "boolean",
            default: true,
            title: "Enable Prompt Extension",
            description: "是否启用提示词扩展功能，可以丰富生成视频的细节",
        },
        {
            type: "heading",
            title: "Bridge Service",
        },
        {
            key: "bridgeServiceUrl",
            type: "string",
            default: "http://localhost:3000",
            title: "Bridge Service URL",
            description: "桥接服务的地址，用于异步任务处理",
        },
        {
            type: "heading",
            title: "Beta Features",
        },
        {
            key: "isStreamingOutput",
            type: "boolean",
            default: true,
            title: "Streaming Output",
            description: (await lang()).message('isStreamingOutput-description'),
        },
        {
            key: "isTextQuery",
            type: "boolean",
            default: false,
            title: "Text Query",
            description: (await lang()).message('isTextQuery-description'),
        },
        {
            key: "defaultSystemPrompt",
            type: "string",
            default: "You are a helpful AI assistant. Please provide accurate, helpful, and concise responses.",
            title: "Default System Prompt",
            inputAs: "textarea",
            description: "Default system prompt for /gpt command. You can customize this to change the AI's behavior and personality.",
        }
        // {
        //     key: "generateAdvancedQuery",
        //     type: "string",
        //     default: '',
        //     title: "Generate Advanced Query Prompt",
        //     inputAs: "textarea",
        //     description: (await lang()).message('generateAdvancedQuery-description'),
        // },
    ] as SettingSchemaDesc[];
}

export const getSettings = async() => {
    const pormpt: any = toml.parse(prompts);
    const aiProvider: string = logseq.settings!["aiProvider"] || "openai";
    const openaiKey: string = logseq.settings!["openaiKey"];
    const openaiAddress: string = logseq.settings!["openaiAddress"];
    const gptModel: string = logseq.settings!["GPTModel"];
    const ollamaAddress: string = logseq.settings!["ollamaAddress"];
    const ollamaModel: string = logseq.settings!["ollamaModel"];
    const imageApiKey: string = logseq.settings!["imageApiKey"];
    const imageApiAddress: string = logseq.settings!["imageApiAddress"];
    const imageModel: string = logseq.settings!["imageModel"];
    const imageEditModel: string = logseq.settings!["imageEditModel"];
    const imageEditQuality: string = logseq.settings!["imageEditQuality"];
    const imageEditResponseFormat: string = logseq.settings!["imageEditResponseFormat"];
    const imageEditSize: string = logseq.settings!["imageEditSize"];
    const imageEditCount: string = logseq.settings!["imageEditCount"];
    const ttsApiKey: string = logseq.settings!["ttsApiKey"];
    const ttsApiAddress: string = logseq.settings!["ttsApiAddress"];
    const ttsModel: string = logseq.settings!["ttsModel"];
    const ttsVoice: string = logseq.settings!["ttsVoice"];
    const ttsResponseFormat: string = logseq.settings!["ttsResponseFormat"];
    const ttsSpeed: string = logseq.settings!["ttsSpeed"];
    const dashscopeApiKey: string = logseq.settings!["dashscopeApiKey"];
    const qwenTtsModel: string = logseq.settings!["qwenTtsModel"];
    const qwenTtsVoice: string = logseq.settings!["qwenTtsVoice"];
    const qwenTtsFormat: string = logseq.settings!["qwenTtsFormat"];
    const qwenVideoT2VModel: string = logseq.settings!["qwenVideoT2VModel"];
    const qwenVideoI2VModel: string = logseq.settings!["qwenVideoI2VModel"];
    const qwenVideoResolution: string = logseq.settings!["qwenVideoResolution"];
    const qwenVideoPromptExtend: boolean = logseq.settings!["qwenVideoPromptExtend"];
    const bridgeServiceUrl: string = logseq.settings!["bridgeServiceUrl"] || "http://localhost:3000";
    let promptAdvancedQuery: string = logseq.settings!["generateAdvancedQuery"];
    const isTextQuery: boolean = logseq.settings!["isTextQuery"];
    const defaultSystemPrompt: string = logseq.settings!["defaultSystemPrompt"] || "You are a helpful AI assistant. Please provide accurate, helpful, and concise responses.";

    // 根据AI提供商验证必要的配置
    if (aiProvider === "openai") {
        if(undefined === openaiKey || '' === openaiKey) {
            throw new Error((await lang()).message('apiKey-error'));
        }
        if(undefined === openaiAddress || '' === openaiAddress) {
            throw new Error((await lang()).message('address-error'));
        }
    } else if (aiProvider === "ollama") {
        if(undefined === ollamaAddress || '' === ollamaAddress) {
            throw new Error((await lang()).message('ollamaAddress-error'));
        }
        if(undefined === ollamaModel || '' === ollamaModel) {
            throw new Error((await lang()).message('ollamaModel-error'));
        }
    }
    
    if( undefined === promptAdvancedQuery || '' === promptAdvancedQuery.replaceAll(' ', '')) {
        promptAdvancedQuery = pormpt['advanced-query'].prompt;
    }

    return {
        aiProvider,
        openaiKey,
        openaiAddress,
        gptModel,
        ollamaAddress,
        ollamaModel,
        imageApiKey,
        imageApiAddress,
        imageModel,
        imageEditModel,
        imageEditQuality,
        imageEditResponseFormat,
        imageEditSize,
        imageEditCount,
        ttsApiKey,
        ttsApiAddress,
        ttsModel,
        ttsVoice,
        ttsResponseFormat,
        ttsSpeed,
        dashscopeApiKey,
        qwenTtsModel,
        qwenTtsVoice,
        qwenTtsFormat,
        qwenVideoT2VModel,
        qwenVideoI2VModel,
        qwenVideoResolution,
        qwenVideoPromptExtend,
        bridgeServiceUrl,
        promptAdvancedQuery,
        isTextQuery,
        defaultSystemPrompt,
        isStreamingOutput: logseq.settings!["isStreamingOutput"] as boolean
    };
}