type ResumableNode = { type: string; metadata?: { upstreamTaskId?: string; platformTaskId?: string; generationTaskId?: string; generationClientRequestId?: string; generationProfileId?: string; taskModel?: string; status?: string; fileId?: string } };

export function canvasGenerationResume(node?: ResumableNode) {
    if (node?.type === "video" && node.metadata?.status === "success" && node.metadata.fileId) return null;
    const taskId = node?.metadata?.generationTaskId || node?.metadata?.upstreamTaskId;
    const clientRequestId = node?.metadata?.generationClientRequestId || "";
    if (node?.type === "video" && node.metadata?.generationProfileId && (taskId || clientRequestId)) {
        return { kind: "first-party-video" as const, taskId: taskId || "", ...(clientRequestId ? { clientRequestId } : {}), model: node.metadata.taskModel || "" };
    }
    if (!node || !taskId) return null;
    const kind = node.type === "image" ? "image" : node.type === "video" ? "video" : null;
    return kind ? ({ kind, taskId, model: node.metadata?.taskModel || "", ...(node.metadata?.platformTaskId ? { platformTaskId: node.metadata.platformTaskId } : {}) } as const) : null;
}
