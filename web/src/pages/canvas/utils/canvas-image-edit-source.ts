type ImageReference = { id: string };
type ImageNode = { id: string; type: string; metadata?: { content?: string } };

export function findImageEditSourceNode<T extends ImageNode>(sourceNode: T | null | undefined, referenceImages: readonly ImageReference[], nodes: readonly T[]): T | null {
    if (sourceNode?.type === "image" && sourceNode.metadata?.content) return sourceNode;
    const referencedNodeIds = new Set(referenceImages.map((image) => image.id));
    return nodes.find((node) => referencedNodeIds.has(node.id) && node.type === "image" && node.metadata?.content) || null;
}
