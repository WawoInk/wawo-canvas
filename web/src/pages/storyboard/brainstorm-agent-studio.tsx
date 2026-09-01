import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Spin } from "antd";

import { useUserStore } from "@/stores/use-user-store";
import { BrainstormAgentPanel } from "./brainstorm-agent-panel";
import { listStoryboardRecords, loadStoryboardRecord, type StoryboardRecordSummary } from "./storyboard-storage";
import type { StoryboardRecord } from "./storyboard";

export function BrainstormAgentStudio() {
    const accountId = useUserStore((state) => state.user?.id || "anonymous");
    const accountIdRef = useRef(accountId);
    const requestRef = useRef(0);
    const [records, setRecords] = useState<StoryboardRecordSummary[]>([]);
    const [project, setProject] = useState<StoryboardRecord | null>(null);
    const [selectedId, setSelectedId] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [brainstormActive, setBrainstormActive] = useState(false);
    accountIdRef.current = accountId;

    const loadProject = useCallback(async (id: string, account: string, clearProject = true) => {
        const requestId = ++requestRef.current;
        if (clearProject) setProject(null);
        setSelectedId(id);
        setLoading(true);
        setError("");
        try {
            const next = await loadStoryboardRecord(id);
            if (accountIdRef.current !== account || requestRef.current !== requestId) return;
            setProject(next);
            setRecords((items) => items.map((item) => (item.id === next.id ? { ...item, title: next.title } : item)));
        } catch {
            if (accountIdRef.current !== account || requestRef.current !== requestId) return;
            if (clearProject) setProject(null);
            setError("分镜项目加载失败");
        } finally {
            if (accountIdRef.current === account && requestRef.current === requestId) setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const account = accountId;
        const requestId = ++requestRef.current;
        setRecords([]);
        setProject(null);
        setSelectedId("");
        setError("");
        setLoading(true);
        setBrainstormActive(false);

        void listStoryboardRecords()
            .then((items) => {
                if (!active || accountIdRef.current !== account || requestRef.current !== requestId) return;
                setRecords(items);
                setLoading(false);
            })
            .catch(() => {
                if (!active || accountIdRef.current !== account || requestRef.current !== requestId) return;
                setError("历史记录加载失败");
                setLoading(false);
            });

        return () => {
            active = false;
            requestRef.current += 1;
        };
    }, [accountId, refreshKey]);

    const selectProject = useCallback(
        (id: string) => {
            if (brainstormActive) return;
            if (!id) {
                requestRef.current += 1;
                setProject(null);
                setSelectedId("");
                setError("");
                setLoading(false);
                return;
            }
            void loadProject(id, accountId);
        },
        [accountId, brainstormActive, loadProject],
    );

    const reloadProject = useCallback(() => {
        if (project) void loadProject(project.id, accountId, false);
    }, [accountId, loadProject, project]);

    return (
        <section className="grid min-h-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border bg-card p-4 shadow-sm">
                <h1 className="text-2xl font-semibold">脑暴 Agent</h1>
                <p className="mt-1 text-sm text-muted-foreground">独立脑暴工作区，不依赖已保存分镜项目，可自由讨论和完善创意。</p>
                <label className="mt-6 block">
                    <span className="mb-2 block text-sm font-medium">选择分镜项目</span>
                    <select
                        aria-label="脑暴项目"
                        value={selectedId}
                        disabled={loading || brainstormActive}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        onChange={(event) => selectProject(event.target.value)}
                    >
                        <option value="">独立脑暴（不绑定分镜）</option>
                        {records.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.title || "未命名分镜"}
                            </option>
                        ))}
                    </select>
                </label>
                {loading ? (
                    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                        <Spin size="small" /> 正在加载分镜项目列表...
                    </div>
                ) : null}
                {error ? (
                    <Alert
                        className="mt-4"
                        type="error"
                        showIcon
                        title={error}
                        action={
                            <Button
                                size="small"
                                onClick={() => {
                                    if (selectedId) void loadProject(selectedId, accountId, false);
                                    else setRefreshKey((value) => value + 1);
                                }}
                            >
                                重新加载
                            </Button>
                        }
                    />
                ) : null}
            </aside>
            <div className="min-h-0">
                <BrainstormAgentPanel project={project} onActiveChange={setBrainstormActive} onProjectUpdated={reloadProject} />
            </div>
        </section>
    );
}
