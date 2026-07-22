type OverviewNode = {
    id: string;
    type: string;
    title: string;
    metadata?: { content?: string; prompt?: string; batchRootId?: string };
};

export function filterOverviewNodes<T extends OverviewNode>(nodes: T[], keyword: string, type: string) {
    const query = keyword.trim().toLowerCase();
    return nodes.filter((node) => !node.metadata?.batchRootId && (type === "all" || node.type === type) && (!query || `${node.title} ${node.metadata?.content || ""} ${node.metadata?.prompt || ""}`.toLowerCase().includes(query)));
}

export function overviewPreviewKind(node: Pick<OverviewNode, "type" | "metadata">) {
    if (!node.metadata?.content) return "icon";
    return node.type === "video" ? "video" : node.type === "image" ? "image" : "icon";
}
