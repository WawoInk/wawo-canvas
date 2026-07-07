import { apiGet, compactApiParams, apiPost, apiDelete } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

export type AssetLibraryItem = {
    id: string;
    userId: string;
    title: string;
    type: "text" | "image" | "video";
    coverUrl: string;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    fileId?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    createdAt: string;
    updatedAt: string;
};

export type AssetLibraryResponse = {
    items: AssetLibraryItem[];
    tags: string[];
    total: number;
};

export type AssetLibraryQuery = {
    keyword?: string;
    type?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

function authToken() {
    return useUserStore.getState().token;
}

export async function fetchAssetLibrary(query: AssetLibraryQuery = {}) {
    return apiGet<AssetLibraryResponse>("/api/v1/assets", compactApiParams(query), authToken());
}

export async function saveAssetToLibrary(asset: Partial<AssetLibraryItem> & { type: string; title: string }) {
    return apiPost<AssetLibraryItem>("/api/v1/assets", asset, authToken());
}

export async function deleteAssetFromLibrary(id: string) {
    return apiDelete<null>(`/api/v1/assets/${encodeURIComponent(id)}`, authToken());
}
