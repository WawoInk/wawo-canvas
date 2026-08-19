import { cancelAsyncImageTask, createAsyncImageEditTask, createAsyncImageTask, type AsyncImageTask, type AsyncImageTaskState } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type ImageWorkbenchTask = {
    platformTaskId: string;
    upstreamTask: AsyncImageTask;
};

type MaterializedImage = {
    fileId: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type CompletionDependencies = {
    poll: () => Promise<AsyncImageTaskState>;
    materialize: (dataUrl: string) => Promise<MaterializedImage>;
    patchMetadata: (taskId: string, metadata: string) => Promise<unknown>;
    sleep?: () => Promise<void>;
    cancel?: () => Promise<void>;
    signal?: AbortSignal;
};

function responseHeader(headers: unknown, name: string) {
    if (!headers || typeof headers !== "object") return "";
    const value = "get" in headers && typeof headers.get === "function" ? headers.get(name) : (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : "";
}

export async function createImageWorkbenchTask(config: AiConfig, prompt: string, references: ReferenceImage[]): Promise<ImageWorkbenchTask> {
    const upstreamTask = references.length ? await createAsyncImageEditTask(config, prompt, references, 1, "image_workbench") : await createAsyncImageTask(config, prompt, 1, "image_workbench");
    return { platformTaskId: upstreamTask.platformTaskId || "", upstreamTask };
}

export async function completeImageWorkbenchTask(task: ImageWorkbenchTask, dependencies: CompletionDependencies): Promise<MaterializedImage> {
    for (let attempt = 0; attempt < 360; attempt += 1) {
        if (dependencies.signal?.aborted) {
            await dependencies.cancel?.();
            throw new DOMException("Aborted", "AbortError");
        }
        const state = await dependencies.poll();
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "succeeded") {
            const image = state.images[0];
            if (!image) throw new Error("Image task completed without a result");
            const stored = await dependencies.materialize(image.dataUrl);
            if (task.platformTaskId) {
                await dependencies.patchMetadata(task.platformTaskId, JSON.stringify({ fileIds: [stored.fileId] }));
            }
            return stored;
        }
        await (dependencies.sleep?.() ?? new Promise((resolve) => setTimeout(resolve, 5000)));
    }
    await dependencies.cancel?.();
    throw new Error("Image task polling timed out");
}
