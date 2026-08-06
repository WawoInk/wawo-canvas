import { ApiError, apiGet, apiPost } from "./request";

import i18n from "@/i18n";
import { useUserStore } from "@/stores/use-user-store";
import {
    buildGenerationCommand,
    buildShortDramaGenerationSettings,
    buildVideoGenerationSettings,
    pollGenerationTask,
    type GenerationCommand,
    type GenerationProfile,
    type GenerationResult,
    type GenerationTaskStatus,
    type VideoGenerationSettings,
} from "./generation-contract";

export * from "./generation-contract";

export type FirstPartyGenerationTask = {
    id: string;
    status: GenerationTaskStatus;
    modelProfileId: string;
    intentKind: string;
    result?: GenerationResult;
    error?: GenerationError;
    createdAt: string;
};

export type GenerationError = {
    code: string;
    message: string;
    retryable: boolean;
    fieldPath?: string;
    resourceId?: string;
};

let profileCatalog: { token: string; promise: Promise<GenerationProfile[]> } | null = null;

export function getGenerationProfiles() {
    const token = useUserStore.getState().token || "";
    if (!profileCatalog || profileCatalog.token !== token) {
        profileCatalog = { token, promise: apiGet<GenerationProfile[]>("/api/v1/model-profiles", undefined, token) };
    }
    return profileCatalog.promise;
}

export function findGenerationProfile(profiles: GenerationProfile[], id?: string) {
    return profiles.find((profile) => profile.id === id);
}

export async function createGeneration(command: GenerationCommand) {
    return apiPost<FirstPartyGenerationTask>("/api/v1/generations", command, useUserStore.getState().token);
}

export async function getGeneration(taskId: string) {
    return apiGet<FirstPartyGenerationTask>(`/api/v1/generations/${encodeURIComponent(taskId)}`, undefined, useUserStore.getState().token);
}

export async function getGenerationByClientRequestId(clientRequestId: string) {
    const task = await apiGet<FirstPartyGenerationTask | null>(`/api/v1/generations/client-requests/${encodeURIComponent(clientRequestId)}`, undefined, useUserStore.getState().token);
    if (!task) throw new ApiError(i18n.t("errors.api.notFound"), 404, null);
    return task;
}

export async function cancelGeneration(taskId: string) {
    return apiPost<FirstPartyGenerationTask>(`/api/v1/generations/${encodeURIComponent(taskId)}/cancel`, undefined, useUserStore.getState().token);
}

export function retryableGenerationQueryError(error: unknown) {
    if (error instanceof Error && error.name === "AbortError") return false;
    if (!(error instanceof ApiError)) return true;
    return error.status === 200 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

export function readGenerationError(error: unknown): GenerationError | null {
    if (!(error instanceof ApiError) || !error.data || typeof error.data !== "object") return null;
    const data = error.data as Partial<Omit<GenerationError, "message">>;
    if (typeof data.code !== "string" || typeof data.retryable !== "boolean") return null;
    return {
        code: data.code,
        message: error.message,
        retryable: data.retryable,
        ...(typeof data.fieldPath === "string" ? { fieldPath: data.fieldPath } : {}),
        ...(typeof data.resourceId === "string" ? { resourceId: data.resourceId } : {}),
    };
}

export class GenerationTaskError extends Error {
    constructor(public readonly generationError: GenerationError) {
        super(generationError.message);
        this.name = "GenerationTaskError";
    }
}

export function generationErrorFrom(error: unknown): GenerationError | null {
    if (error instanceof GenerationTaskError) return error.generationError;
    return readGenerationError(error);
}

export async function waitForGeneration(taskId: string, signal?: AbortSignal, onStatus?: (task: FirstPartyGenerationTask) => void, clientRequestId = "") {
    const task = await pollGenerationTask(
        () => {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (taskId) return getGeneration(taskId);
            if (clientRequestId) return getGenerationByClientRequestId(clientRequestId);
            throw new ApiError(i18n.t("errors.api.notFound"), 404, null);
        },
        () =>
            new Promise<void>((resolve, reject) => {
                const timeout = window.setTimeout(resolve, 5000);
                signal?.addEventListener(
                    "abort",
                    () => {
                        window.clearTimeout(timeout);
                        reject(new DOMException("Aborted", "AbortError"));
                    },
                    { once: true },
                );
            }),
        onStatus,
        360,
        retryableGenerationQueryError,
    );
    if (task.status === "succeeded") return task;
    throw new GenerationTaskError(
        task.error || {
            code: task.status === "cancelled" ? "GENERATION_CANCELLED" : "GENERATION_FAILED",
            message: i18n.t(task.status === "cancelled" ? "errors.video.cancelled" : "errors.video.generationFailed"),
            retryable: false,
        },
    );
}

export { buildGenerationCommand, buildShortDramaGenerationSettings, buildVideoGenerationSettings };
export type { GenerationCommand, GenerationProfile, VideoGenerationSettings };
