import axios from "axios";

import { useUserStore } from "@/stores/use-user-store";

export type GenerationIntent = { kind: "video.generate"; prompt: string };
export type GenerationCommand = {
    commandVersion: 1;
    clientRequestId: string;
    modelProfileId: string;
    source: "canvas" | "image_workbench" | "video_workbench";
    intent: GenerationIntent;
};
export type FirstPartyGenerationTask = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    modelProfileId: string;
    intentKind: string;
    result?: { videoUrl: string };
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
};

type ApiEnvelope<T> = { code: number; data: T; msg: string };

export function buildGenerationCommand(input: { clientRequestId: string; modelProfileId: string; source: GenerationCommand["source"]; prompt: string }): GenerationCommand {
    return {
        commandVersion: 1,
        clientRequestId: input.clientRequestId,
        modelProfileId: input.modelProfileId,
        source: input.source,
        intent: { kind: "video.generate", prompt: input.prompt },
    };
}

function authHeaders() {
    const token = useUserStore.getState().token;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createGeneration(command: GenerationCommand) {
    const response = await axios.post<ApiEnvelope<FirstPartyGenerationTask>>("/api/v1/generations", command, { headers: { ...authHeaders(), "Content-Type": "application/json" } });
    return response.data.data;
}

export async function getGeneration(taskId: string) {
    const response = await axios.get<ApiEnvelope<FirstPartyGenerationTask>>(`/api/v1/generations/${encodeURIComponent(taskId)}`, { headers: authHeaders() });
    return response.data.data;
}

export async function waitForGeneration(taskId: string, signal?: AbortSignal) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const task = await getGeneration(taskId);
        if (task.status === "succeeded") return task;
        if (task.status === "failed" || task.status === "cancelled") throw new Error(task.errorMessage || `视频生成${task.status === "cancelled" ? "已取消" : "失败"}`);
        if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(resolve, 5000);
            signal?.addEventListener(
                "abort",
                () => {
                    window.clearTimeout(timeout);
                    reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
            );
        });
    }
    throw new Error("视频生成超时，请稍后重试");
}
