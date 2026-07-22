import { apiDelete, apiGet, apiPost, apiPut, compactApiParams } from "@/services/api/request";

export type EnterpriseAsset = {
    id: string;
    userId: string;
    enterpriseId: string;
    creatorName: string;
    title: string;
    type: "text";
    tags: string[];
    category: string;
    description: string;
    content: string;
    createdAt: string;
    updatedAt: string;
};

export type EnterpriseAssetList = {
    items: EnterpriseAsset[];
    tags: string[];
    total: number;
};

export type EnterpriseAssetInput = Pick<EnterpriseAsset, "title" | "tags" | "description" | "content"> & { type: "text" };

export function fetchEnterpriseAssets(token: string, query: { keyword?: string; type?: string; tag?: string[]; page?: number; pageSize?: number } = {}) {
    return apiGet<EnterpriseAssetList>("/api/v1/enterprise/assets", compactApiParams(query), token);
}

export function createEnterpriseAsset(token: string, asset: EnterpriseAssetInput) {
    return apiPost<EnterpriseAsset>("/api/v1/enterprise/assets", asset, token);
}

export function updateEnterpriseAsset(token: string, id: string, asset: EnterpriseAssetInput) {
    return apiPut<EnterpriseAsset>(`/api/v1/enterprise/assets/${encodeURIComponent(id)}`, asset, token);
}

export function deleteEnterpriseAsset(token: string, id: string) {
    return apiDelete<{ id: string; deletedAt: string }>(`/api/v1/enterprise/assets/${encodeURIComponent(id)}`, token);
}
