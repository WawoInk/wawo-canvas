import { apiGet, apiPost, apiPostForm } from "@/services/api/request";

export const volcengineAssetTypes = ["Image", "Video", "Audio"] as const;

export type VolcengineAssetType = (typeof volcengineAssetTypes)[number];

export type VolcengineAssetOutbound = {
    id: string;
    name: string;
    format: string;
    project_name: string;
    group_type: string;
};

export type VolcengineAsset = {
    Id: string;
    Name: string;
    URL: string;
    GroupId: string;
    AssetType: VolcengineAssetType;
    Status: string;
    Error?: {
        Code?: string;
        Message?: string;
    };
    ProjectName: string;
    CreateTime: string;
    UpdateTime: string;
};

export type VolcengineAssetList = {
    Items?: VolcengineAsset[];
    TotalCount?: number;
    PageNumber?: number;
    PageSize?: number;
};

export type VolcengineAssetInput = {
    url: string;
    name: string;
    assetType: VolcengineAssetType;
};

export type VolcengineLocalAssetInput = Omit<VolcengineAssetInput, "url"> & {
    file: File;
};

function actionURL(action: "ListAssets" | "GetAsset" | "CreateAsset" | "UpdateAsset" | "DeleteAsset", outboundID: string) {
    return `/api/v1/doubao/open/${action}?outbound=${encodeURIComponent(outboundID)}`;
}

export function fetchVolcengineAssetOutbounds(token: string) {
    return apiGet<VolcengineAssetOutbound[]>("/api/v1/volcengine-assets/outbounds", undefined, token);
}

export function listVolcengineAssets(token: string, outboundID: string, page: number, pageSize: number, name = "") {
    return apiPost<VolcengineAssetList>(
        actionURL("ListAssets", outboundID),
        {
            PageNumber: page,
            PageSize: pageSize,
            Filter: name.trim() ? { Name: name.trim() } : undefined,
        },
        token,
    );
}

export function getVolcengineAsset(token: string, outboundID: string, id: string) {
    return apiPost<VolcengineAsset>(actionURL("GetAsset", outboundID), { Id: id }, token);
}

export function createVolcengineAsset(token: string, outboundID: string, input: VolcengineAssetInput) {
    return apiPost<VolcengineAsset>(
        actionURL("CreateAsset", outboundID),
        {
            URL: input.url.trim(),
            Name: input.name.trim(),
            AssetType: input.assetType,
        },
        token,
    );
}

export function uploadVolcengineAsset(token: string, outboundID: string, input: VolcengineLocalAssetInput) {
    const form = new FormData();
    form.set("file", input.file);
    form.set("name", input.name.trim());
    form.set("assetType", input.assetType);
    return apiPostForm<VolcengineAsset>(`/api/v1/volcengine-assets/upload?outbound=${encodeURIComponent(outboundID)}`, form, token);
}

export function updateVolcengineAsset(token: string, outboundID: string, id: string, name: string) {
    return apiPost<VolcengineAsset>(actionURL("UpdateAsset", outboundID), { Id: id, Name: name.trim() }, token);
}

export function deleteVolcengineAsset(token: string, outboundID: string, id: string) {
    return apiPost<void>(actionURL("DeleteAsset", outboundID), { Id: id }, token);
}
