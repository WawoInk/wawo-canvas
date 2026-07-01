"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminGenerationTasks, fetchAdminGenerationTaskDetail, type AdminGenerationTask } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminGenerationTasks() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [taskType, setTaskType] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "generation-tasks", token, keyword, taskType, status, page, pageSize],
        queryFn: () => fetchAdminGenerationTasks(token, { user_id: keyword || undefined, task_type: taskType || undefined, status: status || undefined, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : "读取日志失败";
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError]);

    const updateFilters = (next: Partial<{ keyword: string; taskType: string; status: string; page: number; pageSize: number }>) => {
        const queryState = { keyword, taskType, status, page, pageSize, ...next };
        if (next.keyword !== undefined || next.taskType !== undefined || next.status !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setTaskType(queryState.taskType);
        setStatus(queryState.status);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = query.data;

    return {
        tasks: data?.items || [],
        keyword,
        taskType,
        status,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching,
        searchLogs: (value = keyword) => updateFilters({ keyword: value }),
        filterByType: (value: string) => updateFilters({ taskType: value }),
        filterByStatus: (value: string) => updateFilters({ status: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", taskType: "", status: "", page: 1, pageSize: defaultPageSize }),
        refreshLogs: () => query.refetch(),
        fetchDetail: async (id: string) => {
            try {
                return await queryClient.fetchQuery({
                    queryKey: ["admin", "generation-task-detail", token, id],
                    queryFn: () => fetchAdminGenerationTaskDetail(token, id),
                    staleTime: 60_000,
                });
            } catch {
                return null;
            }
        },
    };
}
