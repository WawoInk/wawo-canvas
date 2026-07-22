export type EnterpriseAssetQuery = {
    keyword: string;
    type: string;
    tag: string[];
    page: number;
    pageSize: number;
};

export const defaultEnterpriseAssetQuery: EnterpriseAssetQuery = { keyword: "", type: "", tag: [], page: 1, pageSize: 12 };

export function updateEnterpriseAssetQuery(current: EnterpriseAssetQuery, patch: Partial<EnterpriseAssetQuery>) {
    const next = { ...current, ...patch };
    if (patch.keyword !== undefined || patch.type !== undefined || patch.tag !== undefined || patch.pageSize !== undefined) next.page = 1;
    return next;
}

export function enterpriseAssetQueryKey(userID: string, enterpriseID: string, query: EnterpriseAssetQuery) {
    return ["enterprise-assets", userID, enterpriseID, query.keyword, query.type, query.tag, query.page, query.pageSize] as const;
}
