import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, App, Button, Empty, Input, Popconfirm, Tabs, Tag, Upload } from "antd";
import { Check, Clipboard, FilePlus2, Pencil, RotateCcw, Save, Trash2, Upload as UploadIcon, Wrench, X } from "lucide-react";

import type { ScriptAgentAction } from "@/services/api/script-agent";
import type { ScriptAgentStage, ScriptArtifactReview, ScriptArtifactStatus, ScriptItem } from "./script-agent";
import type { ScriptAgentWorkspaceRecord } from "./script-agent-storage";
import { createWorkspaceScript, removeWorkspaceScript, saveWorkspaceArtifact, upsertWorkspaceScript } from "./script-agent-workspace";

const MAX_SCRIPT_FILE_SIZE = 2 * 1024 * 1024;
const SCRIPT_FILE_PATTERN = /\.(txt|md|markdown)$/i;

const artifactStatusLabels: Record<ScriptArtifactStatus, string> = {
    empty: "未生成",
    ready: "待生成",
    generating: "生成中",
    generated: "已生成",
    reviewing: "审核中",
    awaiting_user_decision: "待确认",
    approved: "已批准",
    revision_requested: "待修复",
    redo_requested: "待重做",
    failed: "失败",
};

const severityLabels = {
    severe: "严重",
    medium: "中等",
    minor: "轻微",
} as const;

type ScriptAgentWorkspacePanelProps = {
    workspace: ScriptAgentWorkspaceRecord;
    running: boolean;
    onChange: (nextWorkspace: ScriptAgentWorkspaceRecord) => void | Promise<void>;
    onSaveArtifact?: (nextWorkspace: ScriptAgentWorkspaceRecord) => boolean | Promise<boolean>;
    onAction: (action: ScriptAgentAction, instruction?: string) => void | Promise<void>;
    onCopyScript: (content: string) => void;
    onBusyChange?: (busy: boolean) => void;
};

type ArtifactPanelProps = {
    title: string;
    description: string;
    content: string;
    status: ScriptArtifactStatus;
    review?: ScriptArtifactReview;
    editorLabel: string;
    awaitingDecision: boolean;
    running: boolean;
    stageNotice: ReactNode;
    onSave: (content: string) => boolean | void | Promise<boolean | void>;
    onAction: ScriptAgentWorkspacePanelProps["onAction"];
};

function ReviewReport({ review }: { review?: ScriptArtifactReview }) {
    if (!review) return null;
    return (
        <section className="space-y-3 border-t pt-4" aria-label="审核报告">
            <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-medium">审核报告</h4>
                <Tag variant="filled">评级 {review.grade}</Tag>
                <span className="text-xs text-muted-foreground">版本 {review.artifactVersion}</span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{review.summary}</p>
            {review.issues.length ? (
                <div className="space-y-2">
                    {review.issues.map((issue, index) => (
                        <div key={`${issue.check}-${index}`} className="rounded-md border p-3 text-sm">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <Tag variant="filled">{severityLabels[issue.severity]}</Tag>
                                <span className="font-medium">{issue.check}</span>
                            </div>
                            <p className="leading-6">{issue.problem}</p>
                            <p className="mt-1 leading-6 text-muted-foreground">建议：{issue.suggestion}</p>
                        </div>
                    ))}
                </div>
            ) : null}
            {review.decisions.length ? (
                <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">审核结论</div>
                    <ul className="space-y-1 text-sm leading-6">
                        {review.decisions.map((decision, index) => (
                            <li key={`${decision}-${index}`}>· {decision}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {review.markdown ? (
                <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">查看完整审核内容</summary>
                    <div className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-3 leading-6">{review.markdown}</div>
                </details>
            ) : null}
        </section>
    );
}

function ArtifactPanel({ title, description, content, status, review, editorLabel, awaitingDecision, running, stageNotice, onSave, onAction }: ArtifactPanelProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(content);
    const [instruction, setInstruction] = useState("");
    const [manualRevision, setManualRevision] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!editing) setDraft(content);
    }, [content, editing]);

    useEffect(() => {
        if (!running) return;
        setDraft(content);
        setEditing(false);
    }, [content, running]);

    async function save() {
        const value = draft.trim();
        if (!value) return;
        setSaving(true);
        try {
            if ((await onSave(value)) === false) {
                setDraft(value);
                setEditing(true);
                return;
            }
            setManualRevision(value);
            setEditing(false);
        } catch {
            setDraft(value);
            setEditing(true);
        } finally {
            setSaving(false);
        }
    }

    function cancel() {
        setDraft(content);
        setEditing(false);
    }

    function submit(action: "approve" | "fix" | "redo") {
        void onAction(action, instruction.trim() || undefined);
        setInstruction("");
    }

    return (
        <div className="thin-scrollbar h-full space-y-4 overflow-y-auto p-4">
            {stageNotice}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{title}</h3>
                        <Tag variant="filled">{artifactStatusLabels[status]}</Tag>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {editing ? (
                        <>
                            <Button size="small" icon={<Save className="size-4" />} disabled={running || saving || !draft.trim()} onClick={() => void save()}>
                                保存
                            </Button>
                            <Button size="small" type="text" icon={<X className="size-4" />} disabled={saving} onClick={cancel}>
                                取消
                            </Button>
                        </>
                    ) : (
                        <Button
                            size="small"
                            type="text"
                            icon={<Pencil className="size-4" />}
                            disabled={running || saving}
                            onClick={() => {
                                setDraft(content);
                                setEditing(true);
                            }}
                        >
                            编辑
                        </Button>
                    )}
                </div>
            </div>

            {editing ? (
                <Input.TextArea aria-label={editorLabel} value={draft} onChange={(event) => setDraft(event.target.value)} autoSize={{ minRows: 16, maxRows: 36 }} disabled={running || saving} />
            ) : content ? (
                <div className="min-h-64 whitespace-pre-wrap break-words rounded-md bg-muted/25 p-4 text-sm leading-7">{content}</div>
            ) : (
                <div className="flex min-h-64 items-center justify-center rounded-md border border-dashed">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${title}`} />
                </div>
            )}

            {manualRevision === content && review ? <Alert type="warning" showIcon title="已保存人工修改" description="原审核报告仅供参考；批准后将以当前内容继续。" /> : null}
            <ReviewReport review={review} />

            {awaitingDecision && !editing ? (
                <section className="space-y-3 border-t pt-4" aria-label={`${title}审核操作`}>
                    <Input.TextArea aria-label={`${title}修改要求`} value={instruction} onChange={(event) => setInstruction(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="补充修复或重做要求（可选）" disabled={running} />
                    <div className="flex flex-wrap gap-2">
                        <Button type="primary" icon={<Check className="size-4" />} disabled={running} onClick={() => submit("approve")}>
                            批准
                        </Button>
                        <Button icon={<Wrench className="size-4" />} disabled={running} onClick={() => submit("fix")}>
                            修复
                        </Button>
                        <Button icon={<RotateCcw className="size-4" />} disabled={running} onClick={() => submit("redo")}>
                            重做
                        </Button>
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function StageNotice({ stage, running, onAction }: { stage: ScriptAgentStage; running: boolean; onAction: ScriptAgentWorkspacePanelProps["onAction"] }) {
    if (stage === "script_batch_completed")
        return (
            <Alert
                type="info"
                showIcon
                title="本批剧本已完成"
                description="可以继续生成下一批剧本。"
                action={
                    <Button size="small" disabled={running} onClick={() => void onAction("continue")}>
                        继续生成
                    </Button>
                }
            />
        );
    if (stage === "failed")
        return (
            <Alert
                type="error"
                showIcon
                title="处理失败"
                description="可重试当前剧本 Agent 阶段。"
                action={
                    <Button size="small" disabled={running} onClick={() => void onAction("retry")}>
                        重试
                    </Button>
                }
            />
        );
    if (stage === "completed") return <Alert type="success" showIcon title="全部剧本已完成" />;
    return null;
}

function ScriptPanel({ workspace, running, stageNotice, onChange, onCopyScript, onBusyChange }: ScriptAgentWorkspacePanelProps & { stageNotice: ReactNode }) {
    const { message } = App.useApp();
    const [selectedEpisode, setSelectedEpisode] = useState<number | null>(workspace.scripts[0]?.episodeNumber ?? null);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [pendingScript, setPendingScript] = useState<ScriptItem | null>(null);
    const workspaceRef = useRef(workspace);
    const uploadQueueRef = useRef(Promise.resolve());
    const uploadCountRef = useRef(0);
    const visibleScripts = pendingScript ? [...workspace.scripts, pendingScript].sort((a, b) => a.episodeNumber - b.episodeNumber) : workspace.scripts;
    const selected = pendingScript?.episodeNumber === selectedEpisode ? pendingScript : (workspace.scripts.find((script) => script.episodeNumber === selectedEpisode) ?? null);

    useEffect(() => {
        workspaceRef.current = workspace;
        if (pendingScript?.episodeNumber === selectedEpisode) return;
        if (selectedEpisode !== null && !workspace.scripts.some((script) => script.episodeNumber === selectedEpisode)) {
            setSelectedEpisode(workspace.scripts[0]?.episodeNumber ?? null);
            setEditing(false);
        } else if (selectedEpisode === null && workspace.scripts.length) {
            setSelectedEpisode(workspace.scripts[0].episodeNumber);
        }
    }, [pendingScript, selectedEpisode, workspace]);

    useEffect(() => {
        if (!editing && selected) {
            setName(selected.name);
            setContent(selected.content);
        }
    }, [editing, selected]);

    useEffect(() => {
        if (!running) return;
        setEditing(false);
        setPendingScript(null);
    }, [running]);

    async function apply(next: ScriptAgentWorkspaceRecord) {
        workspaceRef.current = next;
        await onChange(next);
    }

    function startEditing(script: ScriptItem) {
        setName(script.name);
        setContent(script.content);
        setEditing(true);
    }

    function availableScript(name = "", content = "") {
        const current = workspaceRef.current;
        const script = createWorkspaceScript(current.scripts, name, content);
        if (current.projectConfig && script.episodeNumber > current.projectConfig.totalEpisodes) {
            message.warning(`剧本已达到 ${current.projectConfig.totalEpisodes} 集上限`);
            return null;
        }
        return script;
    }

    function createScript() {
        if (editing) return message.warning("请先保存或取消当前编辑");
        const script = availableScript();
        if (!script) return;
        setPendingScript(script);
        setSelectedEpisode(script.episodeNumber);
        startEditing(script);
    }

    function saveScript() {
        if (!selected) return;
        if (!name.trim()) return message.warning("请输入剧本名称");
        if (!content.trim()) return message.warning("请输入剧本正文");
        void apply(upsertWorkspaceScript(workspaceRef.current, { ...selected, name, content }));
        setPendingScript(null);
        setEditing(false);
    }

    function cancelEditing() {
        if (pendingScript) {
            setPendingScript(null);
            setSelectedEpisode(workspaceRef.current.scripts[0]?.episodeNumber ?? null);
            setEditing(false);
            return;
        }
        if (selected) {
            setName(selected.name);
            setContent(selected.content);
        }
        setEditing(false);
    }

    function deleteScript(script: ScriptItem) {
        const next = removeWorkspaceScript(workspaceRef.current, script.episodeNumber);
        void apply(next);
        setPendingScript(null);
        setSelectedEpisode(next.scripts[0]?.episodeNumber ?? null);
        setEditing(false);
    }

    async function importScript(file: File) {
        if (!SCRIPT_FILE_PATTERN.test(file.name)) {
            message.error(`${file.name}：仅支持 .txt、.md、.markdown 文件`);
            return;
        }
        if (file.size > MAX_SCRIPT_FILE_SIZE) {
            message.error(`${file.name}：文件不能超过 2MB`);
            return;
        }
        try {
            const fileContent = (await file.text()).trim();
            if (!fileContent) {
                message.error(`${file.name}：空文件无法上传`);
                return;
            }
            const current = workspaceRef.current;
            const script = availableScript(file.name.replace(/\.(txt|md|markdown)$/i, ""), fileContent);
            if (!script) return;
            const next = upsertWorkspaceScript(current, script);
            await apply(next);
            setPendingScript(null);
            setSelectedEpisode(script.episodeNumber);
            setEditing(false);
            message.success(`${file.name} 已导入`);
        } catch {
            message.error(`${file.name} 读取失败`);
        }
    }

    return (
        <div className="thin-scrollbar h-full space-y-4 overflow-y-auto p-4">
            {stageNotice}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="font-medium">剧本</h3>
                    <p className="mt-1 text-xs text-muted-foreground">共 {workspace.scripts.length} 集，可新建或导入本地文本。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<FilePlus2 className="size-4" />} disabled={running || editing} onClick={createScript}>
                        新建剧本
                    </Button>
                    <Upload
                        accept=".txt,.md,.markdown,text/plain,text/markdown"
                        multiple
                        disabled={running || editing}
                        showUploadList={false}
                        beforeUpload={(file) => {
                            uploadCountRef.current += 1;
                            onBusyChange?.(true);
                            uploadQueueRef.current = uploadQueueRef.current
                                .then(() => importScript(file))
                                .finally(() => {
                                    uploadCountRef.current -= 1;
                                    if (!uploadCountRef.current) onBusyChange?.(false);
                                });
                            return Upload.LIST_IGNORE;
                        }}
                    >
                        <Button size="small" icon={<UploadIcon className="size-4" />} disabled={running || editing}>
                            上传剧本
                        </Button>
                    </Upload>
                </div>
            </div>

            {visibleScripts.length ? (
                <div className="grid min-h-[420px] gap-4 xl:grid-cols-[180px_minmax(0,1fr)]">
                    <nav className="space-y-1 border-r pr-3" aria-label="剧本列表">
                        {visibleScripts.map((script) => {
                            const active = script.episodeNumber === selectedEpisode;
                            return (
                                <button
                                    key={script.episodeNumber}
                                    type="button"
                                    className={`w-full rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                                    aria-current={active ? "true" : undefined}
                                    onClick={() => {
                                        if (editing && script.episodeNumber !== selectedEpisode) return message.warning("请先保存或取消当前编辑");
                                        if (pendingScript && script.episodeNumber !== pendingScript.episodeNumber) setPendingScript(null);
                                        setSelectedEpisode(script.episodeNumber);
                                        setEditing(false);
                                    }}
                                >
                                    <span className="block text-xs opacity-70">第 {script.episodeNumber} 集</span>
                                    <span className="mt-0.5 block truncate text-sm">{script.name || "未命名剧本"}</span>
                                </button>
                            );
                        })}
                    </nav>

                    {selected ? (
                        <section className="min-w-0 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h4 className="truncate font-medium">{selected.name || `第 ${selected.episodeNumber} 集`}</h4>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        第 {selected.episodeNumber} 集{selected.version ? ` · 版本 ${selected.version}` : ""}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {editing ? (
                                        <>
                                            <Button size="small" icon={<Save className="size-4" />} disabled={running} onClick={saveScript}>
                                                保存
                                            </Button>
                                            <Button size="small" type="text" icon={<X className="size-4" />} onClick={cancelEditing}>
                                                取消
                                            </Button>
                                        </>
                                    ) : (
                                        <Button size="small" type="text" icon={<Pencil className="size-4" />} disabled={running} onClick={() => startEditing(selected)}>
                                            编辑
                                        </Button>
                                    )}
                                    <Button size="small" type="text" icon={<Clipboard className="size-4" />} disabled={!selected.content} onClick={() => onCopyScript(selected.content)}>
                                        复制正文
                                    </Button>
                                    <Popconfirm title="删除这个剧本？" description="删除后无法恢复。" okText="删除" cancelText="取消" onConfirm={() => deleteScript(selected)}>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-4" />} disabled={running || editing}>
                                            删除
                                        </Button>
                                    </Popconfirm>
                                </div>
                            </div>

                            {editing ? (
                                <div className="space-y-3">
                                    <Input aria-label="剧本名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="剧本名称" disabled={running} />
                                    <Input.TextArea aria-label="剧本正文" value={content} onChange={(event) => setContent(event.target.value)} autoSize={{ minRows: 18, maxRows: 40 }} placeholder="输入剧本正文" disabled={running} />
                                </div>
                            ) : selected.content ? (
                                <div className="whitespace-pre-wrap break-words rounded-md bg-muted/25 p-4 text-sm leading-7">{selected.content}</div>
                            ) : (
                                <div className="flex min-h-64 items-center justify-center rounded-md border border-dashed">
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无剧本正文" />
                                </div>
                            )}
                        </section>
                    ) : null}
                </div>
            ) : (
                <div className="flex min-h-[360px] items-center justify-center rounded-md border border-dashed">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无剧本，请新建或上传" />
                </div>
            )}
        </div>
    );
}

export function ScriptAgentWorkspacePanel({ workspace, running, onChange, onSaveArtifact, onAction, onCopyScript, onBusyChange }: ScriptAgentWorkspacePanelProps) {
    const stageNotice = <StageNotice stage={workspace.currentStage} running={running} onAction={onAction} />;

    async function saveArtifact(next: ScriptAgentWorkspaceRecord) {
        if (onSaveArtifact) return onSaveArtifact(next);
        await onChange(next);
        return true;
    }

    return (
        <Tabs
            type="line"
            size="small"
            defaultActiveKey="story"
            className="min-h-0 flex-1 [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:overflow-hidden [&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-nav]:px-4 [&_.ant-tabs-tabpane]:h-full"
            items={[
                {
                    key: "story",
                    label: "故事骨架",
                    children: (
                        <ArtifactPanel
                            title="故事骨架"
                            description="管理人物关系、核心冲突与整体叙事结构。"
                            content={workspace.storySkeleton}
                            status={workspace.storySkeletonStatus}
                            review={workspace.storySkeletonReview}
                            editorLabel="故事骨架内容"
                            awaitingDecision={workspace.currentStage === "awaiting_story_skeleton_decision"}
                            running={running}
                            stageNotice={stageNotice}
                            onSave={(content) => saveArtifact(saveWorkspaceArtifact(workspace, "storySkeleton", content))}
                            onAction={onAction}
                        />
                    ),
                },
                {
                    key: "adaptation",
                    label: "改编策略",
                    children: (
                        <ArtifactPanel
                            title="改编策略"
                            description="管理内容取舍、节奏调整与平台化改编方案。"
                            content={workspace.adaptationStrategy}
                            status={workspace.adaptationStatus}
                            review={workspace.adaptationReview}
                            editorLabel="改编策略内容"
                            awaitingDecision={workspace.currentStage === "awaiting_adaptation_decision"}
                            running={running}
                            stageNotice={stageNotice}
                            onSave={(content) => saveArtifact(saveWorkspaceArtifact(workspace, "adaptationStrategy", content))}
                            onAction={onAction}
                        />
                    ),
                },
                {
                    key: "material",
                    label: "素材",
                    children: (
                        <ArtifactPanel
                            title="素材"
                            description="预览和修改 Agent 当前使用的完整故事素材；之后新发起的生成会使用最新内容，不会自动改写既有产物。"
                            content={workspace.source}
                            status={workspace.source ? "generated" : "empty"}
                            editorLabel="素材内容"
                            awaitingDecision={false}
                            running={running}
                            stageNotice={stageNotice}
                            onSave={(content) => saveArtifact(saveWorkspaceArtifact(workspace, "source", content))}
                            onAction={onAction}
                        />
                    ),
                },
                {
                    key: "scripts",
                    label: "剧本",
                    children: <ScriptPanel workspace={workspace} running={running} stageNotice={stageNotice} onChange={onChange} onAction={onAction} onCopyScript={onCopyScript} onBusyChange={onBusyChange} />,
                },
            ]}
        />
    );
}
