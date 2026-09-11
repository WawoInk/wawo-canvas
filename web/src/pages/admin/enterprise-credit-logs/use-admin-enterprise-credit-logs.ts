"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { fetchAllPages } from "@/pages/account/account-log-export";
import { fetchAdminEnterpriseCreditLogs } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export type AdminEnterpriseCreditLogFilters = {
    enterpriseId: string;
    enterpriseName: string;
    model: string;
    status: string;
    dateRange: [Dayjs, Dayjs] | null;
};

export const emptyAdminEnterpriseCreditLogFilters: AdminEnterpriseCreditLogFilters = {
    enterpriseId: "",
    enterpriseName: "",
    model: "",
    status: "",
    dateRange: null,
};

export function useAdminEnterpriseCreditLogs() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [filters, setFilters] = useState<AdminEnterpriseCreditLogFilters>(emptyAdminEnterpriseCreditLogFilters);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);
    const startTime = filters.dateRange?.[0].startOf("day").toISOString();
    const endTime = filters.dateRange?.[1].endOf("day").toISOString();
    const queryParams = {
        enterprise_id: filters.enterpriseId || undefined,
        enterprise_name: filters.enterpriseName || undefined,
        model: filters.model || undefined,
        status: filters.status || undefined,
        start_time: startTime,
        end_time: endTime,
    };
    const query = useQuery({
        queryKey: ["admin", "enterprise-credit-logs", token, queryParams, page, pageSize],
        queryFn: () => fetchAdminEnterpriseCreditLogs(token, { ...queryParams, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (!query.isError) return;
        const errorMessage = query.error instanceof Error ? query.error.message : t("admin.enterpriseCreditLogs.messages.loadFailed");
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [clearSession, message, query.error, query.isError, t]);

    return {
        logs: query.data?.items || [],
        total: query.data?.total || 0,
        filters,
        page,
        pageSize,
        isLoading: query.isFetching,
        applyFilters: (value: AdminEnterpriseCreditLogFilters) => {
            setFilters(value);
            setPage(1);
        },
        resetFilters: () => {
            setFilters(emptyAdminEnterpriseCreditLogFilters);
            setPage(1);
            setPageSize(defaultPageSize);
        },
        changePage: setPage,
        changePageSize: (value: number) => {
            setPage(1);
            setPageSize(value);
        },
        refreshLogs: () => query.refetch(),
        fetchAll: () => fetchAllPages((nextPage, nextPageSize) => fetchAdminEnterpriseCreditLogs(token, { ...queryParams, page: nextPage, pageSize: nextPageSize })),
    };
}
