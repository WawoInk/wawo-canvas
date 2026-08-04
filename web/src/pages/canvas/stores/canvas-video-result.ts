import type { CanvasGenerationTaskStatus, CanvasNodeData } from "../types";
import { useCanvasStore } from "./use-canvas-store";

type CanvasVideoResultCommit = {
    projectId: string;
    nodeId: string;
    nodes: CanvasNodeData[];
    display: { width: number; height: number; preserveCenter?: boolean };
    file: {
        url: string;
        fileId: string;
        width?: number;
        height?: number;
        bytes?: number;
        mimeType: string;
        durationMs?: number;
    };
    generationTaskStatus?: CanvasGenerationTaskStatus;
};

export async function commitCanvasVideoResult({ projectId, nodeId, nodes, display, file, generationTaskStatus }: CanvasVideoResultCommit) {
    let sourceNodes = nodes;
    while (true) {
        const nextNodes = sourceNodes.map((node) => {
            if (node.id !== nodeId) return node;
            const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
            return {
                ...node,
                width: display.width,
                height: display.height,
                position: display.preserveCenter ? { x: center.x - display.width / 2, y: center.y - display.height / 2 } : node.position,
                metadata: {
                    ...node.metadata,
                    content: file.url,
                    storageKey: "",
                    fileId: file.fileId,
                    status: "success" as const,
                    errorDetails: undefined,
                    naturalWidth: file.width,
                    naturalHeight: file.height,
                    bytes: file.bytes,
                    mimeType: file.mimeType,
                    durationMs: file.durationMs,
                    ...(generationTaskStatus ? { generationTaskStatus } : {}),
                },
            };
        });
        await useCanvasStore.getState().updateProject(projectId, { nodes: nextNodes });
        const currentNodes = useCanvasStore.getState().openProject(projectId)?.nodes;
        if (!currentNodes || currentNodes === nextNodes) return nextNodes;
        sourceNodes = currentNodes;
    }
}
