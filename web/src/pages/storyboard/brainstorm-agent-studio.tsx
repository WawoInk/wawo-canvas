import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Spin } from "antd";

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
                if (!items[0]) {
                    setLoading(false);
                    return;
                }
                void loadProject(items[0].id, account);
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
    }, [accountId, loadProject, refreshKey]);

    const reloadProject = useCallback(() => {
        if (project) void loadProject(project.id, accountId, false);
    }, [accountId, loadProject, project]);

    return (
        <section className="grid min-h-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border bg-card p-4 shadow-sm">
                <div>
                    <h1 className="text-2xl font-semibold">脑暴 Agent</h1>
                    <p className="mt-1 text-sm text-muted-foreground">围绕已保存的分镜项目进行创意讨论和完善。</p>
                </div>
                <label className="mt-6 block">
                    <span className="mb-2 block text-sm font-medium">选择分镜项目</span>
                    <select
                        aria-label="脑暴项目"
                        value={selectedId}
                        disabled={!records.length || loading || brainstormActive}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        onChange={(event) => {
                            if (!brainstormActive) void loadProject(event.target.value, accountId);
                        }}
                    >
                        {!records.length ? <option value="">暂无已保存分镜</option> : null}
                        {records.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.title || "未命名分镜"}
                            </option>
                        ))}
                    </select>
                </label>
                {loading ? (
                    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                        <Spin size="small" /> 正在加载分镜项目...
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
                {project ? (
                    <BrainstormAgentPanel project={project} onActiveChange={setBrainstormActive} onProjectUpdated={reloadProject} />
                ) : (
                    <div className="flex min-h-[480px] items-center justify-center rounded-lg border bg-card p-6 shadow-sm" aria-label={loading ? "正在加载脑暴项目" : undefined}>
                        {loading ? <Spin description="正在加载脑暴项目..." /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error || "请先保存分镜项目，再开始脑暴"} />}
                    </div>
                )}
            </div>
        </section>
    );
}
