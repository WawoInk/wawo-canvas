import {
    buildGenerationCommand,
    buildShortDramaGenerationSettings,
    buildVideoGenerationSettings,
    createGeneration,
    getGenerationByClientRequestId,
    readGeneratedVideoFile,
    retryableGenerationQueryError,
    waitForGeneration,
    type GenerationCommand,
    type GeneratedFile,
    type GenerationProfile,
    type ShortDramaAssetRole,
    type VideoGenerationSettings,
} from "@/services/api/generations";
import { fetchGenerationTaskDetail, type GenerationTaskDetail } from "@/services/api/generation-tasks";
import { createVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import { boolConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { nanoid } from "nanoid";
import i18n from "@/i18n";

export type VideoWorkbenchTask = (VideoGenerationTask & { firstParty?: false }) | { id: string; model: string; firstParty: true; clientRequestId?: string; cancellation: boolean };
export const VIDEO_WORKBENCH_COMPATIBILITY_POLL_ATTEMPTS = 360;

export type MaterializedVideo = {
    id: string;
    url: string;
    fileId: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type CompletionDependencies = {
    pollTask?: () => Promise<GenerationTaskDetail>;
    resolveFile: (fileId: string, file?: GeneratedFile) => Promise<MaterializedVideo>;
    sleep?: () => Promise<void>;
    signal?: AbortSignal;
};

type CreateVideoWorkbenchTaskOptions = {
    profile?: GenerationProfile;
    clientRequestId?: string;
    title?: string;
    dramaAssetRoles?: Record<string, ShortDramaAssetRole>;
};

export async function createVideoWorkbenchTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options: CreateVideoWorkbenchTaskOptions = {},
): Promise<VideoWorkbenchTask> {
    if (config.channelMode === "local") return createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, undefined, "video_workbench");
    if (!options.profile) throw new Error(i18n.t("errors.video.firstPartyProfileRequired"));
    const clientRequestId = options.clientRequestId || nanoid();
    const command = buildVideoWorkbenchGenerationCommand({
        clientRequestId,
        profile: options.profile,
        config,
        prompt,
        title: options.title,
        references,
        videoReferences,
        audioReferences,
        dramaAssetRoles: options.dramaAssetRoles,
    });
    let task;
    try {
        task = await createGeneration(command);
    } catch (error) {
        if (!retryableGenerationQueryError(error)) throw error;
        task = await getGenerationByClientRequestId(clientRequestId);
    }
    return { id: task.id, model: options.profile.id, firstParty: true, clientRequestId, cancellation: options.profile.capabilities.cancellation };
}

export async function completeVideoWorkbenchTask(task: VideoWorkbenchTask, dependencies: CompletionDependencies): Promise<MaterializedVideo> {
    if (task.firstParty) {
        const completed = await waitForGeneration(task.id, dependencies.signal, undefined, task.clientRequestId || "");
        const file = readGeneratedVideoFile(completed.result);
        if (!file) throw new Error("Video task completed without a file");
        return dependencies.resolveFile(file.fileId, file);
    }
    const platformTaskId = task.platformTaskId;
    if (!platformTaskId) throw new Error("Video task is missing its platform task ID");
    const pollTask = dependencies.pollTask || (() => fetchGenerationTaskDetail(platformTaskId));
    for (let attempt = 0; attempt < VIDEO_WORKBENCH_COMPATIBILITY_POLL_ATTEMPTS; attempt += 1) {
        const detail = await pollTask();
        const status = detail.task.status;
        if (status === "success" || status === "succeeded") {
            const fileId = readFileId(detail.task.metadata);
            if (!fileId) throw new Error("Video task completed without a file");
            return dependencies.resolveFile(fileId);
        }
        if (status === "failed" || status === "cancelled") throw new Error(detail.task.errorMessage || (status === "cancelled" ? "Video generation was cancelled" : "Video generation failed"));
        await (dependencies.sleep?.() ?? new Promise((resolve) => setTimeout(resolve, 5000)));
    }
    throw new Error("Video task polling timed out");
}

export function buildVideoWorkbenchGenerationCommand(input: {
    clientRequestId: string;
    profile: GenerationProfile;
    config: AiConfig;
    prompt: string;
    title?: string;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    dramaAssetRoles?: Record<string, ShortDramaAssetRole>;
}): GenerationCommand {
    const prompt = input.prompt.trim();
    if (input.profile.intents.includes("video.short-drama")) {
        const title = input.title?.trim() || "";
        if (!title) throw new Error(i18n.t("canvas.generation.errors.shortDramaTitleRequired"));
        const assets = input.references.map((image) => {
            const role = input.dramaAssetRoles?.[image.id];
            if (!role) throw new Error(i18n.t("canvas.generation.errors.shortDramaRoleRequired", { name: image.name }));
            const fileId = platformFileID(image);
            return {
                sourceNodeId: image.id,
                role,
                name: image.name,
                reference: { fileId, sourceNodeId: image.id, name: image.name },
            };
        });
        if (!assets.length) throw new Error(i18n.t("canvas.generation.errors.shortDramaAssetRequired"));
        return buildGenerationCommand({
            clientRequestId: input.clientRequestId,
            modelProfileId: input.profile.id,
            source: "video_workbench",
            intent: {
                kind: "video.short-drama",
                title,
                script: prompt,
                assets,
                settings: buildShortDramaGenerationSettings(input.profile, {
                    aspectRatio: normalizeSeedanceRatio(input.config.size) as "16:9" | "9:16",
                    resolution: normalizeSeedanceResolution(input.config.vquality) as "1080p",
                    durationSeconds: String(input.config.videoSeconds) === "-1" ? "auto" : normalizeSeedanceDuration(input.config.videoSeconds, input.profile.capabilities.settings.durationSeconds),
                    quality: input.config.quality as "standard" | "high",
                }),
            },
        });
    }

    return buildGenerationCommand({
        clientRequestId: input.clientRequestId,
        modelProfileId: input.profile.id,
        source: "video_workbench",
        intent: {
            kind: "video.generate",
            prompt,
            ...(input.config.videoNegativePrompt.trim() ? { negativePrompt: input.config.videoNegativePrompt.trim() } : {}),
            references: {
                images: input.references.map((image) => ({ fileId: platformFileID(image), sourceNodeId: image.id, name: image.name })),
                videos: input.videoReferences.map((video) => ({ fileId: platformFileID(video), sourceNodeId: video.id, name: video.name })),
                audios: input.audioReferences.map((audio) => ({ fileId: platformFileID(audio), sourceNodeId: audio.id, name: audio.name })),
            },
            settings: buildVideoGenerationSettings(input.profile, {
                videoMode: input.config.videoMode,
                aspectRatio: normalizeSeedanceRatio(input.config.size) as VideoGenerationSettings["aspectRatio"],
                resolution: normalizeSeedanceResolution(input.config.vquality) as VideoGenerationSettings["resolution"],
                durationSeconds: normalizeSeedanceDuration(input.config.videoSeconds, input.profile.capabilities.settings.durationSeconds),
                generateAudio: boolConfig(input.config.videoGenerateAudio, true),
                watermark: boolConfig(input.config.videoWatermark, false),
            }),
        },
    });
}

function platformFileID(reference: { fileId?: string; storageKey?: string; name: string }) {
    const fileId = reference.fileId || platformFileIDFromStorageKey(reference.storageKey);
    if (!fileId) throw new Error(i18n.t("errors.video.firstPartyReferenceNotUploaded", { name: reference.name }));
    return fileId;
}

function platformFileIDFromStorageKey(storageKey?: string) {
    return storageKey && !storageKey.includes(":") ? storageKey : "";
}

function readFileId(metadata: string) {
    try {
        const value = JSON.parse(metadata) as { fileIds?: unknown };
        return Array.isArray(value.fileIds) && typeof value.fileIds[0] === "string" ? value.fileIds[0] : "";
    } catch {
        return "";
    }
}
