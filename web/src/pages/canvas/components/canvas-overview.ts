type OverviewNode = {
    id: string;
    type: string;
    title: string;
    metadata?: { content?: string; prompt?: string; batchRootId?: string; groupId?: string };
};

export type OverviewTreeRow<T extends OverviewNode> = {
    node: T;
    depth: 0 | 1;
    hasChildren: boolean;
};

export function filterOverviewNodes<T extends OverviewNode>(nodes: T[], keyword: string, type: string) {
    const query = keyword.trim().toLowerCase();
    return nodes.filter((node) => !node.metadata?.batchRootId && (type === "all" || node.type === type) && (!query || `${node.title} ${node.metadata?.content || ""} ${node.metadata?.prompt || ""}`.toLowerCase().includes(query)));
}

export function buildOverviewTree<T extends OverviewNode>(nodes: T[], keyword: string, type: string, collapsedGroupIds: ReadonlySet<string>) {
    const filtered = filterOverviewNodes(nodes, keyword, type);
    const filteredIds = new Set(filtered.map((node) => node.id));
    const groupIds = new Set(nodes.filter((node) => node.type === "group" && !node.metadata?.batchRootId).map((node) => node.id));
    const children = new Map<string, T[]>();
    filtered.forEach((node) => {
        const groupId = node.metadata?.groupId;
        if (groupId && groupIds.has(groupId)) children.set(groupId, [...(children.get(groupId) || []), node]);
    });

    return nodes.flatMap<OverviewTreeRow<T>>((node) => {
        if (node.metadata?.batchRootId || (node.metadata?.groupId && groupIds.has(node.metadata.groupId))) return [];
        if (node.type !== "group") return filteredIds.has(node.id) ? [{ node, depth: 0, hasChildren: false }] : [];
        const groupChildren = children.get(node.id) || [];
        if (!filteredIds.has(node.id) && !groupChildren.length) return [];
        return [{ node, depth: 0, hasChildren: groupChildren.length > 0 }, ...(collapsedGroupIds.has(node.id) ? [] : groupChildren.map((child) => ({ node: child, depth: 1 as const, hasChildren: false })))];
    });
}

export function overviewPreviewKind(node: Pick<OverviewNode, "type" | "metadata">) {
    if (!node.metadata?.content) return "icon";
    return node.type === "video" ? "video" : node.type === "image" ? "image" : "icon";
}
