import { fetchGenerationTaskDetail, type GenerationTaskDetail } from "@/services/api/generation-tasks";
import { createVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type VideoWorkbenchTask = {
    platformTaskId: string;
    upstreamTask: VideoGenerationTask;
};

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
    resolveFile: (fileId: string) => Promise<MaterializedVideo>;
    sleep?: () => Promise<void>;
};

function responseHeader(headers: unknown, name: string) {
    if (!headers || typeof headers !== "object") return "";
    const value = "get" in headers && typeof headers.get === "function" ? headers.get(name) : (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : "";
}

export async function createVideoWorkbenchTask(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]): Promise<VideoWorkbenchTask> {
    const upstreamTask = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, undefined, "video_workbench");
    return { platformTaskId: upstreamTask.platformTaskId || "", upstreamTask };
}

export async function completeVideoWorkbenchTask(task: VideoWorkbenchTask, dependencies: CompletionDependencies): Promise<MaterializedVideo> {
    if (!task.platformTaskId) throw new Error("Video task is missing its platform task ID");
    const pollTask = dependencies.pollTask || (() => fetchGenerationTaskDetail(task.platformTaskId));
    for (let attempt = 0; attempt < 360; attempt += 1) {
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

function readFileId(metadata: string) {
    try {
        const value = JSON.parse(metadata) as { fileIds?: unknown };
        return Array.isArray(value.fileIds) && typeof value.fileIds[0] === "string" ? value.fileIds[0] : "";
    } catch {
        return "";
    }
}
