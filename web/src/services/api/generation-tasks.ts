import { apiDelete, apiGet, apiPost } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

// ─── DTO Types ──────────────────────────────────────────────────────

export type GenerationTaskStatus = "success" | "failed" | "pending";

export interface VideoHistoryItem {
    id: string;
    title: string;
    prompt: string;
    status: GenerationTaskStatus;
    model: string;
    upstreamTaskId: string;
    credits: number;
    durationMs: number;
    videoUrl?: string;
    thumbnailUrl?: string;
    size?: string;
    vquality?: string;
    videoSeconds?: string;
    genAudio?: string;
    watermark?: string;
    error?: string;
    createdAt: string;
}

export interface ImageHistoryItem {
    id: string;
    title: string;
    prompt: string;
    status: GenerationTaskStatus;
    model: string;
    credits: number;
    durationMs: number;
    imageUrls?: string[];
    quality?: string;
    size?: string;
    count?: string;
    error?: string;
    createdAt: string;
}

export interface GenerationTaskList<T> {
    items: T[];
    total: number;
}

export interface GenerationTaskDetail {
    task: {
        id: string;
        userId: string;
        taskType: string;
        provider: string;
        model: string;
        status: string;
        credits: number;
        latencyMs: number;
        upstreamTaskId: string;
        errorCode: string;
        errorMessage: string;
        createdAt: string;
        updatedAt: string;
    };
    payload?: {
        requestHeaders: string;
        requestBody: string;
        responseHeaders: string;
        responseBody: string;
        rawError: string;
    } | null;
}

// ─── API ────────────────────────────────────────────────────────────

function authToken() {
    return useUserStore.getState().token;
}

export async function fetchVideoHistory(page = 1, pageSize = 50): Promise<GenerationTaskList<VideoHistoryItem>> {
    return fetchGenerationHistory<VideoHistoryItem>("video", page, pageSize);
}

export async function fetchImageHistory(page = 1, pageSize = 50): Promise<GenerationTaskList<ImageHistoryItem>> {
    return fetchGenerationHistory<ImageHistoryItem>("image", page, pageSize);
}

export async function fetchGenerationHistory<T>(taskType: string, page = 1, pageSize = 50): Promise<GenerationTaskList<T>> {
    const token = authToken();
    const params = new URLSearchParams({ task_type: taskType, page: String(page), pageSize: String(pageSize) });
    return apiGet<GenerationTaskList<T>>(`/api/v1/generation-tasks?${params.toString()}`, undefined, token);
}

export async function fetchGenerationTaskDetail(taskId: string, includePayload = false): Promise<GenerationTaskDetail> {
    const token = authToken();
    const params = includePayload ? "?include_payload=true" : "";
    return apiGet<GenerationTaskDetail>(`/api/v1/generation-tasks/${taskId}${params}`, undefined, token);
}

export async function deleteGenerationTask(taskId: string): Promise<boolean> {
    const token = authToken();
    return apiDelete<boolean>(`/api/v1/generation-tasks/${encodeURIComponent(taskId)}`, token);
}

export interface RecordGenerationTaskRequest {
    taskType: string;
    provider: string;
    model: string;
    status: string;
    credits: number;
    latencyMs: number;
    upstreamTaskId?: string;
    requestBody: string;
    responseBody: string;
}

export async function recordGenerationTask(req: RecordGenerationTaskRequest): Promise<{
    id: string;
    userId: string;
    taskType: string;
    model: string;
    status: string;
}> {
    const token = authToken();
    return apiPost("/api/v1/generation-tasks", req, token);
}
