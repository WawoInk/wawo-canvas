"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { adjustAdminUserCredits, deleteAdminUser, fetchAdminUsers, saveAdminUser, type AdminUser } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminUsers() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "users", token, keyword, page, pageSize],
        queryFn: () => fetchAdminUsers(token, { keyword, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: (user: Partial<AdminUser> & { password?: string }) => saveAdminUser(token, user),
        onSuccess: async (_, user) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            message.success(t(user.id ? "admin.users.messages.saved" : "admin.users.messages.created"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("admin.common.messages.saveFailed")),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminUser(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            message.success(t("admin.users.messages.deleted"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("admin.common.messages.deleteFailed")),
    });

    const creditMutation = useMutation({
        mutationFn: ({ id, credits }: { id: string; credits: string }) => adjustAdminUserCredits(token, id, credits),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            message.success(t("admin.users.messages.creditsAdjusted"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("admin.common.messages.adjustFailed")),
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : t("admin.users.messages.loadFailed");
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError, t]);

    const updateFilters = (next: Partial<{ keyword: string; page: number; pageSize: number }>) => {
        const queryState = { keyword, page, pageSize, ...next };
        if (next.keyword !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = query.data;

    return {
        users: data?.items || [],
        keyword,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching || saveMutation.isPending || deleteMutation.isPending || creditMutation.isPending,
        searchUsers: (value = keyword) => updateFilters({ keyword: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", page: 1, pageSize: defaultPageSize }),
        refreshUsers: () => query.refetch(),
        saveUser: (user: Partial<AdminUser> & { password?: string }) => saveMutation.mutateAsync(user),
        adjustCredits: (id: string, credits: string) => creditMutation.mutateAsync({ id, credits }),
        deleteUser: (id: string) => deleteMutation.mutateAsync(id),
    };
}
