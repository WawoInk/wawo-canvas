import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "../types";

export function buildNodeConfig(globalConfig: AiConfig, defaults: AiConfig, node: CanvasNodeData | undefined, mode: CanvasGenerationMode): AiConfig {
    const metadata = node?.metadata;
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: metadata?.model || defaultModel || (mode === "audio" ? defaults.audioModel : globalConfig.model || defaults.model),
        quality: metadata?.quality || globalConfig.quality || defaults.quality,
        size: metadata?.size || globalConfig.size || defaults.size,
        videoSeconds: metadata?.seconds || globalConfig.videoSeconds || defaults.videoSeconds,
        vquality: metadata?.vquality || globalConfig.vquality || defaults.vquality,
        videoGenerateAudio: metadata?.generateAudio || globalConfig.videoGenerateAudio || defaults.videoGenerateAudio,
        videoWatermark: metadata?.watermark || globalConfig.videoWatermark || defaults.videoWatermark,
        videoNegativePrompt: metadata?.negativePrompt ?? globalConfig.videoNegativePrompt ?? defaults.videoNegativePrompt,
        audioVoice: metadata?.audioVoice || globalConfig.audioVoice || defaults.audioVoice,
        audioFormat: metadata?.audioFormat || globalConfig.audioFormat || defaults.audioFormat,
        audioSpeed: metadata?.audioSpeed || globalConfig.audioSpeed || defaults.audioSpeed,
        audioInstructions: metadata?.audioInstructions || globalConfig.audioInstructions || defaults.audioInstructions,
        count: String(metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaults.count),
    };
}

export function videoConfigPatch(key: keyof AiConfig, value: string): Partial<CanvasNodeMetadata> {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoNegativePrompt") return { negativePrompt: value };
    return { [key]: value };
}

export function audioConfigPatch(key: CanvasAudioSettingKey, value: string): Partial<CanvasNodeMetadata> {
    return { [key]: value };
}
