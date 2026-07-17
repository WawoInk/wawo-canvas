type RefreshableAsset = {
    kind: string;
    data?: unknown;
};

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
