type RefreshableAsset = {
    kind: string;
    data?: unknown;
};

type InsertableAsset =
    | { kind: "text"; title: string; data: { content: string } }
    | { kind: "image"; title: string; data: { dataUrl: string; storageKey?: string; fileId?: string; width?: number; height?: number } }
    | { kind: "video"; title: string; data: { url: string; storageKey?: string; fileId?: string; width?: number; height?: number } };

export function assetPreviewKind(kind: string, source: string) {
    if (!source) return "icon";
    return kind === "video" ? "video" : kind === "image" ? "image" : "icon";
}

export function assetInsertPayload(asset: InsertableAsset) {
    if (asset.kind === "text") return { kind: "text" as const, content: asset.data.content, title: asset.title };
    if (asset.kind === "image")
        return {
            kind: "image" as const,
            dataUrl: asset.data.dataUrl,
            title: asset.title,
            ...(asset.data.storageKey ? { storageKey: asset.data.storageKey } : {}),
            ...(asset.data.fileId ? { fileId: asset.data.fileId } : {}),
            ...(asset.data.width ? { width: asset.data.width } : {}),
            ...(asset.data.height ? { height: asset.data.height } : {}),
        };
    return {
        kind: "video" as const,
        url: asset.data.url,
        title: asset.title,
        ...(asset.data.storageKey ? { storageKey: asset.data.storageKey } : {}),
        ...(asset.data.fileId ? { fileId: asset.data.fileId } : {}),
        ...(asset.data.width ? { width: asset.data.width } : {}),
        ...(asset.data.height ? { height: asset.data.height } : {}),
    };
}

export function assetFileIdsToRefresh(open: boolean, assets: RefreshableAsset[]) {
    if (!open) return [];
    return [
        ...new Set(
            assets
                .filter((asset) => asset.kind === "image" || asset.kind === "video")
                .map((asset) => (asset.data as { fileId?: string } | undefined)?.fileId)
                .filter((fileId): fileId is string => Boolean(fileId)),
        ),
    ];
}
