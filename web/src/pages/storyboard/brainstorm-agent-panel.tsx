"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert, App, Button, Drawer, Empty, Input, Select, Spin, Tag } from "antd";
import { Bot, BrainCircuit, Check, CircleAlert, History, Pause, RefreshCw, Send, UserRound, Wrench, X } from "lucide-react";

import { useUserStore } from "@/stores/use-user-store";

import { listBrainstormSkills } from "./brainstorm-agent-skills";
import { createBrainstormAgentRuntime } from "./brainstorm-agent-runtime";
import { STANDALONE_BRAINSTORM_SCOPE_ID } from "./brainstorm-agent-scope";
import { previewStoryboardToolCall } from "./brainstorm-agent-tools";
import type { BrainstormAssistantStatus, BrainstormFocus, BrainstormOutputItem, BrainstormToolCall, BrainstormToolResult } from "./brainstorm-agent";
import { BrainstormAgentConversations } from "./brainstorm-agent-conversations";
import { BrainstormMemoryManager } from "./brainstorm-memory-manager";
import type { StoryboardRecord } from "./storyboard";
import { useBrainstormAgent, type BrainstormAgentAssistantMessage, type BrainstormAgentMessage } from "./use-brainstorm-agent";

const skills = listBrainstormSkills();
const standaloneFocus = { kind: "project" } as const;
const statusLabels: Record<BrainstormAssistantStatus, string> = {
    pending: "等待生成",
    streaming: "生成中",
    awaiting_approval: "等待批准",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
};

function currentBranch(messages: BrainstormAgentMessage[], currentMessageId: string) {
    if (!currentMessageId) return [];
    const byId = new Map(messages.map((message) => [message.id, message]));
    const branch: BrainstormAgentMessage[] = [];
    const visited = new Set<string>();
    let current = byId.get(currentMessageId);
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        branch.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return branch;
}

function focusOptions(project: StoryboardRecord) {
    const options: Array<{ value: string; label: string; focus: BrainstormFocus }> = [{ value: "project", label: `整个项目 · ${project.title}`, focus: { kind: "project" } }];
    for (const scene of project.document?.scenes || []) {
        options.push({ value: `scene:${scene.id}`, label: `场次 ${scene.sceneNo} · ${scene.location}`, focus: { kind: "scene", sceneId: scene.id } });
        for (const segment of scene.segments) {
            options.push({ value: `segment:${segment.id}`, label: `片段 ${scene.sceneNo}.${segment.segmentNo} · ${segment.durationSec}s`, focus: { kind: "segment", sceneId: scene.id, segmentId: segment.id } });
            for (const shot of segment.shots) {
                options.push({ value: `shot:${shot.id}`, label: `镜头 ${shot.shotNo} · ${shot.visual}`, focus: { kind: "shot", sceneId: scene.id, segmentId: segment.id, shotId: shot.id } });
            }
        }
    }
    return options;
}

function resultFor(output: BrainstormOutputItem[], callId: string) {
    return output.find((item): item is BrainstormToolResult => item.type === "tool_result" && item.callId === callId);
}

function toolLabel(name: string) {
    const labels: Record<string, string> = {
        storyboard_get_overview: "读取项目概览",
        storyboard_get_scene: "读取场次",
        storyboard_get_shot: "读取镜头",
        storyboard_search_source: "搜索原始剧本",
        storyboard_get_validation: "读取校验结果",
        storyboard_list_memories: "读取 Memory",
        storyboard_propose_patch: "生成修改提案",
        storyboard_apply_patch: "应用分镜修改",
        storyboard_remember: "保存 Memory",
        storyboard_forget_memory: "删除 Memory",
    };
    return labels[name] || name;
}

function ToolCard({ call, result }: { call: BrainstormToolCall; result?: BrainstormToolResult }) {
    let preview: ReturnType<typeof previewStoryboardToolCall> | null = null;
    try {
        preview = previewStoryboardToolCall(call);
    } catch {
        preview = null;
    }
    const memoryCandidate = call.name === "storyboard_remember" && result?.status === "awaiting_approval";
    const status = result?.status || "running";
    const statusText = status === "awaiting_approval" ? "等待批准" : status === "succeeded" ? "已完成" : status === "failed" ? "失败" : status === "rejected" ? "已拒绝" : status === "skipped" ? "已跳过" : "调用中";
    const statusColor = status === "succeeded" ? "success" : status === "failed" || status === "rejected" ? "error" : status === "awaiting_approval" ? "warning" : "default";

    return (
        <section className="rounded-lg border bg-muted/15 p-3" aria-label={`${toolLabel(call.name)} Tool 卡片`}>
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center text-muted-foreground">{status === "awaiting_approval" ? <CircleAlert className="size-4" /> : <Wrench className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{preview?.title || toolLabel(call.name)}</span>
                        {memoryCandidate ? <Tag color="warning">Memory Candidate</Tag> : null}
                        <Tag color={statusColor}>{statusText}</Tag>
                    </div>
                    {preview?.summary ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{preview.summary}</p> : null}
                    {preview?.targets.length ? (
                        <div className="mt-2">
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">影响范围</div>
                            <div className="flex flex-wrap gap-1">
                                {preview.targets.map((target) => (
                                    <Tag key={target}>{target}</Tag>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {result?.content && !preview?.summary ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{result.content}</p> : null}
                    <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer select-none">查看参数</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background/60 p-2">{call.arguments}</pre>
                    </details>
                </div>
            </div>
        </section>
    );
}

function Output({ output, streamedText = "" }: { output: BrainstormOutputItem[]; streamedText?: string }) {
    const calls = new Set(output.filter((item): item is BrainstormToolCall => item.type === "tool_call").map((item) => item.callId));
    return (
        <div className="space-y-3">
            {output.map((item, index) => {
                if (item.type === "text")
                    return (
                        <p key={`${index}:text`} className="whitespace-pre-wrap break-words text-sm leading-6">
                            {item.text}
                        </p>
                    );
                if (item.type === "tool_call") return <ToolCard key={`${item.callId}:call`} call={item} result={resultFor(output, item.callId)} />;
                if (calls.has(item.callId)) return null;
                return (
                    <section key={`${item.callId}:result`} className="rounded-lg border bg-muted/15 p-3 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">
                            {toolLabel(item.name)} · {item.status}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words">{item.content}</p>
                    </section>
                );
            })}
            {streamedText ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {streamedText}
                    <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />
                </p>
            ) : null}
        </div>
    );
}

function MessageCard({
    message,
    run,
    userName,
    userAvatar,
    busy,
    onApproval,
    onRetry,
    onContinue,
}: {
    message: BrainstormAgentMessage;
    run?: { assistantMessageId: string; status: BrainstormAssistantStatus; output: BrainstormOutputItem[]; streamedText: string };
    userName: string;
    userAvatar: string;
    busy: boolean;
    onApproval: (id: string, decision: "approved" | "rejected") => void;
    onRetry: (id: string) => void;
    onContinue: (id: string) => void;
}) {
    if (message.role === "user") {
        return (
            <article className="flex justify-end gap-3">
                <div className="max-w-[84%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-6 text-primary-foreground">{message.content}</div>
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border bg-muted text-muted-foreground" aria-label={userName}>
                    {userAvatar ? <img src={userAvatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : <UserRound className="size-4" />}
                </span>
            </article>
        );
    }

    const activeRun = run?.assistantMessageId === message.id ? run : undefined;
    const status = activeRun?.status || message.status;
    const output = activeRun?.output || message.output;
    const terminal = status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
    return (
        <article className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center text-muted-foreground" aria-label="Brainstorm Agent">
                <Bot className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Brainstorm Agent</span>
                    <Tag color={status === "completed" ? "success" : status === "failed" ? "error" : status === "awaiting_approval" ? "warning" : "default"}>{statusLabels[status]}</Tag>
                </div>
                <Output output={output} streamedText={activeRun?.streamedText} />
                {status === "awaiting_approval" ? (
                    <div className="mt-3 flex gap-2">
                        <Button size="small" type="primary" icon={<Check className="size-3.5" />} disabled={busy} onClick={() => onApproval(message.id, "approved")}>
                            批准
                        </Button>
                        <Button size="small" danger icon={<X className="size-3.5" />} disabled={busy} onClick={() => onApproval(message.id, "rejected")}>
                            拒绝
                        </Button>
                    </div>
                ) : null}
                {terminal ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} disabled={busy} onClick={() => onRetry(message.id)}>
                            重新生成
                        </Button>
                        <Button type="text" size="small" icon={<Send className="size-3.5" />} disabled={busy} onClick={() => onContinue(message.id)}>
                            继续
                        </Button>
                    </div>
                ) : null}
            </div>
        </article>
    );
}

export function BrainstormAgentPanel({
    project,
    model,
    onProjectUpdated,
    onActiveChange,
    disabled = false,
}: {
    project: StoryboardRecord | null;
    model?: string;
    onProjectUpdated?: () => void;
    onActiveChange?: (active: boolean) => void;
    disabled?: boolean;
}) {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const [skillId, setSkillId] = useState(skills[0].id);
    const [focusKey, setFocusKey] = useState("project");
    const [conversationOpen, setConversationOpen] = useState(false);
    const [tab, setTab] = useState<"conversation" | "memory">("conversation");
    const [composer, setComposer] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const projectId = project?.id || STANDALONE_BRAINSTORM_SCOPE_ID;
    const options = useMemo(() => (project ? focusOptions(project) : []), [project]);
    const selectedFocus = project ? options.find((option) => option.value === focusKey)?.focus || standaloneFocus : standaloneFocus;

    useEffect(() => setFocusKey("project"), [project?.id]);

    const runtime = useMemo(() => {
        const runtimeOptions = {
            projectId,
            model,
            skillId,
            focus: selectedFocus,
            onProjectChanged: project ? onProjectUpdated : undefined,
            onMemoryChanged: () => setMemoryRefreshKey((value) => value + 1),
            ...(project ? {} : { scope: "standalone" as const }),
        };
        return createBrainstormAgentRuntime(runtimeOptions);
    }, [model, onProjectUpdated, project, projectId, selectedFocus, skillId]);
    const agent = useBrainstormAgent(projectId, runtime);
    const currentConversation = agent.conversations.find((item) => item.id === agent.currentConversationId);
    const branch = useMemo(() => currentBranch(agent.messages, currentConversation?.currentMessageId || ""), [agent.messages, currentConversation?.currentMessageId]);
    const currentRun = agent.runs[agent.currentConversationId];
    const anyActive = Object.values(agent.runs).some((run) => run.active);
    const hasForeignRunError = Object.entries(agent.runs).some(([id, run]) => id !== agent.currentConversationId && Boolean(run.error) && run.error === agent.error);
    const visibleError = currentRun?.error || (hasForeignRunError ? "" : agent.error);
    const awaitingApproval = branch.some((item) => item.role === "assistant" && item.status === "awaiting_approval");
    const busy = disabled || submitting || Boolean(currentRun?.active);

    useEffect(() => {
        onActiveChange?.(anyActive);
    }, [anyActive, onActiveChange]);

    useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ block: "end" });
    }, [branch, currentRun?.streamedText]);

    async function run(action: () => Promise<unknown>, errorText: string, allowWhenDisabled = false) {
        if ((disabled && !allowWhenDisabled) || submitting) return;
        setSubmitting(true);
        try {
            await action();
        } catch (reason) {
            message.error(reason instanceof Error && reason.message ? reason.message : errorText);
        } finally {
            setSubmitting(false);
        }
    }

    async function send() {
        const content = composer.trim();
        if (!content || busy || awaitingApproval) return;
        await run(async () => {
            await agent.send(content);
            setComposer("");
        }, "发送失败");
    }

    function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
        }
    }

    const conversationPanel = (
        <BrainstormAgentConversations
            conversations={agent.conversations}
            currentConversationId={agent.currentConversationId}
            loading={agent.isLoading}
            disabled={disabled || submitting}
            runningConversationIds={Object.entries(agent.runs)
                .filter(([, run]) => run.active)
                .map(([id]) => id)}
            onCreate={() => agent.createConversation()}
            onSelect={async (id) => {
                await agent.selectConversation(id);
                setConversationOpen(false);
            }}
            onRename={agent.renameConversation}
            onDelete={agent.deleteConversation}
        />
    );

    return (
        <section className="relative flex h-full min-h-[480px] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm" aria-label="Brainstorm Agent Panel">
            <header className="border-b px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <BrainCircuit className="size-4 text-muted-foreground" />
                            <h2 className="truncate font-semibold">Brainstorm Agent</h2>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{project ? `${project.title} · 基于已保存 revision ${project.revision}` : "独立脑暴工作区 · 不依赖已保存分镜项目"}</p>
                    </div>
                    <Button type="text" size="small" icon={<History className="size-4" />} onClick={() => setConversationOpen(true)}>
                        对话
                    </Button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Select aria-label="脑暴技能" value={skillId} disabled={busy} onChange={setSkillId} options={skills.map((skill) => ({ value: skill.id, label: skill.label, title: skill.description }))} />
                    {project ? <Select aria-label="当前焦点" value={focusKey} disabled={busy} onChange={setFocusKey} options={options.map(({ value, label }) => ({ value, label }))} /> : null}
                </div>
            </header>

            <nav className="flex h-11 shrink-0 items-end gap-5 border-b px-4" role="tablist" aria-label="Brainstorm 工作区">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "conversation"}
                    className={`h-11 border-b-2 text-sm ${tab === "conversation" ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}
                    onClick={() => setTab("conversation")}
                >
                    对话
                </button>
                <button type="button" role="tab" aria-selected={tab === "memory"} className={`h-11 border-b-2 text-sm ${tab === "memory" ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`} onClick={() => setTab("memory")}>
                    Memory
                </button>
            </nav>

            {tab === "memory" ? (
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                    <BrainstormMemoryManager projectId={projectId} standalone={!project} refreshKey={memoryRefreshKey} disabled={busy} />
                </div>
            ) : agent.isLoading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Spin size="small" /> 正在加载脑暴对话...
                </div>
            ) : !agent.conversations.length ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                    {visibleError ? (
                        <Alert type="error" showIcon title="Brainstorm Agent 出错" description={visibleError} />
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有脑暴对话">
                            <Button type="primary" disabled={disabled} onClick={() => void run(() => agent.createConversation(), "新建对话失败")}>
                                新建对话
                            </Button>
                        </Empty>
                    )}
                </div>
            ) : (
                <>
                    {visibleError ? <Alert className="m-4 mb-0" type="error" showIcon title="Brainstorm Agent 出错" description={visibleError} /> : null}
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5">
                        {branch.length ? (
                            <div className="space-y-6">
                                {branch.map((item) => (
                                    <MessageCard
                                        key={item.id}
                                        message={item}
                                        run={currentRun}
                                        userName={user?.displayName || user?.username || "用户"}
                                        userAvatar={user?.avatarUrl || ""}
                                        busy={busy}
                                        onApproval={(id, decision) => void run(() => agent.resolveApproval(id, decision), decision === "approved" ? "批准失败" : "拒绝失败")}
                                        onRetry={(id) => void run(() => agent.retry(id), "重新生成失败")}
                                        onContinue={(id) => void run(() => agent.continueAssistant(id), "继续生成失败")}
                                    />
                                ))}
                                <div ref={messagesEndRef} />
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从一个问题开始这次脑暴" />
                        )}
                    </div>
                    <footer className="border-t p-3">
                        {currentRun?.retrying ? <div className="mb-2 text-xs text-muted-foreground">模型请求正在重试...</div> : null}
                        {currentRun?.stopState === "failed" ? <Alert className="mb-2" type="warning" showIcon title="停止请求未能确认" /> : null}
                        <Input.TextArea
                            aria-label="脑暴消息"
                            value={composer}
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            placeholder={awaitingApproval ? "请先批准或拒绝待处理 Tool" : "输入想法，Cmd/Ctrl + Enter 发送"}
                            disabled={busy || awaitingApproval}
                            onChange={(event) => setComposer(event.target.value)}
                            onKeyDown={onComposerKeyDown}
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-[11px] text-muted-foreground">Agent 只读取当前分支与已确认 Memory</span>
                            {currentRun?.active ? (
                                <Button danger icon={<Pause className="size-4" />} loading={currentRun.stopState === "requested"} onClick={() => void run(() => agent.stop(), "停止失败", true)}>
                                    停止
                                </Button>
                            ) : (
                                <Button type="primary" icon={<Send className="size-4" />} disabled={!composer.trim() || awaitingApproval} loading={submitting} onClick={() => void send()}>
                                    发送
                                </Button>
                            )}
                        </div>
                    </footer>
                </>
            )}

            <Drawer title="脑暴对话" placement="left" size={280} open={conversationOpen} destroyOnHidden getContainer={false} rootStyle={{ position: "absolute" }} styles={{ body: { padding: 0 } }} onClose={() => setConversationOpen(false)}>
                {conversationPanel}
            </Drawer>
        </section>
    );
}
