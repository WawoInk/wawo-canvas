export type EnterpriseIdentity = {
    role?: string;
    enterpriseId?: string;
    enterpriseRole?: "owner" | "member";
    enterpriseStatus?: "active" | "disabled";
};

export function enterpriseCapabilities(user?: EnterpriseIdentity | null) {
    const active = Boolean(user?.enterpriseId && user.enterpriseStatus === "active" && (user.enterpriseRole === "owner" || user.enterpriseRole === "member"));
    return {
        showSummary: active,
        canRename: active && user?.enterpriseRole === "owner",
        canManageMembers: active && user?.enterpriseRole === "owner",
        canAccessAssets: active,
        canManageAssets: active && user?.enterpriseRole === "owner",
    };
}
