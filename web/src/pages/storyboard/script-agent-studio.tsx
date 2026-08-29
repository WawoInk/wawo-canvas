import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import copyToClipboard from "copy-to-clipboard";
import { Alert, App, Button, Input, InputNumber, Select, Tag } from "antd";
import { Check, Clipboard, FileText, LoaderCircle, RotateCcw, Send, Sparkles, Square, Wrench } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { appendScriptAgentMessage, loadScriptAgentWorkspace, saveScriptAgentWorkspace, type ScriptAgentWorkspaceRecord } from "./script-agent-storage";
import { sendScriptAgentTurn, submitScriptAgentAction, type ScriptAgentAction, type ScriptAgentEvent } from "@/services/api/script-agent";
import type { ScriptAgentStage, ScriptAspectRatio } from "./script-agent";

const aspectRatios: ScriptAspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];

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

export function ScriptAgentStudio() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const accountId = useUserStore((state) => state.user?.id || "anonymous");
    const [workspace, setWorkspace] = useState<ScriptAgentWorkspaceRecord | null>(null);
    const [draft, setDraft] = useState("");
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const activeAccountRef = useRef(accountId);
    const text = (key: string, fallback: string) => t(`scriptAgent.${key}`, { defaultValue: fallback });
    const model = config.textModel || config.model;

    useEffect(() => {
        activeAccountRef.current = accountId;
        let active = true;
        controllerRef.current?.abort();
        setWorkspace(null);
        setError("");
        void loadScriptAgentWorkspace(accountId)
            .then((value) => {
                if (active && activeAccountRef.current === accountId) setWorkspace(value);
            })
            .catch(() => {
                if (active) setError(text("messages.loadFailed", "剧本 Agent 工作区加载失败"));
            });
        return () => {
            active = false;
            controllerRef.current?.abort();
        };
    }, [accountId]);

    async function persist(value: ScriptAgentWorkspaceRecord) {
        if (activeAccountRef.current !== accountId) return;
        setWorkspace(value);
        try {
            const saved = await saveScriptAgentWorkspace(accountId, value);
            if (activeAccountRef.current === accountId) setWorkspace(saved);
        } catch {
            message.warning(text("messages.saveFailed", "工作区已更新，但保存失败"));
        }
    }

    async function run(operation: (signal: AbortSignal, onEvent: (event: ScriptAgentEvent) => void) => Promise<ScriptAgentWorkspaceRecord>) {
        if (!workspace || running) return;
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
            if (!controller.signal.aborted && activeAccountRef.current === accountId) await persist(next);
        } catch (runError) {
            if (!controller.signal.aborted) {
                const reason = runError instanceof Error ? runError.message : text("messages.failed", "剧本 Agent 处理失败");
                setError(reason);
                message.error(reason);
            }
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
            setRunning(false);
        }
    }

    async function send() {
        const value = draft.trim();
        if (!value || !workspace) return;
        setDraft("");
        const next = appendScriptAgentMessage(workspace, "user", value);
        await persist(next);
        await run((signal, onEvent) => sendScriptAgentTurn({ ...config, model, textModel: model }, next, value, { signal, onEvent }));
    }

    async function action(actionName: ScriptAgentAction, instruction = "") {
        if (!workspace) return;
        const labels: Record<ScriptAgentAction, string> = { confirm: "确认配置", approve: "批准继续", fix: "要求修复", redo: "要求重做", continue: "继续生成", retry: "重试" };
        const next = appendScriptAgentMessage(workspace, "user", instruction ? `${labels[actionName]}：${instruction}` : labels[actionName]);
        await persist(next);
        await run((signal, onEvent) => submitScriptAgentAction({ ...config, model, textModel: model }, next, { action: actionName, instruction }, { signal, onEvent }));
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

    const review = workspace.currentStage === "awaiting_story_skeleton_decision" ? workspace.storySkeletonReview : workspace.currentStage === "awaiting_adaptation_decision" ? workspace.adaptationReview : undefined;
    const configComplete = Boolean(workspace.title && workspace.source && workspace.projectConfig);
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
    const totalEpisodes = workspace.projectConfig?.totalEpisodes || 0;
    const nextEpisode = workspace.scripts.length ? Math.max(...workspace.scripts.map((item) => item.episodeNumber)) + 1 : 1;

    return (
        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
            <section className="flex min-h-0 flex-col rounded-lg border bg-card p-4 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <Sparkles className="size-5 text-primary" />
                            <h2 className="text-xl font-semibold">{text("title", "剧本 Agent")}</h2>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{text("subtitle", "用自然语言完成配置、审核与逐集剧本创作")}</p>
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
                        disabled={running}
                        autoSize={{ minRows: 3, maxRows: 7 }}
                        placeholder="输入配置或告诉我批准、修复、重做、继续……（Shift+Enter 换行）"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">当前模型：{model || "未配置"}</span>
                        <Button
                            type={running ? "default" : "primary"}
                            danger={running}
                            icon={running ? <Square className="size-4" /> : <Send className="size-4" />}
                            disabled={running ? false : !draft.trim()}
                            onClick={() => (running ? stop() : void send())}
                        >
                            {running ? "停止" : "发送"}
                        </Button>
                    </div>
                </div>
            </section>

            <aside className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border bg-card p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="font-semibold">项目工作区</h3>
                    <ModelPicker config={config} value={model} capability="text" fullWidth={false} onChange={(value) => updateConfig("textModel", value)} onMissingConfig={() => openConfigDialog(false)} disabled={running} />
                </div>
                <div className="space-y-3 text-sm">
                    <div className="rounded-lg border p-3">
                        <div className="mb-2 font-medium">配置摘要</div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-muted-foreground">
                            <span>作品</span>
                            <span className="text-right text-foreground">{workspace.title || "待填写"}</span>
                            <span>素材</span>
                            <span className="text-right text-foreground">{workspace.source ? `${workspace.source.length} 字` : "待填写"}</span>
                            {workspace.projectConfig ? (
                                <>
                                    <span>规模</span>
                                    <span className="text-right text-foreground">
                                        {workspace.projectConfig.totalEpisodes} 集 · {workspace.projectConfig.episodeMinutes} 分钟/集
                                    </span>
                                    <span>章节</span>
                                    <span className="text-right text-foreground">
                                        第 {workspace.projectConfig.startChapter}-{workspace.projectConfig.endChapter} 章
                                    </span>
                                    <span>平台 / 画幅</span>
                                    <span className="text-right text-foreground">
                                        {workspace.projectConfig.platform} · {workspace.projectConfig.aspectRatio}
                                    </span>
                                    <span>风格 / 付费</span>
                                    <span className="text-right text-foreground">
                                        {workspace.projectConfig.style} · {workspace.projectConfig.paywall}
                                    </span>
                                </>
                            ) : (
                                <span className="col-span-2 text-muted-foreground">请在左侧对话中补充完整配置</span>
                            )}
                        </div>
                    </div>
                    {canConfirm ? (
                        <Button block type="primary" icon={<Check className="size-4" />} disabled={running} onClick={() => void action("confirm")}>
                            确认配置并生成故事骨架
                        </Button>
                    ) : null}
                    {configComplete ? (
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 flex items-center gap-2 font-medium">
                                <FileText className="size-4" />
                                创作进度
                            </div>
                            <div className="space-y-1 text-sm text-muted-foreground">
                                <div>故事骨架：{workspace.storySkeleton ? "已生成" : "未生成"}</div>
                                <div>改编策略：{workspace.adaptationStrategy ? "已生成" : "未生成"}</div>
                                <div>
                                    剧本：{workspace.scripts.length}/{totalEpisodes} 集
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {review ? (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="font-medium">审核报告</span>
                                <Tag color={review.grade === "A" ? "green" : review.grade === "D" ? "red" : "gold"}>{review.grade} 级</Tag>
                            </div>
                            <div className="whitespace-pre-wrap text-sm leading-6">{review.markdown}</div>
                            {review.issues.length ? (
                                <div className="mt-3 space-y-2 border-t pt-3">
                                    {review.issues.map((issue, index) => (
                                        <div key={`${issue.check}-${index}`} className="text-sm">
                                            <span className="font-medium">{issue.check || "检查项"}</span>：{issue.problem}
                                            <div className="text-muted-foreground">建议：{issue.suggestion}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Button type="primary" size="small" icon={<Check className="size-3.5" />} disabled={running} onClick={() => void action("approve")}>
                                    批准继续
                                </Button>
                                <Button size="small" icon={<Wrench className="size-3.5" />} disabled={running} onClick={() => void action("fix", "请根据审核报告修复当前产物。")}>
                                    修复
                                </Button>
                                <Button size="small" icon={<RotateCcw className="size-3.5" />} disabled={running} onClick={() => void action("redo", "请重新生成当前产物。")}>
                                    重做
                                </Button>
                            </div>
                        </div>
                    ) : null}
                    {workspace.storySkeleton && workspace.currentStage !== "awaiting_story_skeleton_decision" ? (
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 font-medium">故事骨架</div>
                            <div className="whitespace-pre-wrap text-sm leading-6">{workspace.storySkeleton}</div>
                        </div>
                    ) : null}
                    {workspace.adaptationStrategy && workspace.currentStage !== "awaiting_adaptation_decision" ? (
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 font-medium">改编策略</div>
                            <div className="whitespace-pre-wrap text-sm leading-6">{workspace.adaptationStrategy}</div>
                        </div>
                    ) : null}
                    {workspace.scripts.map((script) => (
                        <div key={`${script.episodeNumber}-${script.version || 0}`} className="rounded-lg border p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="font-medium">
                                    EP{String(script.episodeNumber).padStart(2, "0")} · {script.name}
                                </div>
                                <Button size="small" icon={<Clipboard className="size-3.5" />} onClick={() => copyScript(script.content)}>
                                    复制正文
                                </Button>
                            </div>
                            <div className="whitespace-pre-wrap text-sm leading-6">{script.content}</div>
                        </div>
                    ))}
                    {workspace.currentStage === "script_batch_completed" && nextEpisode <= totalEpisodes ? (
                        <Button block icon={<Sparkles className="size-4" />} disabled={running} onClick={() => void action("continue")}>
                            继续生成接下来的 3 集
                        </Button>
                    ) : null}
                    {workspace.currentStage === "failed" ? (
                        <Button block icon={<RotateCcw className="size-4" />} disabled={running} onClick={() => void action("retry")}>
                            重试当前阶段
                        </Button>
                    ) : null}
                    {workspace.currentStage === "completed" ? <Alert type="success" showIcon message="全部剧本已完成" /> : null}
                </div>
            </aside>
        </div>
    );
}
