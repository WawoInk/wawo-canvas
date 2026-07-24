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
    fileIds?: string[];
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
    fileIds?: string[];
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

export interface GenerationTaskItem {
    id: string;
    taskType: string;
    source: string;
    provider: string;
    model: string;
    status: string;
    credits: number;
    latencyMs: number;
    upstreamTaskId: string;
    traceId: string;
    errorCode?: string;
    errorMessage?: string;
    metadata: string;
    intentKind?: string;
    createdAt: string;
    updatedAt: string;
}

export interface GenerationTaskDetail {
    task: GenerationTaskItem;
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

export async function fetchVideoHistory(page = 1, pageSize = 50, source?: string): Promise<GenerationTaskList<VideoHistoryItem>> {
    return fetchGenerationHistory<VideoHistoryItem>("video", page, pageSize, source);
}

export async function fetchImageHistory(page = 1, pageSize = 50, source?: string): Promise<GenerationTaskList<ImageHistoryItem>> {
    return fetchGenerationHistory<ImageHistoryItem>("image", page, pageSize, source);
}

export async function fetchGenerationTasks(page = 1, pageSize = 10): Promise<GenerationTaskList<GenerationTaskItem>> {
    return apiGet<GenerationTaskList<GenerationTaskItem>>(`/api/v1/generation-tasks?page=${page}&pageSize=${pageSize}`, undefined, authToken());
}

export async function fetchGenerationHistory<T>(taskType: string, page = 1, pageSize = 50, source?: string): Promise<GenerationTaskList<T>> {
    const token = authToken();
    const params = new URLSearchParams({ task_type: taskType, page: String(page), pageSize: String(pageSize) });
    if (source) {
        params.append("source", source);
    }
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

export async function patchGenerationTaskMetadata(taskId: string, metadata: string): Promise<boolean> {
    const token = authToken();
    return apiPost<boolean>(`/api/v1/generation-tasks/${encodeURIComponent(taskId)}/metadata`, { metadata }, token);
}

export interface RecordGenerationTaskRequest {
    taskType: string;
    provider: string;
    model: string;
    status: string;
    credits: number;
    latencyMs: number;
    upstreamTaskId?: string;
    source?: string;
    metadata?: string;
    requestBody: string;
    responseBody: string;
    errorMessage?: string;
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
