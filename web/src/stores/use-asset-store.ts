"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";

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
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    removeAssetWithFile: (id: string, fileId: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => void;
    refreshAssetUrls: (ids: string[]) => Promise<void>;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        // Don't cache presigned URLs across sessions — they'll be expired on rehydrate.
        // The UI will call refreshAssetUrls on mount to get fresh ones.
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => ({
                    assets: state.assets.filter((asset) => asset.id !== id),
                })),
            removeAssetWithFile: async (id, fileId) => {
                // Delete from S3 via API, then remove from local store
                try {
                    const token = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
                    const parsed = JSON.parse(token);
                    const tokenValue = parsed?.state?.token || "";
                    await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenValue}` } });
                } catch { /* network error — still remove from local */ }
                set((state) => ({
                    assets: state.assets.filter((asset) => asset.id !== id),
                }));
            },
            replaceAssets: (assets) => set({ assets }),
            refreshAssetUrls: async (ids) => {
                const token = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
                const parsed = JSON.parse(token);
                const tokenValue = parsed?.state?.token || "";
                const authHeader = { Authorization: `Bearer ${tokenValue}` };
                const updated = await Promise.all(
                    ids.map(async (fileId) => {
                        try {
                            const resp = await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, { headers: authHeader });
                            const json = await resp.json();
                            if (json.code === 0 && json.data?.s3Key) return { fileId, url: json.data.s3Key };
                        } catch { /* network error, skip */ }
                        return { fileId, url: null };
                    }),
                );
                const urlMap = new Map(updated.filter((u) => u.url).map((u) => [u.fileId, u.url as string]));
                if (!urlMap.size) return;
                set((state) => ({
                    assets: state.assets.map((asset) => {
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
                            return { ...asset, data: { ...asset.data, url: newUrl } };
                        }
                        return asset;
                    }),
                }));
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
