import { apiGet, apiPost, apiPut, compactApiParams } from "@/services/api/request";

export const AUTH_TOKEN_KEY = "infinite-canvas-auth-token-v1";

export type UserRole = "guest" | "user" | "admin";

export type AuthUser = {
    id: string;
    username: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    role: UserRole;
    credits: number;
    enterpriseId?: string;
    enterpriseName?: string;
    enterpriseRole?: "owner" | "member";
    enterpriseStatus?: "active" | "disabled";
    createdAt: string;
    updatedAt: string;
};

export type AuthSession = {
    token: string;
    user: AuthUser;
};

export type AuthPayload = {
    username: string;
    password: string;
};

export type EnterpriseAccountSummary = {
    id: string;
    name: string;
    status: "active" | "disabled";
    role: "owner" | "member";
    memberCount: number;
};

export type EnterpriseMember = {
    id: string;
    username: string;
    email: string;
    displayName: string;
    status: "active" | "ban";
    credits: number;
    role: "user";
    enterpriseId: string;
    enterpriseRole: "member";
    createdAt: string;
    updatedAt: string;
};

export type EnterpriseMemberList = {
    items: EnterpriseMember[];
    total: number;
};

export type EnterpriseCreditAction = "allocate" | "reclaim";

export async function login(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/login", payload);
}

export async function register(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/register", payload);
}

export async function fetchCurrentUser(token?: string) {
    return apiGet<AuthUser>("/api/auth/me", undefined, token);
}

export async function updateAccountProfile(token: string, payload: { displayName: string; email: string }) {
    return apiPut<AuthUser>("/api/v1/account/profile", payload, token);
}

export async function changeAccountPassword(token: string, payload: { currentPassword: string; newPassword: string }) {
    return apiPost<boolean>("/api/v1/account/password", payload, token);
}

export async function fetchEnterpriseAccountSummary(token: string) {
    return apiGet<EnterpriseAccountSummary>("/api/v1/enterprise/summary", undefined, token);
}

export async function updateAccountEnterprise(token: string, name: string) {
    return apiPut<EnterpriseAccountSummary>("/api/v1/account/enterprise", { name }, token);
}

export async function fetchEnterpriseMembers(token: string, query: { keyword?: string; page?: number; pageSize?: number } = {}) {
    return apiGet<EnterpriseMemberList>("/api/v1/enterprise/members", compactApiParams(query), token);
}

export async function createEnterpriseMember(token: string, payload: { username: string; password: string; displayName?: string; email?: string }) {
    return apiPost<EnterpriseMember>("/api/v1/enterprise/members", payload, token);
}

export async function setEnterpriseMemberStatus(token: string, id: string, status: "active" | "ban") {
    return apiPost<EnterpriseMember>(`/api/v1/enterprise/members/${encodeURIComponent(id)}/status`, { status }, token);
}

export async function resetEnterpriseMemberPassword(token: string, id: string, password: string) {
    return apiPost<EnterpriseMember>(`/api/v1/enterprise/members/${encodeURIComponent(id)}/password`, { password }, token);
}

export async function transferEnterpriseMemberCredits(token: string, id: string, payload: { action: EnterpriseCreditAction; amount: number; requestId: string }) {
    return apiPost<{ requestId: string; action: EnterpriseCreditAction; amount: number; ownerCredits: number; member: EnterpriseMember }>(`/api/v1/enterprise/members/${encodeURIComponent(id)}/credits`, payload, token);
}
