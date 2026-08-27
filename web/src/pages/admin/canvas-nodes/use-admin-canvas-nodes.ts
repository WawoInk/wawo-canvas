"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { fetchAdminCanvasNodes } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;
type CanvasNodeDateRange = [Dayjs, Dayjs] | null;
type CanvasNodeFilters = { userId: string; username: string; nodeId: string; upstreamTaskId: string; dateRange: CanvasNodeDateRange };

export function useAdminCanvasNodes() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [filters, setFilters] = useState<CanvasNodeFilters>({ userId: "", username: "", nodeId: "", upstreamTaskId: "", dateRange: null });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);
    const startTime = filters.dateRange?.[0].startOf("day").toISOString();
    const endTime = filters.dateRange?.[1].endOf("day").toISOString();
    const query = useQuery({
        queryKey: ["admin", "canvas-nodes", token, filters.userId, filters.username, filters.nodeId, filters.upstreamTaskId, startTime, endTime, page, pageSize],
        queryFn: () => fetchAdminCanvasNodes(token, { user_id: filters.userId, username: filters.username, node_id: filters.nodeId, upstream_task_id: filters.upstreamTaskId, start_time: startTime, end_time: endTime, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (!query.isError) return;
        const errorMessage = query.error instanceof Error ? query.error.message : t("admin.canvasNodes.messages.loadFailed");
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [clearSession, message, query.error, query.isError, t]);

    const updateFilters = (next: Partial<CanvasNodeFilters>) => {
        setFilters((current) => ({ ...current, ...next }));
        setPage(1);
    };
    const data = query.data;

    return {
        nodes: data?.items || [],
        filters,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching,
        setFilters: updateFilters,
        changePage: setPage,
        changePageSize: (value: number) => {
            setPage(1);
            setPageSize(value);
        },
        resetFilters: () => {
            setFilters({ userId: "", username: "", nodeId: "", upstreamTaskId: "", dateRange: null });
            setPage(1);
            setPageSize(defaultPageSize);
        },
    };
}
