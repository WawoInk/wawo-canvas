"use client";

import { useEffect, useState } from "react";
import { Empty, Result, Skeleton } from "antd";

import { fetchEnterpriseAccountSummary, type EnterpriseAccountSummary } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export default function EnterpriseAssetsPage() {
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
    const [summary, setSummary] = useState<EnterpriseAccountSummary | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let current = true;
        setSummary(null);
        setError("");
        void fetchEnterpriseAccountSummary(token)
            .then((value) => current && setSummary(value))
            .catch((reason) => current && setError(reason instanceof Error ? reason.message : "企业信息加载失败"));
        return () => {
            current = false;
        };
    }, [token, userId]);

    if (error) return <Result status="403" title="无权限访问企业素材库" subTitle={error} />;

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="border-b pb-6">
                    <p className="text-xs text-muted-foreground">{summary?.name || "企业空间"}</p>
                    <h1 className="mt-3 text-3xl font-semibold">企业素材库</h1>
                </header>
                {!summary ? (
                    <Skeleton active paragraph={{ rows: 5 }} />
                ) : (
                    <section className="flex min-h-[360px] items-center justify-center border-y">
                        <Empty description="暂无企业素材" />
                    </section>
                )}
            </div>
        </main>
    );
}
