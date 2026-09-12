import type { CanvasGenerationTaskStatus, CanvasNodeData } from "../types";
import { matchesCanvasReplicaBinding, type CanvasReplicaBinding } from "./canvas-replica";
import { useCanvasStore } from "./use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

type CanvasVideoResultCommit = {
    binding: CanvasReplicaBinding;
    nodeId: string;
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

type CanvasVideoResult = Pick<CanvasVideoResultCommit, "nodeId" | "display" | "file" | "generationTaskStatus">;

export function applyCanvasVideoResult(nodes: CanvasNodeData[], { nodeId, display, file, generationTaskStatus }: CanvasVideoResult) {
    let changed = false;
    const nextNodes = nodes.map((node) => {
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
    return changed ? nextNodes : nodes;
}

export async function commitCanvasVideoResult({ binding, nodeId, display, file, generationTaskStatus }: CanvasVideoResultCommit) {
    while (true) {
        const current = useCanvasStore.getState().openProject(binding.projectId);
        const auth = useUserStore.getState();
        if (!auth.user?.id || !matchesCanvasReplicaBinding(current, binding, { token: auth.token, userId: auth.user.id })) return current?.nodes || [];
        const sourceNodes = current.nodes;
        const nextNodes = applyCanvasVideoResult(sourceNodes, { nodeId, display, file, generationTaskStatus });
        if (nextNodes === sourceNodes) {
            await useCanvasStore.getState().waitForLocalPersistence();
            const persisted = useCanvasStore.getState().openProject(binding.projectId);
            const persistedAuth = useUserStore.getState();
            if (!persistedAuth.user?.id || !matchesCanvasReplicaBinding(persisted, binding, { token: persistedAuth.token, userId: persistedAuth.user.id })) return persisted?.nodes || [];
            if (persisted.nodes === sourceNodes) return sourceNodes;
            continue;
        }
        await useCanvasStore.getState().updateProject(binding.projectId, { nodes: nextNodes }, binding.remoteRevision);
        const persisted = useCanvasStore.getState().openProject(binding.projectId);
        const persistedAuth = useUserStore.getState();
        if (!persistedAuth.user?.id || !matchesCanvasReplicaBinding(persisted, binding, { token: persistedAuth.token, userId: persistedAuth.user.id })) return persisted?.nodes || [];
        if (persisted.nodes === nextNodes) return nextNodes;
    }
}
