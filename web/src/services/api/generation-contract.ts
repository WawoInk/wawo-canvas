import i18n from "@/i18n";

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export function generationTaskId(metadata?: { generationTaskId?: string; upstreamTaskId?: string }) {
    return metadata?.generationTaskId || metadata?.upstreamTaskId || "";
}

export function generationStatusLabel(status?: GenerationTaskStatus) {
    return i18n.t(status === "queued" ? "generation.status.queued" : "generation.status.running");
}

export async function pollGenerationTask<T extends { status: GenerationTaskStatus }>(load: () => Promise<T>, sleep: () => Promise<void>, onStatus?: (task: T) => void, attempts = 360) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const task = await load();
        onStatus?.(task);
        if (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") return task;
        if (attempt < attempts - 1) await sleep();
    }
    throw new Error(i18n.t("errors.video.timeout"));
}

export type GenerationSettingDefinition = {
    type: "enum" | "duration" | "boolean";
    values?: string[];
    min?: number;
    max?: number;
    allowAuto?: boolean;
    default: string | number | boolean;
};

export type GenerationTextDefinition = {
    required: boolean;
    minLength: number;
    maxLength: number;
    cjkMaxLength?: number;
};

export type GenerationAssetDefinition = {
    required: boolean;
    min: number;
    max: number;
    nameMaxLength: number;
    roles: ShortDramaAssetRole[];
    mimeTypes: string[];
};

export type GenerationProfile = {
    id: string;
    version: number;
    displayName: string;
    credits: DecimalValue;
    adapterKey: string;
    intents: string[];
    capabilities: {
        title?: GenerationTextDefinition;
        script?: GenerationTextDefinition;
        assets?: GenerationAssetDefinition;
        settings: Record<string, GenerationSettingDefinition>;
        cancellation: boolean;
        completion: string[];
    };
};

export type PlatformMediaReference = { fileId: string; sourceNodeId?: string; name?: string };
export type GeneratedFile = { fileId: string; mimeType: string; bytes?: number; width?: number; height?: number; durationMs?: number };
export type GenerationShot = { index: number; durationSeconds?: number; fileId?: string; status: string };
export type GenerationResult = { kind: "video"; file: GeneratedFile } | { kind: "short-drama"; file: GeneratedFile; thumbnailFileId?: string; shots?: GenerationShot[] };

export function readGeneratedVideoFile(result: unknown): GeneratedFile | null {
    if (!result || typeof result !== "object") return null;
    const value = result as Partial<GenerationResult>;
    if ((value.kind !== "video" && value.kind !== "short-drama") || !value.file || typeof value.file.fileId !== "string" || !value.file.fileId.trim() || typeof value.file.mimeType !== "string" || !value.file.mimeType.trim()) return null;
    return value.file;
}

export type GenerationReferences = { images: PlatformMediaReference[]; videos: PlatformMediaReference[]; audios: PlatformMediaReference[] };
export type VideoGenerationSettings = {
    aspectRatio: "adaptive" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
    resolution: "480p" | "720p" | "1080p";
    durationSeconds: number;
    generateAudio?: boolean;
    watermark?: boolean;
};
export type ShortDramaAssetRole = "character" | "scene" | "tool";
export type ShortDramaAsset = { sourceNodeId: string; role: ShortDramaAssetRole; name: string; description?: string; reference: PlatformMediaReference };
export type ShortDramaGenerationSettings = {
    aspectRatio: "16:9" | "9:16";
    resolution: "1080p";
    durationSeconds: "auto" | number;
    quality: "standard" | "high";
};
export type GenerationIntent =
    | { kind: "video.generate"; prompt: string; negativePrompt?: string; references: GenerationReferences; settings?: VideoGenerationSettings }
    | { kind: "video.short-drama"; title: string; script: string; assets: ShortDramaAsset[]; settings?: ShortDramaGenerationSettings };
export type GenerationCommand = {
    commandVersion: 1;
    clientRequestId: string;
    modelProfileId: string;
    source: "canvas" | "image_workbench" | "video_workbench";
    intent: GenerationIntent;
};

export function resolveCanvasVideoSubmission(channelMode: "remote" | "local", profile?: Pick<GenerationProfile, "id">) {
    if (channelMode === "local") return "local-compatibility" as const;
    if (!profile) throw new Error(i18n.t("errors.video.firstPartyProfileRequired"));
    return "first-party" as const;
}

export function buildGenerationCommand(input: {
    clientRequestId: string;
    modelProfileId: string;
    source: GenerationCommand["source"];
    intent?: GenerationIntent;
    prompt?: string;
    references?: GenerationReferences;
    settings?: VideoGenerationSettings;
}): GenerationCommand {
    return {
        commandVersion: 1,
        clientRequestId: input.clientRequestId,
        modelProfileId: input.modelProfileId,
        source: input.source,
        intent: input.intent ?? { kind: "video.generate", prompt: input.prompt || "", references: input.references ?? { images: [], videos: [], audios: [] }, ...(input.settings ? { settings: input.settings } : {}) },
    };
}

export function buildShortDramaGenerationSettings(profile: GenerationProfile, provided: Partial<ShortDramaGenerationSettings>): ShortDramaGenerationSettings {
    const settings = profile.capabilities.settings;
    const enumValue = <T extends string>(key: "aspectRatio" | "resolution" | "quality", value: T | undefined) => {
        const definition = settings[key];
        return typeof value === "string" && definition.values?.includes(value) ? value : definition.default;
    };
    const duration = settings.durationSeconds;
    const requested = provided.durationSeconds ?? duration.default;
    const durationSeconds = requested === "auto" && duration.allowAuto ? "auto" : Math.max(duration.min!, Math.min(duration.max!, Number(requested)));
    return {
        aspectRatio: enumValue("aspectRatio", provided.aspectRatio) as ShortDramaGenerationSettings["aspectRatio"],
        resolution: enumValue("resolution", provided.resolution) as ShortDramaGenerationSettings["resolution"],
        durationSeconds,
        quality: enumValue("quality", provided.quality) as ShortDramaGenerationSettings["quality"],
    };
}

export function buildVideoGenerationSettings(profile: GenerationProfile, provided: Partial<VideoGenerationSettings>): VideoGenerationSettings {
    const settings = profile.capabilities.settings;
    const enumValue = (key: "aspectRatio" | "resolution") => {
        const definition = settings[key];
        const value = provided[key];
        return typeof value === "string" && definition.values?.includes(value) ? value : definition.default;
    };
    const duration = settings.durationSeconds;
    const requestedDuration = Number.isInteger(provided.durationSeconds) ? provided.durationSeconds! : Number(duration.default);
    const durationSeconds = duration.allowAuto && requestedDuration === -1 ? -1 : Math.max(duration.min!, Math.min(duration.max!, requestedDuration));

    return {
        aspectRatio: enumValue("aspectRatio") as VideoGenerationSettings["aspectRatio"],
        resolution: enumValue("resolution") as VideoGenerationSettings["resolution"],
        durationSeconds,
        ...(settings.generateAudio ? { generateAudio: typeof provided.generateAudio === "boolean" ? provided.generateAudio : Boolean(settings.generateAudio.default) } : {}),
        ...(settings.watermark ? { watermark: typeof provided.watermark === "boolean" ? provided.watermark : Boolean(settings.watermark.default) } : {}),
    };
}
import type { DecimalValue } from "@/lib/decimal";
