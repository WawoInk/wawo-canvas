"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { fetchAdminCanvasNodes } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminCanvasNodes() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);
    const query = useQuery({
        queryKey: ["admin", "canvas-nodes", token, page, pageSize],
        queryFn: () => fetchAdminCanvasNodes(token, { page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (!query.isError) return;
        const errorMessage = query.error instanceof Error ? query.error.message : t("admin.canvasNodes.messages.loadFailed");
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [clearSession, message, query.error, query.isError, t]);

    const data = query.data;

    return {
        nodes: data?.items || [],
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching,
        changePage: setPage,
        changePageSize: (value: number) => {
            setPage(1);
            setPageSize(value);
        },
    };
}
