import { apiGet } from "@/services/api/request";
import type { DecimalValue } from "@/lib/decimal";

export type ImageRequestFormat = "application/json" | "multipart/form-data";
export type ImageRequestFormatOption = ImageRequestFormat | "default";
export type CanvasImageRequestMode = "split" | "generations";
export type ImageResolutionOption = "default" | "1k" | "2k" | "4k";
export type ImageRequestFormatSetting = {
    model: string;
    format: ImageRequestFormatOption;
    canvasRequestMode: CanvasImageRequestMode;
    resolutions: ImageResolutionOption[];
};

export type PublicModelChannelSettings = {
    availableModels: string[];
    modelCosts: { model: string; displayName?: string; credits: DecimalValue; resolutionCredits?: Record<string, DecimalValue> }[];
    imageRequestFormats: ImageRequestFormatSetting[];
    defaultModel: string;
    defaultImageModel: string;
    defaultVideoModel: string;
    defaultTextModel: string;
    defaultAudioModel: string;
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    textModelProtocols: Record<string, string>;
    audioModels: string[];
    systemPrompt: string;
    allowCustomChannel: boolean;
};

export type PublicAuthSettings = {
    allowRegister: boolean;
    linuxDo: {
        enabled: boolean;
    };
};

export type PublicSettings = {
    modelChannel: PublicModelChannelSettings;
    auth: PublicAuthSettings;
};

export async function fetchPublicSettings() {
    return apiGet<PublicSettings>("/api/settings");
}
