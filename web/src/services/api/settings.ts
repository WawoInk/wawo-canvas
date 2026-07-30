import { apiGet } from "@/services/api/request";

export type PublicModelChannelSettings = {
    availableModels: string[];
    modelCosts: { model: string; displayName?: string; credits: number; resolutionCredits?: Record<string, number> }[];
    defaultModel: string;
    defaultImageModel: string;
    defaultVideoModel: string;
    defaultTextModel: string;
    defaultAudioModel: string;
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
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
