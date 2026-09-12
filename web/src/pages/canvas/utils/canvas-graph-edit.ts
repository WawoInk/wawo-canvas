import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";

type CanvasGraph = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type CanvasGraphEdit = { type: "connect"; id: string; firstNodeId: string; secondNodeId: string; firstHandleType: "source" | "target" } | { type: "delete"; nodeIds: Iterable<string> };

export function normalizeCanvasConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id || second.type === CanvasNodeType.Group) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

export function applyCanvasGraphEdit(graph: CanvasGraph, edit: CanvasGraphEdit) {
    if (edit.type === "connect") {
        const connection = normalizeCanvasConnection(edit.firstNodeId, edit.secondNodeId, graph.nodes, edit.firstHandleType);
        if (!connection || graph.connections.some((item) => item.fromNodeId === connection.fromNodeId && item.toNodeId === connection.toNodeId)) {
            return { ...graph, connection, deletedNodeIds: new Set<string>() };
        }
        return { ...graph, connections: [...graph.connections, { id: edit.id, ...connection }], connection, deletedNodeIds: new Set<string>() };
    }

    const deletedNodeIds = new Set(edit.nodeIds);
    graph.nodes.forEach((node) => {
        if (deletedNodeIds.has(node.id)) node.metadata?.batchChildIds?.forEach((id) => deletedNodeIds.add(id));
    });
    const deletedGroupIds = new Set(graph.nodes.filter((node) => deletedNodeIds.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
    const remainingNodes = graph.nodes.filter((node) => !deletedNodeIds.has(node.id));
    const nodes = remainingNodes.map((node) => {
        if (node.metadata?.groupId && deletedGroupIds.has(node.metadata.groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
        const childIds = node.metadata?.batchChildIds?.filter((id) => !deletedNodeIds.has(id));
        if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
        const currentPrimaryId = node.type === CanvasNodeType.Text ? node.metadata.primaryTextId : node.metadata.primaryImageId;
        const primaryId = childIds?.includes(currentPrimaryId || "") ? currentPrimaryId : childIds?.[0];
        const primaryNode = remainingNodes.find((item) => item.id === primaryId);
        return {
            ...node,
            metadata: {
                ...node.metadata,
                batchChildIds: childIds,
                ...(node.type === CanvasNodeType.Text ? { primaryTextId: primaryId } : { primaryImageId: primaryId }),
                content: primaryNode?.metadata?.content || node.metadata.content,
                ...(node.type === CanvasNodeType.Image
                    ? {
                          naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                          naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                      }
                    : {}),
            },
        };
    });
    return {
        nodes,
        connections: graph.connections.filter((connection) => !deletedNodeIds.has(connection.fromNodeId) && !deletedNodeIds.has(connection.toNodeId)),
        connection: null,
        deletedNodeIds,
    };
}
