"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { deleteAdminPrompt, deleteAdminPrompts, fetchAdminPrompts, fetchAdminPromptCategories, saveAdminPrompt, syncAdminPromptCategory, type AdminPromptCategory } from "@/services/api/admin";
import type { Prompt } from "@/services/api/prompts";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminPrompts() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("");
    const [tag, setTag] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const categoriesQuery = useQuery({
        queryKey: ["admin", "prompt-categories", token],
        queryFn: () => fetchAdminPromptCategories(token),
        enabled: Boolean(token),
        retry: false,
    });

    const promptsQuery = useQuery({
        queryKey: ["admin", "prompts", token, keyword, category, tag, page, pageSize],
        queryFn: () => fetchAdminPrompts(token, { keyword, category, tag, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const syncMutation = useMutation({
        mutationFn: (category: string) => syncAdminPromptCategory(token, category),
        onSuccess: async (categories) => {
            queryClient.setQueryData<AdminPromptCategory[]>(["admin", "prompt-categories", token], categories);
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] });
            message.success(t("admin.prompts.messages.synced"));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.common.messages.syncFailed"));
        },
    });

    const saveMutation = useMutation({
        mutationFn: (prompt: Partial<Prompt>) => saveAdminPrompt(token, prompt),
        onSuccess: async (_, prompt) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-categories"] });
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] });
            message.success(t(prompt.id ? "admin.prompts.messages.saved" : "admin.prompts.messages.created"));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.common.messages.saveFailed"));
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminPrompt(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-categories"] });
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] });
            message.success(t("admin.prompts.messages.deleted"));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.common.messages.deleteFailed"));
        },
    });

    const batchDeleteMutation = useMutation({
        mutationFn: (ids: string[]) => deleteAdminPrompts(token, ids),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-categories"] });
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] });
            message.success(t("admin.prompts.messages.batchDeleted"));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.prompts.messages.batchDeleteFailed"));
        },
    });

    useEffect(() => {
        const error = categoriesQuery.error || promptsQuery.error;
        if (!error) return;
        const errorMessage = error instanceof Error ? error.message : t("admin.prompts.messages.loadFailed");
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [categoriesQuery.error, clearSession, message, promptsQuery.error, t]);

    const updateFilters = (next: Partial<{ keyword: string; category: string; tag: string[]; page: number; pageSize: number }>) => {
        const queryState = { keyword, category, tag, page, pageSize, ...next };
        if (next.keyword !== undefined || next.category !== undefined || next.tag !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setCategory(queryState.category);
        setTag(queryState.tag);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = promptsQuery.data;

    return {
        categories: categoriesQuery.data || [],
        prompts: data?.items || [],
        tags: data?.tags || [],
        keyword,
        category,
        tag,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: categoriesQuery.isFetching || promptsQuery.isFetching || saveMutation.isPending || deleteMutation.isPending || batchDeleteMutation.isPending,
        isSyncing: syncMutation.isPending,
        syncCategory: (category: string) => syncMutation.mutateAsync(category),
        searchPrompts: (value = keyword) => updateFilters({ keyword: value }),
        changeCategory: (value: string) => updateFilters({ category: value, tag: [] }),
        changeTag: (value: string[]) => updateFilters({ tag: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", category: "", tag: [], page: 1, pageSize: defaultPageSize }),
        refreshPrompts: async () => {
            await categoriesQuery.refetch();
            await promptsQuery.refetch();
        },
        savePrompt: (prompt: Partial<Prompt>) => saveMutation.mutateAsync(prompt),
        deletePrompt: (id: string) => deleteMutation.mutateAsync(id),
        deletePrompts: (ids: string[]) => batchDeleteMutation.mutateAsync(ids),
    };
}
