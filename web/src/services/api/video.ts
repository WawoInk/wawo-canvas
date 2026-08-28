import axios from "axios";

import { getMediaBlob, uploadMediaFile, type UploadedFile, imageToDataUrl } from "@/services/blob-storage";
import { boolConfig, buildSeedancePromptText, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";

type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};
type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };
type RequestOptions = { signal?: AbortSignal };

function responseHeader(headers: unknown, name: string) {
    if (!headers || typeof headers !== "object") return "";
    const value = "get" in headers && typeof headers.get === "function" ? headers.get(name) : (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : "";
}

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; model: string; platformTaskId?: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function aiHeaders(config: AiConfig, contentType?: string) {
    const token = useUserStore.getState().token;
    return config.channelMode === "remote"
        ? {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          }
        : {
              Authorization: `Bearer ${config.apiKey}`,
              ...(contentType ? { "Content-Type": contentType } : {}),
          };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(i18n.t("errors.video.timeout"));
        await delay(5000, options?.signal);
    }
    throw new Error(i18n.t("errors.video.timeout"));
}

export async function createVideoGenerationTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
    source?: string,
): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    const payload = await buildVideoGenerationPayload(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences);

    try {
        const headers: Record<string, string> = { ...aiHeaders(requestConfig, "application/json") };
        if (source) headers["X-Source"] = source;
        const response = await axios.post<ApiEnvelope<SeedanceTask>>(videoTaskApiUrl(requestConfig), payload, { headers, signal: options?.signal });
        const created = unwrapSeedanceTask(response.data);
        if (!created.id) throw new Error(i18n.t("errors.video.missingTaskId"));
        const platformTaskId = responseHeader(response.headers, "x-generation-task-id");
        return platformTaskId ? { id: created.id, model: selectedModel, platformTaskId } : { id: created.id, model: selectedModel };
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.video.createTaskFailed")));
    }
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    try {
        const state = unwrapSeedanceTask(
            (
                await axios.get<ApiEnvelope<SeedanceTask>>(videoTaskApiUrl(requestConfig, task.id), {
                    headers: aiHeaders(requestConfig),
                    params: { model: modelOptionName(task.model) },
                    signal: options?.signal,
                })
            ).data,
        );
        if (state.status === "succeeded") {
            const url = state.content?.video_url;
            if (!url) return { status: "failed", error: i18n.t("errors.video.succeededWithoutUrl") };
            return { status: "completed", result: await videoResultFromUrl(url, options) };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: videoTaskFailureMessage(state) };
        return { status: "pending" };
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409) return { status: "pending" };
        throw new Error(readAxiosError(error, i18n.t("errors.video.queryTaskFailed")));
    }
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        // ponytail: proxy through backend; Volces TOS presigned URLs lack CORS headers
        const { uploadUrlToS3 } = await import("@/services/upload-blob");
        const s3 = await uploadUrlToS3(result.url, "results/videos");
        return { url: s3.url, storageKey: s3.fileId, bytes: s3.bytes, mimeType: s3.mimeType || result.mimeType || "video/mp4", width: s3.width, height: s3.height, durationMs: s3.durationMs };
    }
    throw new Error(i18n.t("errors.video.noPlayableVideo"));
}

function videoTaskApiUrl(config: AiConfig, taskId?: string) {
    const path = `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

export async function buildVideoGenerationPayload(config: AiConfig, selectedModel: string, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = []) {
    if (audioReferences.length && !references.length && !videoReferences.length) throw new Error(i18n.t("errors.video.audioRequiresVisual"));
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error(i18n.t("errors.video.promptOrReferenceRequired"));
    const negativePrompt = config.videoNegativePrompt.trim();
    if (negativePrompt.length > 500) throw new Error(i18n.t("errors.video.negativePromptTooLong"));
    return {
        model: modelOptionName(selectedModel),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(selectedModel)),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
        ...(negativePrompt ? { metadata: { extra_params: { negative_prompt: negativePrompt } } } : {}),
    };
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

function assetReferenceUrl(assetId?: string) {
    return assetId ? `asset://${assetId}` : "";
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const assetUrl = assetReferenceUrl(image.assetId);
    if (assetUrl) return assetUrl;
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(i18n.t("errors.video.readReferenceImageFailed"));
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    const assetUrl = assetReferenceUrl(video.assetId);
    if (assetUrl) return assetUrl;
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error(i18n.t("errors.video.invalidReferenceVideo"));
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    const assetUrl = assetReferenceUrl(audio.assetId);
    if (assetUrl) return assetUrl;
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error(i18n.t("errors.video.invalidReferenceAudio"));
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(i18n.t("errors.config.videoModelRequired"));
    if (config.channelMode !== "remote") {
        if (!config.baseUrl.trim()) throw new Error(i18n.t("errors.config.baseUrlRequired"));
        if (!config.apiKey.trim()) throw new Error(i18n.t("errors.config.apiKeyRequired"));
    }
    if (config.apiFormat === "gemini") throw new Error(i18n.t("errors.video.geminiUnsupported"));
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, i18n.t("errors.video.noTaskReturned"));
}

function providerVideoFailureMessage(code?: string, message?: string) {
    const text = `${code || ""} ${message || ""}`.toLowerCase();
    if (text.includes("asset://") || text.includes("asset_reference")) return message || code || "";
    if (text.includes("timeout") || text.includes("timed out") || text.includes("deadline") || text.includes("expired")) return i18n.t("errors.video.failureReasons.timeout");
    if (text.includes("rate limit") || text.includes("rate_limit") || text.includes("too many requests") || text.includes("over quota")) return i18n.t("errors.video.failureReasons.rateLimited");
    if (text.includes("unauthorized") || text.includes("authentication") || text.includes("invalid api key") || text.includes("invalid_api_key")) return i18n.t("errors.video.failureReasons.upstreamAuthFailed");
    if (text.includes("forbidden") || text.includes("permission denied") || text.includes("access denied") || text.includes("access_denied")) return i18n.t("errors.video.failureReasons.upstreamPermissionDenied");
    if (text.includes("sensitive") || text.includes("content policy") || text.includes("moderation") || text.includes("safety") || text.includes("privacy") || text.includes("nsfw") || text.includes("prohibited"))
        return i18n.t("errors.video.failureReasons.contentRejected");
    if (text.includes("invalid") || text.includes("parameter") || text.includes("argument") || text.includes("unsupported") || text.includes("too long") || text.includes("too short") || text.includes("required"))
        return i18n.t("errors.video.failureReasons.invalidRequest");
    if (text.includes("unavailable") || text.includes("overloaded") || text.includes("internal error") || text.includes("connection")) return i18n.t("errors.video.failureReasons.upstreamUnavailable");
    return "";
}

function videoTaskFailureMessage(task: SeedanceTask) {
    if (task.status === "expired") return i18n.t("errors.video.failureReasons.expired");
    if (task.status === "cancelled") return i18n.t("errors.video.cancelled");
    const providerReason = providerVideoFailureMessage(task.error?.code, task.error?.message);
    if (providerReason) return providerReason;
    return task.error?.message || i18n.t("errors.video.generationFailed");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || i18n.t("errors.requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return i18n.t("errors.requestCancelled");
    if (axios.isAxiosError<{ error?: { code?: string; message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        const statusError = statusMessage(error.response?.status);
        if (statusError) return statusError;
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return i18n.t("errors.video.failureReasons.requestTimeout");
        if (!error.response || error.code === "ERR_NETWORK" || error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || error.code === "EHOSTUNREACH") return i18n.t("errors.video.failureReasons.upstreamUnavailable");
        const providerReason = providerVideoFailureMessage(responseData?.error?.code, responseData?.error?.message);
        if (providerReason) return providerReason;
        return concreteVideoServiceError(responseData?.error?.message || responseData?.msg, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return i18n.t("errors.requestCancelled");
    return concreteVideoServiceError(error instanceof Error ? error.message : "", fallback);
}

function concreteVideoServiceError(message: string | undefined, fallback: string) {
    const normalized = (message || "").trim().toLowerCase();
    if (normalized === "后端服务未启用" || normalized === "backend service is not enabled") return i18n.t("errors.video.failureReasons.serviceDisabled");
    if (normalized === "后端服务失败" || normalized === "backend service failed") return i18n.t("errors.video.failureReasons.serviceFailed");
    if (normalized === "操作失败" || normalized === "operation failed") return fallback;
    return message || fallback;
}

function statusMessage(status: number | undefined) {
    if (status === 401) return i18n.t("errors.video.failureReasons.upstreamAuthFailed");
    if (status === 403) return i18n.t("errors.video.failureReasons.upstreamPermissionDenied");
    if (status === 404) return i18n.t("errors.video.failureReasons.upstreamNotFound");
    if (status === 408 || status === 504) return i18n.t("errors.video.failureReasons.requestTimeout");
    if (status === 429) return i18n.t("errors.video.failureReasons.rateLimited");
    if (status === 502 || status === 503) return i18n.t("errors.video.failureReasons.upstreamUnavailable");
    if (status && status >= 500) return i18n.t("errors.video.failureReasons.serviceFailed");
    return "";
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || i18n.t("errors.video.downloadFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("errors.video.readLocalAssetFailed")));
        reader.readAsDataURL(blob);
    });
}

export async function cancelVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<void> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    try {
        await axios.delete(videoTaskApiUrl(requestConfig, task.id), {
            headers: aiHeaders(requestConfig),
            params: { model: modelOptionName(task.model) },
            signal: options?.signal,
        });
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.video.cancelFailed")));
    }
}

export async function remixVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, newPrompt: string, options?: RequestOptions): Promise<VideoGenerationTask> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    const payload = {
        model: modelOptionName(task.model),
        prompt: newPrompt,
    };
    try {
        const created = unwrapSeedanceTask(
            (
                await axios.post<ApiEnvelope<SeedanceTask>>(videoTaskApiUrl(requestConfig, task.id) + "/remix", payload, {
                    headers: aiHeaders(requestConfig, "application/json"),
                    signal: options?.signal,
                })
            ).data,
        );
        if (!created.id) throw new Error(i18n.t("errors.video.missingTaskId"));
        return { id: created.id, model: task.model };
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.video.remixFailed")));
    }
}
