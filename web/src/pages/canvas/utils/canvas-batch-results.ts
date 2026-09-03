import type { CanvasNodeData } from "../types";

export function failCanvasBatchResult(nodes: CanvasNodeData[], nodeId: string, errorDetails: string, generationPollingPaused: boolean) {
    const rootId = nodes.find((node) => node.id === nodeId)?.metadata?.batchRootId;
    const updated = nodes.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: "error" as const, generationPollingPaused, errorDetails } } : node));
    if (!rootId) return updated;
    const root = updated.find((node) => node.id === rootId);
    const children = (root?.metadata?.batchChildIds || []).flatMap((id) => {
        const child = updated.find((node) => node.id === id);
        return child ? [child] : [];
    });
    const hasSuccess = children.some((child) => child.metadata?.status === "success" && child.metadata.content);
    const allFinished = children.length > 0 && children.every((child) => child.metadata?.status === "success" || child.metadata?.status === "error");
    return updated.map((node) => (node.id === rootId && allFinished && !hasSuccess ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails } } : node));
}
