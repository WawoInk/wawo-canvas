import type { CanvasGenerationTaskStatus, CanvasNodeData } from "../types";
import { useCanvasStore } from "./use-canvas-store";

type CanvasVideoResultCommit = {
    projectId: string;
    expectedRemoteRevision?: number;
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

export async function commitCanvasVideoResult({ projectId, expectedRemoteRevision, nodeId, nodes, display, file, generationTaskStatus }: CanvasVideoResultCommit) {
    let sourceNodes = nodes;
    while (true) {
        const current = useCanvasStore.getState().openProject(projectId);
        if (!current || (expectedRemoteRevision !== undefined && (current.remoteRevision || 0) !== expectedRemoteRevision)) return current?.nodes || [];
        let changed = false;
        const nextNodes = sourceNodes.map((node) => {
            if (node.id !== nodeId) return node;
            const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
            const position = display.preserveCenter ? { x: center.x - display.width / 2, y: center.y - display.height / 2 } : node.position;
            const metadata = node.metadata || {};
            if (
                node.width === display.width &&
                node.height === display.height &&
                node.position.x === position.x &&
                node.position.y === position.y &&
                metadata.content === file.url &&
                metadata.storageKey === "" &&
                metadata.fileId === file.fileId &&
                metadata.status === "success" &&
                metadata.errorDetails === undefined &&
                metadata.naturalWidth === file.width &&
                metadata.naturalHeight === file.height &&
                metadata.bytes === file.bytes &&
                metadata.mimeType === file.mimeType &&
                metadata.durationMs === file.durationMs &&
                (!generationTaskStatus || metadata.generationTaskStatus === generationTaskStatus)
            )
                return node;
            changed = true;
            return {
                ...node,
                width: display.width,
                height: display.height,
                position,
                metadata: {
                    ...metadata,
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
        if (!changed) {
            await useCanvasStore.getState().waitForLocalPersistence();
            const currentNodes = useCanvasStore.getState().openProject(projectId)?.nodes;
            if (!currentNodes || currentNodes === sourceNodes) return sourceNodes;
            sourceNodes = currentNodes;
            continue;
        }
        await useCanvasStore.getState().updateProject(projectId, { nodes: nextNodes }, expectedRemoteRevision);
        const currentNodes = useCanvasStore.getState().openProject(projectId)?.nodes;
        if (!currentNodes || currentNodes === nextNodes) return nextNodes;
        sourceNodes = currentNodes;
    }
}
