"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { deleteAdminAsset, fetchAdminAssets, saveAdminAsset, type AdminAsset } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminAssets() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState("");
    const [tag, setTag] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "assets", token, keyword, type, tag, page, pageSize],
        queryFn: () => fetchAdminAssets(token, { keyword, type, tag, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: (asset: Partial<AdminAsset>) => saveAdminAsset(token, asset),
        onSuccess: async (_, asset) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
            message.success(t(asset.id ? "admin.assets.messages.saved" : "admin.assets.messages.created"));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.common.messages.saveFailed"));
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminAsset(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
            message.success(t("admin.assets.messages.deleted"));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.common.messages.deleteFailed"));
        },
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : t("admin.assets.messages.loadFailed");
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError, t]);

    const updateFilters = (next: Partial<{ keyword: string; type: string; tag: string[]; page: number; pageSize: number }>) => {
        const queryState = { keyword, type, tag, page, pageSize, ...next };
        if (next.keyword !== undefined || next.type !== undefined || next.tag !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setType(queryState.type);
        setTag(queryState.tag);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = query.data;

    return {
        assets: data?.items || [],
        tags: data?.tags || [],
        keyword,
        kind: type,
        tag,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching || saveMutation.isPending || deleteMutation.isPending,
        searchAssets: (value = keyword) => updateFilters({ keyword: value }),
        changeKind: (value: string) => updateFilters({ type: value, tag: [] }),
        changeTag: (value: string[]) => updateFilters({ tag: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", type: "", tag: [], page: 1, pageSize: defaultPageSize }),
        refreshAssets: () => query.refetch(),
        saveAsset: (asset: Partial<AdminAsset>) => saveMutation.mutateAsync(asset),
        deleteAsset: (id: string) => deleteMutation.mutateAsync(id),
    };
}
