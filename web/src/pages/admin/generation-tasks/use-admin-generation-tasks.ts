"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { formatNumber } from "@/i18n/formatters";
import { batchDeleteAdminGenerationTasks, deleteAdminGenerationTask, fetchAdminGenerationTaskDetail, fetchAdminGenerationTasks, refundAdminGenerationTask, type AdminGenerationTask } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;
type LogDateRange = [Dayjs, Dayjs] | null;

export function useAdminGenerationTasks() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [taskType, setTaskType] = useState("");
    const [status, setStatus] = useState("");
    const [dateRange, setDateRange] = useState<LogDateRange>(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);
    const startTime = dateRange?.[0].startOf("day").toISOString();
    const endTime = dateRange?.[1].endOf("day").toISOString();

    const query = useQuery({
        queryKey: ["admin", "generation-tasks", token, keyword, taskType, status, startTime, endTime, page, pageSize],
        queryFn: () => fetchAdminGenerationTasks(token, { user_id: keyword || undefined, task_type: taskType || undefined, status: status || undefined, start_time: startTime, end_time: endTime, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : t("admin.generationTasks.messages.loadFailed");
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError, t]);

    const updateFilters = (next: Partial<{ keyword: string; taskType: string; status: string; dateRange: LogDateRange; page: number; pageSize: number }>) => {
        const queryState = { keyword, taskType, status, dateRange, page, pageSize, ...next };
        if (next.keyword !== undefined || next.taskType !== undefined || next.status !== undefined || next.dateRange !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setTaskType(queryState.taskType);
        setStatus(queryState.status);
        setDateRange(queryState.dateRange);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = query.data;

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminGenerationTask(token, id),
        onSuccess: () => {
            message.success(t("admin.generationTasks.messages.deleted"));
            queryClient.invalidateQueries({ queryKey: ["admin", "generation-tasks"] });
        },
        onError: (error: Error) => {
            message.error(error.message || t("admin.common.messages.deleteFailed"));
        },
    });

    const batchDeleteMutation = useMutation({
        mutationFn: (ids: string[]) => batchDeleteAdminGenerationTasks(token, ids),
        onSuccess: (data) => {
            const deleted = data?.deleted || 0;
            message.success(t("admin.generationTasks.messages.batchDeleted", { count: deleted, value: formatNumber(deleted) }));
            queryClient.invalidateQueries({ queryKey: ["admin", "generation-tasks"] });
        },
        onError: (error: Error) => {
            message.error(error.message || t("admin.generationTasks.messages.batchDeleteFailed"));
        },
    });

    const refundMutation = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) => refundAdminGenerationTask(token, id, reason),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["admin", "generation-tasks"] }),
                queryClient.invalidateQueries({ queryKey: ["admin", "generation-task-detail"] }),
                queryClient.invalidateQueries({ queryKey: ["admin", "credit-logs"] }),
            ]);
            message.success(t("admin.generationTasks.messages.refundRepaired"));
        },
        onError: (error: Error) => {
            message.error(error.message || t("admin.generationTasks.messages.refundRepairFailed"));
        },
    });

    return {
        tasks: data?.items || [],
        keyword,
        taskType,
        status,
        dateRange,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching,
        searchLogs: (value = keyword) => updateFilters({ keyword: value }),
        filterByType: (value: string) => updateFilters({ taskType: value }),
        filterByStatus: (value: string) => updateFilters({ status: value }),
        filterByDateRange: (value: LogDateRange) => updateFilters({ dateRange: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", taskType: "", status: "", dateRange: null, page: 1, pageSize: defaultPageSize }),
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
        deleteTask: (id: string) => deleteMutation.mutate(id),
        batchDeleteTasks: (ids: string[]) => batchDeleteMutation.mutate(ids),
        refundTask: (id: string, reason: string) => refundMutation.mutateAsync({ id, reason }),
        isDeleting: deleteMutation.isPending || batchDeleteMutation.isPending,
        isRefunding: refundMutation.isPending,
    };
}
