"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { message } from "antd";

import { localForageStorage } from "@/lib/localforage-storage";
import { resolveFileUrls } from "@/services/resolve-file-urls";
import { saveAssetToLibrary, deleteAssetFromLibrary } from "@/services/api/assets";
import { ApiError } from "@/services/api/request";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";

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
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
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
            addAsset: async (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const item = { ...asset, id, createdAt: now, updatedAt: now } as Asset;
                try {
                    const result = await saveAssetToLibrary(fromLocalAsset(item) as Parameters<typeof saveAssetToLibrary>[0]);
                    // ponytail: 后端生成的 id 优先（id 与本地 nanoid 不同时）
                    const finalId = result.id || id;
                    const finalItem = { ...item, id: finalId };
                    set((state) => ({ assets: [finalItem, ...state.assets] }));
                    syncScheduler.markActivity();
                    return finalId;
                } catch {
                    message.error("创建资产失败，请检查网络连接");
                    throw new Error("创建资产失败");
                }
            },
            updateAsset: async (id, patch) => {
                const local = get().assets.find((a) => a.id === id);
                if (!local) return;
                try {
                    const body = {
                        ...fromLocalAsset({ ...local, ...patch } as Asset),
                        expectedUpdatedAt: local.updatedAt,
                    };
                    const result = await saveAssetToLibrary(body as unknown as Parameters<typeof saveAssetToLibrary>[0]);
                    // 用 API 返回的最新记录覆盖本地（可能包含服务端调整的字段）
                    set((state) => ({
                        assets: state.assets.map((a) => (a.id === id ? toLocalAsset(result) : a)),
                    }));
                    syncScheduler.markActivity();
                } catch (err) {
                    // 409 冲突：服务端版本已变更，触发全量同步拉取最新
                    if (err instanceof ApiError && err.status === 409) {
                        await syncClient.syncDomain("assets");
                        message.warning("资产已被其他会话修改，已刷新为最新版本");
                        return;
                    }
                    message.error("更新资产失败，请检查网络连接");
                    throw err;
                }
            },
            removeAsset: async (id) => {
                try {
                    await deleteAssetFromLibrary(id);
                    set((state) => ({
                        assets: state.assets.filter((a) => a.id !== id),
                    }));
                    syncScheduler.markActivity();
                } catch {
                    message.error("删除资产失败，请检查网络连接");
                    throw new Error("删除资产失败");
                }
            },
            removeAssetWithFile: async (id, fileId) => {
                try {
                    const token = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
                    const parsed = JSON.parse(token);
                    const tokenValue = parsed?.state?.token || "";
                    await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenValue}` } });
                } catch { /* 文件删除失败不影响素材删除 */ }
                try {
                    await deleteAssetFromLibrary(id);
                } catch { /* 素材删除失败仍走本地清理，下次同步会纠正 */ }
                set((state) => ({
                    assets: state.assets.filter((a) => a.id !== id),
                }));
                syncScheduler.markActivity();
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
                // 水合后：拉取最新服务端数据（API 是 source of truth）
                if (state) {
                    syncClient
                        .syncDomain("assets")
                        .then(() => useAssetStore.setState({ synced: true }))
                        .catch(() => useAssetStore.setState({ synced: true }));
                }
            },
        },
    ),
);

// ── Sync delta 回调：后台同步的增量数据直接覆盖本地缓存 ──
syncClient.onDelta("assets", (data) => {
    if (!data) return;

    // 应用 updates（upsert by id，按 updatedAt 倒序）
    if (data.updates && data.updates.length > 0) {
        const remote = data.updates.map((item) => toLocalAsset(item));
        const state = useAssetStore.getState();
        const map = new Map(state.assets.map((a) => [a.id, a]));
        for (const a of remote) map.set(a.id, a);
        const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        useAssetStore.setState({ assets: merged });
        // 刷新 S3 预签名 URL
        const fileIds = merged
            .filter((a): a is Asset & { data: { fileId: string } } => (a.kind === "image" || a.kind === "video") && Boolean((a.data as { fileId?: string }).fileId))
            .map((a) => (a.data as { fileId: string }).fileId);
        if (fileIds.length) {
            void useAssetStore.getState().refreshAssetUrls(fileIds);
        }
    }

    // 应用 deletes
    if (data.deletes && data.deletes.length > 0) {
        const deleteSet = new Set(data.deletes);
        useAssetStore.setState((state) => ({
            assets: state.assets.filter((a) => !deleteSet.has(a.id)),
        }));
    }
});

// ── 转换函数 ──
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