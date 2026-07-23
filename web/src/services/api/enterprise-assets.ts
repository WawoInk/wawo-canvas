import { apiDelete, apiGet, apiPost, apiPut, compactApiParams } from "@/services/api/request";

export type EnterpriseAssetType = "text" | "image" | "video";

export type EnterpriseAsset = {
    id: string;
    userId: string;
    enterpriseId: string;
    creatorName: string;
    title: string;
    type: EnterpriseAssetType;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    fileId: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    createdAt: string;
    updatedAt: string;
};

export type EnterpriseAssetList = {
    items: EnterpriseAsset[];
    tags: string[];
    total: number;
};

export type EnterpriseAssetInput = Pick<EnterpriseAsset, "title" | "type" | "tags" | "description" | "content"> & Partial<Pick<EnterpriseAsset, "fileId" | "width" | "height" | "bytes" | "mimeType">>;

export type EnterpriseFile = {
    id: string;
    userId: string;
    enterpriseId: string;
    fileType: "images" | "videos";
    url: string;
    originalName: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
};

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

export function uploadEnterpriseFile(token: string, fileType: EnterpriseFile["fileType"], file: File) {
    return submitEnterpriseFile(token, "/api/v1/enterprise/files", "POST", fileType, file);
}

export function replaceEnterpriseFile(token: string, id: string, fileType: EnterpriseFile["fileType"], file: File) {
    return submitEnterpriseFile(token, `/api/v1/enterprise/files/${encodeURIComponent(id)}`, "PUT", fileType, file);
}

export function deleteEnterpriseFile(token: string, id: string) {
    return apiDelete<boolean>(`/api/v1/enterprise/files/${encodeURIComponent(id)}`, token);
}

export async function downloadEnterpriseFile(token: string, id: string) {
    let response: Response;
    try {
        response = await fetch(`/api/v1/enterprise/files/${encodeURIComponent(id)}/content`, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
        throw new Error("接口连接失败，请确认后端服务已启动");
    }
    if (response.headers.get("content-type")?.includes("application/json")) {
        const result = (await response.json()) as { msg?: string };
        throw new Error(result.msg || "下载失败");
    }
    if (!response.ok) throw new Error("下载失败");
    return response.blob();
}

async function submitEnterpriseFile(token: string, url: string, method: "POST" | "PUT", fileType: EnterpriseFile["fileType"], file: File) {
    const form = new FormData();
    form.set("fileType", fileType);
    form.set("file", file);
    let response: Response;
    try {
        response = await fetch(url, { method, body: form, headers: { Authorization: `Bearer ${token}` } });
    } catch {
        throw new Error("接口连接失败，请确认后端服务已启动");
    }
    const result = (await response.json()) as { code: number; data: EnterpriseFile; msg: string };
    if (!response.ok || result.code !== 0) throw new Error(result.msg || "文件上传失败");
    return result.data;
}
