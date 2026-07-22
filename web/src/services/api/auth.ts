import { apiGet, apiPost, apiPut } from "@/services/api/request";

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
