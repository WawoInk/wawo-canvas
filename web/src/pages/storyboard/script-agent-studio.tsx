import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import copyToClipboard from "copy-to-clipboard";
import { Alert, App, Button, Input, Tag } from "antd";
import { ArrowLeft, Check, LoaderCircle, Send, Sparkles, Square } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { appendScriptAgentMessage, loadScriptAgentWorkspace, saveScriptAgentWorkspace, scriptAgentConflictWorkspace, type ScriptAgentWorkspaceRecord } from "./script-agent-storage";
import { sendScriptAgentTurn, submitScriptAgentAction, type ScriptAgentAction, type ScriptAgentEvent } from "@/services/api/script-agent";
import type { ScriptAgentStage } from "./script-agent";
import { ScriptAgentConversations } from "./script-agent-conversations";
import { ScriptAgentWorkspacePanel } from "./script-agent-workspace-panel";


const stageLabels: Record<ScriptAgentStage, string> = {
    collecting_config: "收集项目配置",
    ready_for_story_skeleton: "等待生成故事骨架",
    generating_story_skeleton: "生成故事骨架",
    reviewing_story_skeleton: "审核故事骨架",
    awaiting_story_skeleton_decision: "等待确认故事骨架",
    ready_for_adaptation_strategy: "等待生成改编策略",
    generating_adaptation_strategy: "生成改编策略",
    reviewing_adaptation_strategy: "审核改编策略",
    awaiting_adaptation_decision: "等待确认改编策略",
    ready_for_script: "准备生成剧本",
    selecting_script_batch: "选择剧本批次",
    generating_script_batch: "逐集生成剧本",
    script_batch_completed: "本批剧本已完成",
    completed: "全部完成",
    failed: "处理失败",
};

function formatDate(value: string) {
    return new Date(value).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

function errorStatus(error: unknown) {
    return error && typeof error === "object" && "status" in error ? Number((error as { status?: number }).status) : 0;
}

function saveFailureMessage(error: unknown) {
    return errorStatus(error) === 409 ? "工作区版本冲突，已恢复服务端最新版本" : "工作区保存失败，修改未持久化";
}

export function ScriptAgentStudio({ projectId, onBack, onWorkspaceChange }: { projectId: string; onBack: () => void; onWorkspaceChange?: (workspace: ScriptAgentWorkspaceRecord) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const accountId = useUserStore((state) => state.user?.id || "");
    const [workspace, setWorkspace] = useState<ScriptAgentWorkspaceRecord | null>(null);
    const [draft, setDraft] = useState("");
    const [running, setRunning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [workspaceMutating, setWorkspaceMutating] = useState(false);
    const [error, setError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const persistedWorkspaceRef = useRef<ScriptAgentWorkspaceRecord | null>(null);
    const activeAccountRef = useRef(accountId);
    const activeProjectRef = useRef(projectId);
    const text = (key: string, fallback: string) => t(`scriptAgent.${key}`, { defaultValue: fallback });
    const model = config.textModel || config.model;
    const busy = running || saving || workspaceMutating;

    useEffect(() => {
        activeAccountRef.current = accountId;
        activeProjectRef.current = projectId;
        let active = true;
        controllerRef.current?.abort();
        persistedWorkspaceRef.current = null;
        setWorkspace(null);
        setRunning(false);
        setSaving(false);
        setWorkspaceMutating(false);
        setError("");
        void loadScriptAgentWorkspace(projectId)
            .then((value) => {
                if (!active || activeAccountRef.current !== accountId || activeProjectRef.current !== projectId) return;
                persistedWorkspaceRef.current = value;
                setWorkspace(value);
            })
            .catch((loadError) => {
                if (!active || activeAccountRef.current !== accountId || activeProjectRef.current !== projectId) return;
                if (errorStatus(loadError) === 404) {
                    message.warning("剧本不存在或已被删除");
                    onBack();
                } else {
                    setError(text("messages.loadFailed", "剧本 Agent 工作区加载失败"));
                }
            });
        return () => {
            active = false;
            controllerRef.current?.abort();
        };
    }, [accountId, projectId]);

    async function save(value: ScriptAgentWorkspaceRecord) {
        if (activeAccountRef.current !== accountId || activeProjectRef.current !== projectId) return null;
        const previous = persistedWorkspaceRef.current;
        setSaving(true);
        try {
            const saved = await saveScriptAgentWorkspace(value);
            if (activeAccountRef.current === accountId && activeProjectRef.current === projectId) {
                persistedWorkspaceRef.current = saved;
                setWorkspace(saved);
                setError("");
                onWorkspaceChange?.(saved);
            }
            return saved;
        } catch (saveError) {
            if (activeAccountRef.current === accountId && activeProjectRef.current === projectId) {
                const conflict = scriptAgentConflictWorkspace(saveError);
                if (conflict) persistedWorkspaceRef.current = conflict;
                setWorkspace(conflict || previous);
            }
            throw saveError;
        } finally {
            if (activeAccountRef.current === accountId && activeProjectRef.current === projectId) setSaving(false);
        }
    }

    async function saveWithFeedback(value: ScriptAgentWorkspaceRecord) {
        try {
            return await save(value);
        } catch (saveError) {
            const reason = saveFailureMessage(saveError);
            setError(reason);
            message.error(reason);
            return null;
        }
    }

    async function persist(value: ScriptAgentWorkspaceRecord): Promise<void> {
        await saveWithFeedback(value);
    }

    async function run(operation: (signal: AbortSignal, onEvent: (event: ScriptAgentEvent) => void) => Promise<ScriptAgentWorkspaceRecord>) {
        if (!persistedWorkspaceRef.current || busy) return;
        if (!model || !isAiConfigReady({ ...config, model, textModel: model }, model)) {
            message.warning(text("messages.configRequired", "请先配置可用的文本模型"));
            openConfigDialog(false);
            return;
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        setRunning(true);
        setError("");
        try {
            const next = await operation(controller.signal, (event) => {
                if (event.type === "phase") setWorkspace((current) => (current ? { ...current, currentStage: event.phase } : current));
            });
            if (!controller.signal.aborted && activeAccountRef.current === accountId && activeProjectRef.current === projectId) await save(next);
        } catch (runError) {
            if (activeAccountRef.current === accountId && activeProjectRef.current === projectId) setWorkspace(persistedWorkspaceRef.current);
            if (!controller.signal.aborted) {
                const reason = errorStatus(runError) === 409 ? saveFailureMessage(runError) : runError instanceof Error ? runError.message : text("messages.failed", "剧本 Agent 处理失败");
                setError(reason);
                message.error(reason);
            }
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
            if (activeAccountRef.current === accountId && activeProjectRef.current === projectId) setRunning(false);
        }
    }

    async function send() {
        const value = draft.trim();
        if (!value || !workspace || saving || workspaceMutating) return;
        setDraft("");
        const saved = await saveWithFeedback(appendScriptAgentMessage(workspace, "user", value));
        if (saved) await run((signal, onEvent) => sendScriptAgentTurn({ ...config, model, textModel: model }, saved, value, { signal, onEvent }));
    }

    async function action(actionName: ScriptAgentAction, instruction = "") {
        if (!workspace || saving || workspaceMutating) return;
        const labels: Record<ScriptAgentAction, string> = { confirm: "确认配置", approve: "批准继续", fix: "要求修复", redo: "要求重做", continue: "继续生成", retry: "重试" };
        const next = appendScriptAgentMessage(workspace, "user", instruction ? `${labels[actionName]}：${instruction}` : labels[actionName]);
        const saved = await saveWithFeedback(next);
        if (saved) await run((signal, onEvent) => submitScriptAgentAction({ ...config, model, textModel: model }, saved, { action: actionName, instruction }, { signal, onEvent }));
    }

    function stop() {
        controllerRef.current?.abort();
        message.info(text("messages.cancelled", "已停止当前处理"));
    }

    function copyScript(content: string) {
        copyToClipboard(content);
        message.success(text("messages.copied", "剧本正文已复制"));
    }

    if (!workspace)
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-card">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
        );

    const canConfirm =
        workspace.currentStage === "collecting_config" &&
        Boolean(
            workspace.title &&
            workspace.source &&
            workspace.configDraft?.totalEpisodes &&
            workspace.configDraft?.episodeMinutes &&
            workspace.configDraft?.startChapter &&
            workspace.configDraft?.endChapter &&
            workspace.configDraft?.platform &&
            workspace.configDraft?.aspectRatio &&
            workspace.configDraft?.style &&
            workspace.configDraft?.paywall,
        );

    return (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] lg:overflow-hidden">
            <section className="flex min-h-[640px] flex-col overflow-hidden rounded-lg border bg-card shadow-sm md:flex-row lg:min-h-0">
                <ScriptAgentConversations workspace={workspace} busy={busy} onChange={persist} />
                <div className="flex min-w-0 flex-1 flex-col p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                        <Button type="text" size="small" aria-label="返回剧本空间" icon={<ArrowLeft className="size-4" />} disabled={busy} onClick={onBack} />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Sparkles className="size-5 text-primary" />
                                <h2 className="truncate text-xl font-semibold">{workspace.title || text("title", "剧本 Agent")}</h2>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{text("subtitle", "用自然语言完成配置、审核与逐集剧本创作")}</p>
                        </div>
                    </div>
                    <Tag color={workspace.currentStage === "failed" ? "error" : "blue"}>{stageLabels[workspace.currentStage]}</Tag>
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {!workspace.messages.length ? (
                        <div className="rounded-lg border border-dashed p-5 text-sm leading-6 text-muted-foreground">
                            告诉我作品标题、故事素材、总集数、单集时长、章节范围、平台、画幅、风格和付费策略，例如：“《雾城追凶》，24集，每集2分钟，改编第1-20章，竖屏悬疑逆袭，前8集免费。”
                        </div>
                    ) : null}
                    {workspace.messages.map((item) => (
                        <div key={item.id} className={`max-w-[92%] rounded-lg border px-3 py-2.5 text-sm leading-6 ${item.role === "user" ? "ml-auto border-primary/20 bg-primary/5" : "bg-muted/30"}`}>
                            <div className="mb-1 text-xs text-muted-foreground">
                                {item.role === "user" ? "你" : "剧本助手"} · {formatDate(item.createdAt)}
                            </div>
                            <div className="whitespace-pre-wrap">{item.content}</div>
                        </div>
                    ))}
                    {error ? <Alert type="error" showIcon message={error} /> : null}
                </div>
                <div className="mt-4 border-t pt-4">
                    <Input.TextArea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onPressEnter={(event) => {
                            if (!event.shiftKey) {
                                event.preventDefault();
                                void send();
                            }
                        }}
                        disabled={busy}
                        autoSize={{ minRows: 3, maxRows: 7 }}
                        placeholder="输入配置或告诉我批准、修复、重做、继续……（Shift+Enter 换行）"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">当前模型：{model || "未配置"}</span>
                        <Button
                            type={running ? "default" : "primary"}
                            danger={running}
                            icon={running ? <Square className="size-4" /> : <Send className="size-4" />}
                            disabled={running ? false : busy || !draft.trim()}
                            onClick={() => (running ? stop() : void send())}
                        >
                            {running ? "停止" : "发送"}
                        </Button>
                    </div>
                </div>
                </div>
            </section>

            <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div className="min-w-0">
                        <h3 className="font-semibold">剧本工作区</h3>
                        <p className="truncate text-xs text-muted-foreground">{workspace.title || "未命名作品"}</p>
                    </div>
                    <ModelPicker config={config} value={model} capability="text" fullWidth={false} onChange={(value) => updateConfig("textModel", value)} onMissingConfig={() => openConfigDialog(false)} disabled={busy} />
                </div>
                <div className="border-b px-4 py-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>素材 {workspace.source ? `${workspace.source.length} 字` : "待填写"}</span>
                        {workspace.projectConfig ? (
                            <>
                                <span>
                                    {workspace.projectConfig.totalEpisodes} 集 · {workspace.projectConfig.episodeMinutes} 分钟/集
                                </span>
                                <span>
                                    第 {workspace.projectConfig.startChapter}-{workspace.projectConfig.endChapter} 章
                                </span>
                                <span>
                                    {workspace.projectConfig.platform} · {workspace.projectConfig.aspectRatio}
                                </span>
                            </>
                        ) : (
                            <span>请在左侧对话中补充完整配置</span>
                        )}
                    </div>
                    {canConfirm ? (
                        <Button className="mt-3" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => void action("confirm")}>
                            确认配置并生成故事骨架
                        </Button>
                    ) : null}
                </div>
                <ScriptAgentWorkspacePanel workspace={workspace} running={busy} onChange={persist} onAction={action} onCopyScript={copyScript} onBusyChange={setWorkspaceMutating} />
            </aside>
        </div>
    );
}
