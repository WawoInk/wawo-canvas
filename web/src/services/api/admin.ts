import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";
import type { DecimalValue } from "@/lib/decimal";
import type { Prompt, PromptListResponse } from "@/services/api/prompts";
import type { ImageResolutionOption, PublicNavigationSettings } from "@/services/api/settings";

export type AdminPromptCategory = {
    category: string;
    name: string;
    description: string;
    file: string;
    githubUrl: string;
    remote: boolean;
};

export type AdminUser = {
    id: string;
    username: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    role: "user" | "admin";
    credits: DecimalValue;
    affCode: string;
    affCount: number;
    inviterId: string;
    linuxDoId: string;
    status: "active" | "ban";
    enterpriseId?: string;
    enterpriseName?: string;
    enterpriseRole?: "owner" | "member";
    lastLoginAt: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminUserListResponse = {
    items: AdminUser[];
    total: number;
};

export type AdminEnterprise = {
    id: string;
    name: string;
    status: "active" | "disabled";
    ownerId: string;
    ownerName: string;
    ownerStatus: "active" | "ban";
    ownerCredits: DecimalValue;
    discountRate: DecimalValue;
    memberCount: number;
    createdAt: string;
    updatedAt: string;
};

export type CreateAdminEnterprise = {
    name: string;
    ownerUsername: string;
    ownerPassword: string;
    ownerDisplayName?: string;
};

export type AdminEnterpriseListResponse = {
    items: AdminEnterprise[];
    total: number;
};

export type AdminCreditLog = {
    id: string;
    userId: string;
    username?: string;
    type: string;
    amount: DecimalValue;
    balance: DecimalValue;
    relatedId: string;
    remark: string;
    extra: string;
    createdAt: string;
};

export type AdminCreditLogListResponse = {
    items: AdminCreditLog[];
    total: number;
};

export type AdminCreditLogQuery = {
    keyword?: string;
    type?: string;
    start_time?: string;
    end_time?: string;
    page?: number;
    pageSize?: number;
};

export type AdminCanvasNode = {
    userId: string;
    username: string;
    nodeId: string;
    upstreamTaskId: string;
    createdAt: string;
    resultUrl: string;
};

export type AdminCanvasNodeListResponse = {
    items: AdminCanvasNode[];
    total: number;
};

export type AdminCanvasNodeQuery = {
    user_id?: string;
    username?: string;
    node_id?: string;
    upstream_task_id?: string;
    start_time?: string;
    end_time?: string;
    page?: number;
    pageSize?: number;
};

export type AdminUserQuery = {
    keyword?: string;
    page?: number;
    pageSize?: number;
    type?: string;
};

export async function fetchAdminUsers(token: string, query: AdminUserQuery = {}) {
    return apiGet<AdminUserListResponse>("/api/admin/users", compactApiParams(query), token);
}

export async function fetchAdminEnterprises(token: string, query: AdminUserQuery = {}) {
    return apiGet<AdminEnterpriseListResponse>("/api/admin/enterprises", compactApiParams(query), token);
}

export async function createAdminEnterprise(token: string, enterprise: CreateAdminEnterprise) {
    return apiPost<AdminEnterprise>("/api/admin/enterprises", enterprise, token);
}

export async function setAdminEnterpriseStatus(token: string, id: string, status: AdminEnterprise["status"]) {
    return apiPost<AdminEnterprise>(`/api/admin/enterprises/${encodeURIComponent(id)}/status`, { status }, token);
}

export async function setAdminEnterpriseDiscountRate(token: string, id: string, discountRate: DecimalValue) {
    return apiPost<AdminEnterprise>(`/api/admin/enterprises/${encodeURIComponent(id)}/discount-rate`, { discountRate }, token);
}

export async function setAdminEnterpriseOwnerStatus(token: string, id: string, status: AdminEnterprise["ownerStatus"]) {
    return apiPost<AdminEnterprise>(`/api/admin/enterprises/${encodeURIComponent(id)}/owner/status`, { status }, token);
}

export async function resetAdminEnterpriseOwnerPassword(token: string, id: string, password: string) {
    return apiPost<AdminEnterprise>(`/api/admin/enterprises/${encodeURIComponent(id)}/owner/password`, { password }, token);
}

export async function adjustAdminEnterpriseCredits(token: string, id: string, delta: DecimalValue, reason: string) {
    return apiPost<AdminEnterprise>(`/api/admin/enterprises/${encodeURIComponent(id)}/credits`, { delta, reason }, token);
}

export async function saveAdminUser(token: string, user: Partial<AdminUser> & { password?: string }) {
    return apiPost<AdminUser>("/api/admin/users", user, token);
}

export async function adjustAdminUserCredits(token: string, id: string, credits: DecimalValue) {
    return apiPost<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/credits`, { credits }, token);
}

export async function deleteAdminUser(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/users/${encodeURIComponent(id)}`, token);
}

export async function fetchAdminCreditLogs(token: string, query: AdminCreditLogQuery = {}) {
    return apiGet<AdminCreditLogListResponse>("/api/admin/credit-logs", compactApiParams(query), token);
}

export async function fetchAdminCanvasNodes(token: string, query: AdminCanvasNodeQuery = {}) {
    return apiGet<AdminCanvasNodeListResponse>("/api/admin/canvas-nodes", compactApiParams(query), token);
}

export async function saveAdminCreditLog(token: string, log: Partial<AdminCreditLog>) {
    return apiPost<AdminCreditLog>("/api/admin/credit-logs", log, token);
}

export async function deleteAdminCreditLog(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/credit-logs/${encodeURIComponent(id)}`, token);
}

// ─── Generation Tasks ──────────────────────────────────────────────

export type AdminGenerationTask = {
    id: string;
    userId: string;
    username: string;
    taskType: string;
    provider: string;
    model: string;
    modelDisplayName?: string;
    status: string;
    credits: DecimalValue;
    upstreamCredits: DecimalValue | null;
    billingMode?: "per_credit" | "per_second" | "per_call";
    billingRate?: DecimalValue;
    latencyMs: number;
    upstreamTaskId: string;
    traceId: string;
    errorCode: string;
    errorMessage: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminGenerationTaskListResponse = {
    items: AdminGenerationTask[];
    total: number;
};

export type AdminGenerationTaskQuery = {
    user_id?: string;
    task_type?: string;
    status?: string;
    start_time?: string;
    end_time?: string;
    page?: number;
    pageSize?: number;
};

export type AdminGenerationTaskDetailResponse = {
    task: AdminGenerationTask;
    payload?: {
        requestHeaders: string;
        requestBody: string;
        responseHeaders: string;
        responseBody: string;
        rawError: string;
    } | null;
    canRepairRefund: boolean;
};

export async function fetchAdminGenerationTasks(token: string, query: AdminGenerationTaskQuery = {}) {
    return apiGet<AdminGenerationTaskListResponse>("/api/admin/generation-tasks", compactApiParams(query), token);
}

export async function fetchAdminGenerationTaskDetail(token: string, id: string) {
    return apiGet<AdminGenerationTaskDetailResponse>(`/api/admin/generation-tasks/${encodeURIComponent(id)}?include_payload=true`, undefined, token);
}

export async function refundAdminGenerationTask(token: string, id: string, reason: string) {
    return apiPost<boolean>(`/api/admin/generation-tasks/${encodeURIComponent(id)}/refund`, { reason }, token);
}

export async function deleteAdminGenerationTask(token: string, id: string): Promise<boolean> {
    return apiDelete<boolean>(`/api/admin/generation-tasks/${encodeURIComponent(id)}`, token);
}

export async function batchDeleteAdminGenerationTasks(token: string, ids: string[]): Promise<{ deleted: number }> {
    return apiPost<{ deleted: number }>("/api/admin/generation-tasks/batch-delete", { ids }, token);
}

export async function fetchAdminPromptCategories(token: string) {
    return apiGet<AdminPromptCategory[]>("/api/admin/prompt-categories", undefined, token);
}

export async function syncAdminPromptCategory(token: string, category: string) {
    return apiPost<AdminPromptCategory[]>("/api/admin/prompt-categories/sync", { category }, token);
}

export type AdminPromptQuery = {
    keyword?: string;
    category?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export type AdminAsset = {
    id: string;
    title: string;
    type: "text" | "image" | "video";
    coverUrl: string;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminAssetListResponse = {
    items: AdminAsset[];
    tags: string[];
    total: number;
};

export async function fetchAdminPrompts(token: string, query: AdminPromptQuery = {}) {
    return apiGet<PromptListResponse>("/api/admin/prompts", compactApiParams(query), token);
}

export async function saveAdminPrompt(token: string, prompt: Partial<Prompt>) {
    return apiPost<Prompt>("/api/admin/prompts", prompt, token);
}

export async function deleteAdminPrompt(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/prompts/${encodeURIComponent(id)}`, token);
}

export async function deleteAdminPrompts(token: string, ids: string[]) {
    return apiPost<boolean>("/api/admin/prompts/batch-delete", { ids }, token);
}

export type AdminAssetQuery = {
    keyword?: string;
    type?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export async function fetchAdminAssets(token: string, query: AdminAssetQuery = {}) {
    return apiGet<AdminAssetListResponse>("/api/admin/assets", compactApiParams(query), token);
}

export async function saveAdminAsset(token: string, asset: Partial<AdminAsset>) {
    return apiPost<AdminAsset>("/api/admin/assets", asset, token);
}

export async function deleteAdminAsset(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/assets/${encodeURIComponent(id)}`, token);
}

export type AdminModelChannel = {
    protocol: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    weight: number;
    enabled: boolean;
    remark: string;
};

export type AdminPublicModelChannelSettings = {
    availableModels: string[];
    modelCosts: AdminModelCost[];
    imageRequestFormats: AdminImageRequestFormat[];
    defaultModel: string;
    defaultImageModel: string;
    defaultVideoModel: string;
    defaultTextModel: string;
    defaultAudioModel: string;
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    textModelProtocols: Record<string, string>;
    audioModels: string[];
    systemPrompt: string;
    allowCustomChannel: boolean;
};

export type AdminImageRequestFormat = {
    model: string;
    format: "application/json" | "multipart/form-data" | "default";
    canvasRequestMode: "split" | "generations";
    resolutions: ImageResolutionOption[];
};

export type AdminModelCost = {
    model: string;
    displayName?: string;
    credits: DecimalValue;
    resolutionCredits?: Record<string, DecimalValue>;
};

export type AdminPublicSettings = {
    modelChannel: AdminPublicModelChannelSettings;
    auth: {
        allowRegister: boolean;
        linuxDo: {
            enabled: boolean;
        };
    };
    navigation: PublicNavigationSettings;
};

export type AdminGenerationProfileBinding = {
    id: string;
    profileId: string;
    upstreamModel: string;
    upstreamModels?: string[];
    channelName: string;
    billingMode: "per_credit" | "per_second" | "per_call";
    /** @deprecated Retained only for rollback-compatible settings round trips. */
    credits?: DecimalValue;
    enabled: boolean;
    limitOverrides: { durationSecondsMax?: number; resolutionValues?: string[] };
    metadata?: Record<string, string>;
};

export type AdminPrivateSettings = {
    channels: AdminModelChannel[];
    generationProfiles: AdminGenerationProfileBinding[] | null;
    promptSync: {
        enabled: boolean;
        cron: string;
    };
    auth: {
        linuxDo: {
            clientId: string;
            clientSecret: string;
        };
    };
    fileSizeLimits: {
        image: number;
        video: number;
        audio: number;
        prompt: number;
    };
};

export type AdminSettings = {
    public: AdminPublicSettings;
    private: AdminPrivateSettings;
};

export async function fetchAdminSettings(token: string) {
    return apiGet<AdminSettings>("/api/admin/settings", undefined, token);
}

export async function saveAdminSettings(token: string, settings: AdminSettings) {
    return apiPost<AdminSettings>("/api/admin/settings", settings, token);
}

export type AdminVolcengineAssetsConfig = {
    config: string;
};

export async function fetchAdminVolcengineAssetsConfig(token: string) {
    return apiGet<AdminVolcengineAssetsConfig>("/api/admin/volcengine-assets/config", undefined, token);
}

export async function saveAdminVolcengineAssetsConfig(token: string, config: string) {
    return apiPost<AdminVolcengineAssetsConfig>("/api/admin/volcengine-assets/config", { config }, token);
}

export type AdminChannelActionRequest = {
    index?: number;
    channel: AdminModelChannel;
    model?: string;
};

export async function fetchChannelModels(token: string, payload: AdminChannelActionRequest) {
    return apiPost<string[]>("/api/admin/settings/channel-models", payload, token);
}

export async function testChannelModel(token: string, payload: AdminChannelActionRequest) {
    return apiPost<string>("/api/admin/settings/channel-test", payload, token);
}
