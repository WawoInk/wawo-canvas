import type { AsyncImageTask, AsyncImageTaskState } from "./image";
import type { UploadResult } from "@/services/upload-blob";
import i18n from "@/i18n";

const MAX_CONSECUTIVE_QUERY_ERRORS = 20;

export type AsyncImagePlatformTask = {
    platformTaskId?: string;
    upstreamTask: AsyncImageTask;
};

type CompletionDependencies = {
    poll: () => Promise<AsyncImageTaskState>;
    materialize: (dataUrl: string) => Promise<UploadResult>;
    patchMetadata: (taskId: string, metadata: string) => Promise<unknown>;
    sleep?: () => Promise<void>;
    cancel?: () => Promise<void>;
    signal?: AbortSignal;
};

export class AsyncImageTaskRetryableError extends Error {
    constructor(public readonly cause: unknown) {
        super(cause instanceof Error ? cause.message : i18n.t("errors.image.taskQueryFailed"));
        this.name = "AsyncImageTaskRetryableError";
    }
}

export function isAsyncImageTaskRetryableError(error: unknown): error is AsyncImageTaskRetryableError {
    return error instanceof AsyncImageTaskRetryableError;
}

export async function completeAsyncImageTask(task: AsyncImagePlatformTask, dependencies: CompletionDependencies): Promise<UploadResult> {
    const requestCancellation = async () => {
        try {
            await dependencies.cancel?.();
        } catch (error) {
            throw new AsyncImageTaskRetryableError(error);
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
            throw new AsyncImageTaskRetryableError(error);
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
            if (consecutiveErrors >= MAX_CONSECUTIVE_QUERY_ERRORS) throw new AsyncImageTaskRetryableError(error);
            await waitForNextPoll(true);
            continue;
        }
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "succeeded") {
            const image = state.images[0];
            if (!image) throw new Error(i18n.t("errors.image.taskSucceededWithoutImage"));
            return materialize(image.dataUrl);
        }
        attempt += 1;
        await waitForNextPoll(false);
    }
    await requestCancellation();
    throw new Error(i18n.t("canvas.editor.errors.imageGenerationTimeout"));

    async function waitForNextPoll(retryable: boolean) {
        try {
            await (dependencies.sleep?.() ?? delay(5000, dependencies.signal));
        } catch (error) {
            if (dependencies.signal?.aborted) {
                await requestCancellation();
                if (error instanceof DOMException && error.name === "AbortError") throw error;
                throw new DOMException("Aborted", "AbortError");
            }
            if (retryable) throw new AsyncImageTaskRetryableError(error);
            throw error;
        }
    }
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
