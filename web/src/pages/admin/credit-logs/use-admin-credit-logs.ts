"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { deleteAdminCreditLog, fetchAdminCreditLogs, saveAdminCreditLog, type AdminCreditLog } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminCreditLogs() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "credit-logs", token, keyword, page, pageSize],
        queryFn: () => fetchAdminCreditLogs(token, { keyword, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: (log: Partial<AdminCreditLog>) => saveAdminCreditLog(token, log),
        onSuccess: async (_, log) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "credit-logs"] });
            message.success(t(log.id ? "admin.creditLogs.messages.saved" : "admin.creditLogs.messages.created"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("admin.common.messages.saveFailed")),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminCreditLog(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "credit-logs"] });
            message.success(t("admin.creditLogs.messages.deleted"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("admin.common.messages.deleteFailed")),
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : t("admin.creditLogs.messages.loadFailed");
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
        logs: data?.items || [],
        keyword,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching || saveMutation.isPending || deleteMutation.isPending,
        searchLogs: (value = keyword) => updateFilters({ keyword: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", page: 1, pageSize: defaultPageSize }),
        refreshLogs: () => query.refetch(),
        saveLog: (log: Partial<AdminCreditLog>) => saveMutation.mutateAsync(log),
        deleteLog: (id: string) => deleteMutation.mutateAsync(id),
    };
}
