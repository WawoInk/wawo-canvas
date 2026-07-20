import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "../types";

export function buildNodeConfig(globalConfig: AiConfig, defaults: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || (mode === "audio" ? defaults.audioModel : globalConfig.model || defaults.model),
        quality: node.metadata?.quality || globalConfig.quality || defaults.quality,
        size: node.metadata?.size || globalConfig.size || defaults.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaults.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaults.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaults.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaults.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaults.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaults.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaults.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaults.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaults.count),
    };
}

export function videoConfigPatch(key: keyof AiConfig, value: string): Partial<CanvasNodeMetadata> {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

export function audioConfigPatch(key: CanvasAudioSettingKey, value: string): Partial<CanvasNodeMetadata> {
    return { [key]: value };
}
