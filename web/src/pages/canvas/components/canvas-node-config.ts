import { imageResolutionsForConfig, normalizeImageSizeForResolutions } from "@/components/image-settings-panel";
import { brainstormAdminTextModelOptions } from "@/pages/storyboard/brainstorm-agent-model";
import type { PublicSettings } from "@/services/api/settings";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "../types";

export function buildCanvasAdminConfig(globalConfig: AiConfig, publicSettings?: PublicSettings | null): AiConfig {
    const channel = publicSettings?.modelChannel;
    const available = new Set((channel?.availableModels || []).map((model) => model.trim()).filter(Boolean));
    const listed = (models: string[] = []) => Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
    const allowed = (models: string[] = []) => listed(models).filter((model) => available.has(model));
    const imageModels = allowed(channel?.imageModels);
    const videoModels = listed(channel?.videoModels);
    const textOptions = brainstormAdminTextModelOptions(publicSettings);
    const textModels = textOptions.map((option) => option.value);
    const audioModels = allowed(channel?.audioModels);
    const pick = (current: string, fallback: string | undefined, models: string[]) => (models.includes(current.trim()) ? current.trim() : models.includes(fallback?.trim() || "") ? fallback!.trim() : models[0] || "");
    const textModel = pick(globalConfig.textModel, channel?.defaultTextModel, textModels);
    return {
        ...globalConfig,
        channelMode: "remote",
        baseUrl: "",
        apiKey: "",
        apiFormat: textOptions.find((option) => option.value === textModel)?.protocol || "openai",
        channels: [],
        model: textModel,
        imageModel: pick(globalConfig.imageModel, channel?.defaultImageModel, imageModels),
        videoModel: pick(globalConfig.videoModel, channel?.defaultVideoModel, videoModels),
        textModel,
        audioModel: pick(globalConfig.audioModel, channel?.defaultAudioModel, audioModels),
        models: Array.from(new Set([...imageModels, ...videoModels, ...textModels, ...audioModels])),
        imageModels,
        videoModels,
        textModels,
        audioModels,
        systemPrompt: channel?.systemPrompt || "",
        modelDisplayNames: Object.fromEntries((channel?.modelCosts || []).filter((item) => item.model && item.displayName?.trim()).map((item) => [item.model, item.displayName!.trim()])),
        imageRequestFormats: channel?.imageRequestFormats || [],
    };
}

export function buildNodeConfig(globalConfig: AiConfig, defaults: AiConfig, node: CanvasNodeData | undefined, mode: CanvasGenerationMode, publicSettings?: PublicSettings | null): AiConfig {
    const metadata = node?.metadata;
    const adminConfig = buildCanvasAdminConfig(globalConfig, publicSettings);
    const models = mode === "image" ? adminConfig.imageModels : mode === "video" ? adminConfig.videoModels : mode === "audio" ? adminConfig.audioModels : adminConfig.textModels;
    const defaultModel = mode === "image" ? adminConfig.imageModel : mode === "video" ? adminConfig.videoModel : mode === "audio" ? adminConfig.audioModel : adminConfig.textModel;
    const model = metadata?.model?.trim();
    const videoSeconds = metadata?.seconds || globalConfig.videoSeconds || defaults.videoSeconds;
    const config = {
        ...adminConfig,
        model: model && models.includes(model) ? model : defaultModel,
        apiFormat: mode === "text" ? publicSettings?.modelChannel.textModelProtocols[model && models.includes(model) ? model : defaultModel] || "openai" : "openai",
        quality: metadata?.quality || globalConfig.quality || defaults.quality,
        size: metadata?.size || globalConfig.size || defaults.size,
        background: metadata?.background ?? globalConfig.background ?? defaults.background,
        videoMode: metadata?.videoMode || globalConfig.videoMode || defaults.videoMode,
        videoSeconds: mode === "video" && videoSeconds === "-1" ? defaults.videoSeconds : videoSeconds,
        vquality: metadata?.vquality || globalConfig.vquality || defaults.vquality,
        videoGenerateAudio: metadata?.generateAudio || (mode === "video" ? "false" : globalConfig.videoGenerateAudio || defaults.videoGenerateAudio),
        videoWatermark: metadata?.watermark || globalConfig.videoWatermark || defaults.videoWatermark,
        videoNegativePrompt: metadata?.negativePrompt ?? globalConfig.videoNegativePrompt ?? defaults.videoNegativePrompt,
        audioVoice: metadata?.audioVoice || globalConfig.audioVoice || defaults.audioVoice,
        audioFormat: metadata?.audioFormat || globalConfig.audioFormat || defaults.audioFormat,
        audioSpeed: metadata?.audioSpeed || globalConfig.audioSpeed || defaults.audioSpeed,
        audioInstructions: metadata?.audioInstructions || globalConfig.audioInstructions || defaults.audioInstructions,
        count: String(metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaults.count),
    };
    if (mode === "image") config.size = normalizeImageSizeForResolutions(imageResolutionsForConfig(config), config.size);
    return config;
}

export function buildSavedImageConfig(globalConfig: AiConfig, metadata: CanvasNodeMetadata, publicSettings?: PublicSettings | null): AiConfig {
    const adminConfig = buildCanvasAdminConfig(globalConfig, publicSettings);
    return {
        ...adminConfig,
        model: metadata.model && adminConfig.imageModels.includes(metadata.model) ? metadata.model : adminConfig.imageModel,
        quality: metadata.quality || globalConfig.quality,
        size: metadata.size || globalConfig.size,
        background: metadata.background === "transparent" ? "transparent" : "",
        count: "1",
    };
}

export function videoConfigPatch(key: keyof AiConfig, value: string): Partial<CanvasNodeMetadata> {
    if (key === "videoMode") return { videoMode: value === "frames" ? "frames" : "reference" };
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoNegativePrompt") return { negativePrompt: value };
    return { [key]: value };
}

export function audioConfigPatch(key: CanvasAudioSettingKey, value: string): Partial<CanvasNodeMetadata> {
    return { [key]: value };
}
