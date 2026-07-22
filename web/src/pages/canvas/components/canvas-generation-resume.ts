type ResumableNode = { type: string; metadata?: { upstreamTaskId?: string; generationTaskId?: string; generationProfileId?: string; taskModel?: string } };

export function canvasGenerationResume(node?: ResumableNode) {
    const taskId = node?.metadata?.generationTaskId || node?.metadata?.upstreamTaskId;
    if (!node || !taskId) return null;
    const kind = node.type === "image" ? "image" : node.type === "video" && node.metadata?.generationProfileId ? "first-party-video" : node.type === "video" ? "video" : null;
    return kind ? { kind, taskId, model: node.metadata?.taskModel || "" } : null;
}
