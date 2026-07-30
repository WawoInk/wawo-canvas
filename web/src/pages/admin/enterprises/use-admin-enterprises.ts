"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import {
    adjustAdminEnterpriseCredits,
    createAdminEnterprise,
    fetchAdminCreditLogs,
    fetchAdminEnterprises,
    resetAdminEnterpriseOwnerPassword,
    setAdminEnterpriseDiscountRate,
    setAdminEnterpriseOwnerStatus,
    setAdminEnterpriseStatus,
    type AdminEnterprise,
    type CreateAdminEnterprise,
} from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export function useAdminEnterprises() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const query = useQuery({ queryKey: ["admin", "enterprises", token, keyword, page, pageSize], queryFn: () => fetchAdminEnterprises(token, { keyword, page, pageSize }), enabled: Boolean(token) });
    const mutation = useMutation({
        mutationFn: (action: () => Promise<AdminEnterprise>) => action(),
        onSuccess: async () => {
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin", "enterprises"] }), queryClient.invalidateQueries({ queryKey: ["admin", "users"] }), queryClient.invalidateQueries({ queryKey: ["admin", "credit-logs"] })]);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "操作失败"),
    });

    return {
        enterprises: query.data?.items || [],
        total: query.data?.total || 0,
        keyword,
        page,
        pageSize,
        isLoading: query.isFetching || mutation.isPending,
        search: (value: string) => {
            setKeyword(value);
            setPage(1);
        },
        reset: () => {
            setKeyword("");
            setPage(1);
        },
        changePage: (value: number, size: number) => {
            if (size !== pageSize) setPageSize(size);
            setPage(size !== pageSize ? 1 : value);
        },
        refresh: () => query.refetch(),
        create: (value: CreateAdminEnterprise) => mutation.mutateAsync(() => createAdminEnterprise(token, value)),
        setStatus: (item: AdminEnterprise, active: boolean) => mutation.mutateAsync(() => setAdminEnterpriseStatus(token, item.id, active ? "active" : "disabled")),
        setDiscountRate: (item: AdminEnterprise, discountRate: string) => mutation.mutateAsync(() => setAdminEnterpriseDiscountRate(token, item.id, discountRate)),
        setOwnerStatus: (item: AdminEnterprise, active: boolean) => mutation.mutateAsync(() => setAdminEnterpriseOwnerStatus(token, item.id, active ? "active" : "ban")),
        resetPassword: (item: AdminEnterprise, password: string) => mutation.mutateAsync(() => resetAdminEnterpriseOwnerPassword(token, item.id, password)),
        adjustCredits: (item: AdminEnterprise, delta: string, reason: string) => mutation.mutateAsync(() => adjustAdminEnterpriseCredits(token, item.id, delta, reason)),
        loadCreditLogs: async (ownerId: string) => {
            try {
                return (await fetchAdminCreditLogs(token, { keyword: ownerId, type: "admin_adjust", pageSize: 20 })).items.filter((item) => item.userId === ownerId);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "读取充值记录失败");
                return [];
            }
        },
    };
}
