import type { TFunction } from "i18next";

import { formatNumber } from "@/i18n/formatters";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function buildCanvasResourceReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], contextNodeId: string | null | undefined, t: TFunction) {
    const contextNodes = contextNodeId ? getMentionResourceNodes(contextNodeId, nodes, connections) : [];
    const globalReferences = labelResourceNodes(nodes.filter(isResourceNode), false, t);
    const activeByNodeId = new Map(labelResourceNodes(contextNodes, true, t).map((reference) => [reference.nodeId, reference]));
    return globalReferences.map((reference) => activeByNodeId.get(reference.nodeId) || reference);
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], t: TFunction) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true, t);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigInputNodes(nodeId, nodes, connections);
    if (configInputs.length) return expandResourceNodes(configInputs, nodes);
    const ownInputs = getContextInputNodes(nodeId, nodes, connections);
    if (ownInputs.length) return expandResourceNodes(ownInputs, nodes);
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigInputNodes(nodeId, nodes, connections);
    if (configInputs.length) return expandResourceNodes(configInputs, nodes);
    const ownInputs = getContextInputNodes(nodeId, nodes, connections);
    return expandResourceNodes(ownInputs, nodes);
}

function getContextInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isCanvasReferenceNode(node, nodes)));
}

function getConnectedConfigInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextInputNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function expandResourceNodes(inputNodes: CanvasNodeData[], nodes: CanvasNodeData[]) {
    const resources = inputNodes.flatMap((node) => (node.type === CanvasNodeType.Group ? getGroupResourceNodes(node.id, nodes) : [node]));
    return [...new Map(resources.map((node) => [node.id, node])).values()];
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.metadata?.groupId === groupId && isResourceNode(node));
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return isResourceNode(node) || (node.type === CanvasNodeType.Group && getGroupResourceNodes(node.id, nodes).length > 0);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean, t: TFunction) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const index = counts[kind]++;
        const label = t(`canvas.resources.labels.${kind}`, { index: formatNumber(index + 1, { useGrouping: false }) });
        return [{ id: node.id, nodeId: node.id, kind, label, title: node.title || label, previewUrl: node.metadata?.content, text: node.type === CanvasNodeType.Text ? node.metadata?.content || node.metadata?.prompt : undefined, active }];
    });
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    const hasVolcengineAsset = node.metadata?.materialSource === "volcengine" && Boolean(node.metadata.volcengineAssetId);
    if (node.type === CanvasNodeType.Image && (node.metadata?.content || hasVolcengineAsset)) return "image";
    if (node.type === CanvasNodeType.Video && (node.metadata?.content || hasVolcengineAsset)) return "video";
    if (node.type === CanvasNodeType.Audio && (node.metadata?.content || hasVolcengineAsset)) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    return null;
}
