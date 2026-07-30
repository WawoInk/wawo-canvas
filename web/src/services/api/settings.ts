import { apiGet } from "@/services/api/request";
import type { DecimalValue } from "@/lib/decimal";

export type PublicModelChannelSettings = {
    availableModels: string[];
    modelCosts: { model: string; displayName?: string; credits: DecimalValue; resolutionCredits?: Record<string, DecimalValue> }[];
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
