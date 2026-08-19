import axios from "axios";

import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { cancelAsyncImageTask, createAsyncImageEditTask, createAsyncImageTask, type AsyncImageTask, type AsyncImageTaskState } from "@/services/api/image";
import type { UploadResult } from "@/services/upload-blob";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

export const IMAGE_WORKBENCH_SOURCE = "image_workbench";
const MAX_CONSECUTIVE_QUERY_ERRORS = 20;

export type ImageWorkbenchTask = {
    source: typeof IMAGE_WORKBENCH_SOURCE;
    platformTaskId?: string;
    upstreamTask: AsyncImageTask;
};

export type ImageWorkbenchTaskStatus = "pending" | "succeeded" | "failed" | "cancelled";

export type ImageWorkbenchTaskRecord = {
    index: number;
    source: typeof IMAGE_WORKBENCH_SOURCE;
    upstreamTaskId?: string;
    taskModel?: string;
    platformTaskId?: string;
    status: ImageWorkbenchTaskStatus;
    images?: Array<{ dataUrl: string }>;
    fileId?: string;
    error?: string;
};

type ImageWorkbenchReferenceInput = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    storageKey?: string;
    fileId?: string;
};

type CompletionDependencies = {
    poll: () => Promise<AsyncImageTaskState>;
    materialize: (dataUrl: string) => Promise<UploadResult>;
    patchMetadata: (taskId: string, metadata: string) => Promise<unknown>;
    sleep?: () => Promise<void>;
    cancel?: (task: ImageWorkbenchTask) => Promise<void>;
    signal?: AbortSignal;
};

type RestoredImageWorkbenchSlot<T> = {
    index: number;
    status: "pending" | "success" | "failed";
    image?: T;
    error?: string;
};

export class ImageWorkbenchTaskRetryableError extends Error {
    constructor(public readonly cause: unknown) {
        super(cause instanceof Error ? cause.message : i18n.t("errors.image.taskQueryFailed"));
        this.name = "ImageWorkbenchTaskRetryableError";
    }
}

export function isImageWorkbenchTaskRetryableError(error: unknown): error is ImageWorkbenchTaskRetryableError {
    return error instanceof ImageWorkbenchTaskRetryableError;
}

export function imageWorkbenchTaskStatusForError(error: unknown, explicitlyCancelled = false): Exclude<ImageWorkbenchTaskStatus, "succeeded"> {
    if (isImageWorkbenchTaskRetryableError(error)) return "pending";
    return explicitlyCancelled ? "cancelled" : "failed";
}

export function upsertImageWorkbenchTaskRecord(records: ImageWorkbenchTaskRecord[], next: ImageWorkbenchTaskRecord) {
    const normalized = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as ImageWorkbenchTaskRecord;
    const index = records.findIndex((record) => record.index === next.index);
    if (index < 0) return [...records, normalized].sort((a, b) => a.index - b.index);
    return records.map((record, recordIndex) => (recordIndex === index ? normalized : record));
}

export function imageWorkbenchDeletionIds(log: { id: string; tasks?: Pick<ImageWorkbenchTaskRecord, "platformTaskId">[] }) {
    const platformTaskIds = [...new Set((log.tasks || []).map((task) => task.platformTaskId).filter((id): id is string => Boolean(id)))];
    return platformTaskIds.length ? platformTaskIds : [log.id];
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

export async function createImageWorkbenchTask(config: AiConfig, prompt: string, references: ReferenceImage[]): Promise<ImageWorkbenchTask> {
    const upstreamTask = references.length
        ? await createAsyncImageEditTask(config, prompt, references, 1, IMAGE_WORKBENCH_SOURCE)
        : await createAsyncImageTask(config, prompt, 1, IMAGE_WORKBENCH_SOURCE);
    return {
        source: IMAGE_WORKBENCH_SOURCE,
        platformTaskId: upstreamTask.platformTaskId,
        upstreamTask,
    };
}

export async function cancelImageWorkbenchTask(config: AiConfig, task: ImageWorkbenchTask) {
    const requestConfig = resolveModelRequestConfig(config, task.upstreamTask.model);
    const taskPath = `/tasks/${encodeURIComponent(task.upstreamTask.id)}/cancel`;
    if (config.channelMode !== "remote") {
        return cancelAsyncImageTask(config, task.upstreamTask);
    }

    const response = await axios.post(`/api/v1${taskPath}`, { model: requestConfig.model }, {
        headers: {
            "Content-Type": "application/json",
            ...(useUserStore.getState().token ? { Authorization: `Bearer ${useUserStore.getState().token}` } : {}),
        },
    });
    const body = response.data as { status?: string; data?: { status?: string } };
    const status = body.data?.status || body.status;
    if (status !== "cancelled") throw new Error(i18n.t("errors.image.generationFailed"));
}

export function imageWorkbenchTaskRecord(index: number, task: ImageWorkbenchTask): ImageWorkbenchTaskRecord {
    return {
        index,
        source: task.source,
        upstreamTaskId: task.upstreamTask.id,
        taskModel: task.upstreamTask.model,
        ...(task.platformTaskId ? { platformTaskId: task.platformTaskId } : {}),
        status: "pending",
        ...(task.upstreamTask.images ? { images: task.upstreamTask.images } : {}),
    };
}

export function resumableImageWorkbenchTasks(records: ImageWorkbenchTaskRecord[]) {
    return records.flatMap((record) => {
        if (record.source !== IMAGE_WORKBENCH_SOURCE || record.status !== "pending" || !record.upstreamTaskId || !record.taskModel) return [];
        const upstreamTask: AsyncImageTask = {
            id: record.upstreamTaskId,
            model: record.taskModel,
            ...(record.images ? { images: record.images } : {}),
        };
        return [
            {
                record,
                task: {
                    source: record.source,
                    ...(record.platformTaskId ? { platformTaskId: record.platformTaskId } : {}),
                    upstreamTask,
                },
            },
        ];
    });
}

export function restoreImageWorkbenchSlots<T extends { slotIndex?: number }>(records: ImageWorkbenchTaskRecord[], images: T[]): RestoredImageWorkbenchSlot<T>[] {
    const imagesByIndex = new Map(images.map((image, index) => [image.slotIndex ?? index, image]));
    return records
        .filter((record) => record.source === IMAGE_WORKBENCH_SOURCE)
        .sort((a, b) => a.index - b.index)
        .map((record) => {
            const image = imagesByIndex.get(record.index);
            if (record.status === "succeeded" && image) return { index: record.index, status: "success" as const, image };
            if (record.status !== "pending") return { index: record.index, status: "failed" as const, ...(record.error ? { error: record.error } : {}) };
            return { index: record.index, status: "pending" as const };
        });
}

export function imageWorkbenchReference(input: ImageWorkbenchReferenceInput): ReferenceImage {
    return {
        id: input.id,
        name: input.name,
        type: input.type,
        dataUrl: input.dataUrl,
        ...(input.fileId ? { fileId: input.fileId } : {}),
        ...(!input.fileId && input.storageKey ? { storageKey: input.storageKey } : {}),
    };
}

export async function completeImageWorkbenchTask(task: ImageWorkbenchTask, dependencies: CompletionDependencies): Promise<UploadResult> {
    const requestCancellation = async () => {
        try {
            await dependencies.cancel?.(task);
        } catch (error) {
            throw new ImageWorkbenchTaskRetryableError(error);
        }
    };

    if (dependencies.signal?.aborted) {
        await requestCancellation();
        throw new DOMException("Aborted", "AbortError");
    }

    const materialize = async (dataUrl: string) => {
        let stored: UploadResult;
        try {
            stored = await dependencies.materialize(dataUrl);
        } catch (error) {
            if (dependencies.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
            throw new ImageWorkbenchTaskRetryableError(error);
        }
        if (task.platformTaskId) {
            await dependencies.patchMetadata(task.platformTaskId, JSON.stringify({ fileIds: [stored.fileId] })).catch(() => {});
        }
        return stored;
    };

    const immediateImage = task.upstreamTask.images?.[0];
    if (immediateImage) return materialize(immediateImage.dataUrl);

    for (let attempt = 0, consecutiveErrors = 0; attempt < 360; ) {
        if (dependencies.signal?.aborted) {
            await requestCancellation();
            throw new DOMException("Aborted", "AbortError");
        }
        let state: AsyncImageTaskState;
        try {
            state = await dependencies.poll();
            consecutiveErrors = 0;
        } catch (error) {
            if (dependencies.signal?.aborted) {
                await requestCancellation();
                if (error instanceof DOMException && error.name === "AbortError") throw error;
                throw new DOMException("Aborted", "AbortError");
            }
            consecutiveErrors += 1;
            if (consecutiveErrors >= MAX_CONSECUTIVE_QUERY_ERRORS) throw new ImageWorkbenchTaskRetryableError(error);
            try {
                await (dependencies.sleep?.() ?? delay(5000, dependencies.signal));
            } catch (sleepError) {
                if (dependencies.signal?.aborted) {
                    await requestCancellation();
                    if (sleepError instanceof DOMException && sleepError.name === "AbortError") throw sleepError;
                    throw new DOMException("Aborted", "AbortError");
                }
                throw new ImageWorkbenchTaskRetryableError(sleepError);
            }
            continue;
        }
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "succeeded") {
            const image = state.images[0];
            if (!image) throw new Error(i18n.t("errors.image.taskSucceededWithoutImage"));
            return materialize(image.dataUrl);
        }
        attempt += 1;
        try {
            await (dependencies.sleep?.() ?? delay(5000, dependencies.signal));
        } catch (error) {
            if (!dependencies.signal?.aborted) throw error;
            await requestCancellation();
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new DOMException("Aborted", "AbortError");
        }
    }
    await requestCancellation();
    throw new Error(i18n.t("canvas.editor.errors.imageGenerationTimeout"));
}
