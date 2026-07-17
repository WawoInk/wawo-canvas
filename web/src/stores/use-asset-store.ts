"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { resolveFileUrls } from "@/services/resolve-file-urls";
import { fetchAssetLibrary, saveAssetToLibrary, deleteAssetFromLibrary } from "@/services/api/assets";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; fileId?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; fileId?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    synced: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    removeAssetWithFile: (id: string, fileId: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => void;
    refreshAssetUrls: (ids: string[]) => Promise<void>;
    cleanupImages: (opts?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            synced: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const item = { ...asset, id, createdAt: now, updatedAt: now } as Asset;
                set((state) => ({ assets: [item, ...state.assets] }));
                void syncNewAssetToBackend(item);
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((a) => (a.id === id ? ({ ...a, ...patch, updatedAt: new Date().toISOString() } as Asset) : a)),
                })),
            removeAsset: (id) =>
                set((state) => ({
                    assets: state.assets.filter((a) => a.id !== id),
                })),
            removeAssetWithFile: async (id, fileId) => {
                try {
                    const token = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
                    const parsed = JSON.parse(token);
                    const tokenValue = parsed?.state?.token || "";
                    await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenValue}` } });
                    void deleteAssetFromLibrary(id).catch(() => {});
                } catch { /* network error */ }
                set((state) => ({
                    assets: state.assets.filter((a) => a.id !== id),
                }));
            },
            replaceAssets: (assets) => set({ assets }),
            refreshAssetUrls: async (ids) => {
                const urlMap = await resolveFileUrls(ids);
                if (!urlMap.size) return;
                set((state) => ({
                    assets: state.assets.map((asset) => {
                        // @ts-expect-error -- fileId only on image/video, guarded by kind below
                        const fileId = asset.data?.fileId;
                        const newUrl = fileId ? urlMap.get(fileId) : undefined;
                        if (!newUrl) return asset;
                        if (asset.kind === "image") {
                            return {
                                ...asset,
                                coverUrl: asset.coverUrl ? newUrl : asset.coverUrl,
                                data: { ...asset.data, dataUrl: newUrl },
                            };
                        }
                        if (asset.kind === "video") {
                            return { ...asset, coverUrl: asset.coverUrl || newUrl, data: { ...asset.data, url: newUrl } };
                        }
                        return asset;
                    }),
                }));
            },
            cleanupImages: (_opts) => {
                // ponytail: stub — cleanup logic was never implemented in original store.
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (state) => {
                useAssetStore.setState({ hydrated: true });
                // Sync from backend after rehydration (whether or not local data existed)
                if (state) void syncAssetsFromBackend();
            },
        },
    ),
);

// ── Backend sync ──

async function syncAssetsFromBackend() {
    const token = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
    let tokenValue = "";
    try { tokenValue = JSON.parse(token)?.state?.token || ""; } catch {}
    if (!tokenValue) {
        useAssetStore.setState({ synced: true });
        return;
    }
    try {
        const result = await fetchAssetLibrary({ pageSize: 500 });
        const remote = result.items.map(toLocalAsset);
        const local = useAssetStore.getState().assets;
        const merged = mergeAssets(local, remote);
        useAssetStore.setState({ assets: merged, synced: true });
        const fileIds = merged
            .filter((a): a is Asset & { data: { fileId: string } } => (a.kind === "image" || a.kind === "video") && Boolean((a.data as { fileId?: string }).fileId))
            .map((a) => (a.data as { fileId: string }).fileId);
        if (fileIds.length) void useAssetStore.getState().refreshAssetUrls(fileIds);
    } catch {
        useAssetStore.setState({ synced: true });
    }
}

async function syncNewAssetToBackend(asset: Asset) {
    try {
        const result = await saveAssetToLibrary(fromLocalAsset(asset) as Parameters<typeof saveAssetToLibrary>[0]);
        if (result.id && result.id !== asset.id) {
            useAssetStore.getState().updateAsset(asset.id, { id: result.id } as Partial<Asset>);
        }
    } catch { /* fire-and-forget */ }
}

function toLocalAsset(item: { id: string; type: string; title: string; coverUrl: string; tags: string[]; content?: string; url?: string; fileId?: string; width?: number; height?: number; bytes?: number; mimeType?: string; createdAt: string; updatedAt: string }): Asset {
    const base = {
        id: item.id,
        title: item.title,
        coverUrl: item.coverUrl || "",
        tags: item.tags || [],
        source: "",
        note: "",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
    if (item.type === "text") {
        return { ...base, kind: "text", data: { content: item.content || "" } } as TextAsset;
    }
    if (item.type === "image") {
        return { ...base, kind: "image", data: { dataUrl: item.url || "", fileId: item.fileId, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.mimeType || "image/png" } } as ImageAsset;
    }
    return { ...base, kind: "video", data: { url: item.url || "", fileId: item.fileId, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.mimeType || "video/mp4" } } as VideoAsset;
}

function fromLocalAsset(asset: Asset): Record<string, unknown> {
    const data = asset.data as Record<string, unknown>;
    return {
        id: asset.id,
        type: asset.kind,
        title: asset.title,
        coverUrl: asset.coverUrl || "",
        tags: asset.tags || [],
        content: asset.kind === "text" ? data.content : "",
        fileId: (asset.kind === "image" || asset.kind === "video") ? (data.fileId || "") : "",
        width: data.width || 0,
        height: data.height || 0,
        bytes: data.bytes || 0,
        mimeType: data.mimeType || "",
    };
}

function mergeAssets(local: Asset[], remote: Asset[]): Asset[] {
    const map = new Map<string, Asset>();
    for (const a of remote) map.set(a.id, a);
    for (const a of local) {
        const existing = map.get(a.id);
        if (!existing || new Date(a.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
            map.set(a.id, a);
        }
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
