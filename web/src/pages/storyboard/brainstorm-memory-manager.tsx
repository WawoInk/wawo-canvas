import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Empty, Input, Modal, Popconfirm, Radio, Spin, Tag } from "antd";
import { Pencil, Trash2 } from "lucide-react";

import { deleteStoryboardMemory, fetchStoryboardMemories, updateStoryboardMemory, type StoryboardMemory, type StoryboardMemoryScope } from "@/services/api/storyboard-brainstorm";

const PAGE_SIZE = 500;
const scopeLabels = { project: "项目", scene: "场景", shot: "镜头" } as const;

type BrainstormMemoryManagerProps = { projectId: string; refreshKey?: number; disabled?: boolean };
type Draft = { kind: string; scope: StoryboardMemoryScope; path: string; tags: string; content: string };

function formatUpdatedAt(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

function errorMessage(reason: unknown, fallback: string) {
    return reason instanceof Error && reason.message ? reason.message : fallback;
}

function draftFrom(memory: StoryboardMemory): Draft {
    return { kind: memory.kind, scope: memory.scope, path: memory.path, tags: memory.tags.join(", "), content: memory.content };
}

function tagsFrom(value: string) {
    return [
        ...new Set(
            value
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
        ),
    ];
}

export function BrainstormMemoryManager({ projectId, refreshKey, disabled = false }: BrainstormMemoryManagerProps) {
    const { message } = App.useApp();
    const requestRef = useRef(0);
    const contextRef = useRef("");
    const context = `${projectId}\0${refreshKey ?? ""}`;
    contextRef.current = context;
    const [memories, setMemories] = useState<StoryboardMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<StoryboardMemory | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState("");

    useEffect(() => {
        const request = ++requestRef.current;
        contextRef.current = context;
        setLoading(true);
        setError("");
        setMemories([]);
        setEditing(null);
        setDraft(null);
        setSaving(false);
        setDeletingId("");
        void (async () => {
            try {
                const items: StoryboardMemory[] = [];
                let page = 1;
                let total = 0;
                do {
                    const result = await fetchStoryboardMemories(projectId, { page, pageSize: PAGE_SIZE });
                    items.push(...result.items);
                    total = result.total;
                    page += 1;
                    if (!result.items.length) break;
                } while (items.length < total);
                if (requestRef.current === request) setMemories(items);
            } catch (reason) {
                if (requestRef.current === request) setError(errorMessage(reason, "Memory 加载失败"));
            } finally {
                if (requestRef.current === request) setLoading(false);
            }
        })();
        return () => {
            if (requestRef.current === request) requestRef.current += 1;
            if (contextRef.current === context) contextRef.current = "";
        };
    }, [context, projectId]);

    function openEditor(memory: StoryboardMemory) {
        setEditing(memory);
        setDraft(draftFrom(memory));
    }

    async function save() {
        if (!editing || !draft || !draft.kind.trim() || !draft.content.trim() || (draft.scope !== "project" && !draft.path.trim())) return;
        const mutationContext = contextRef.current;
        setSaving(true);
        try {
            const updated = await updateStoryboardMemory(projectId, editing.id, {
                kind: draft.kind.trim(),
                scope: draft.scope,
                path: draft.scope === "project" ? "" : draft.path.trim(),
                content: draft.content,
                tags: tagsFrom(draft.tags),
                sourceMessageId: editing.sourceMessageId,
                operationId: editing.operationId,
            });
            if (contextRef.current !== mutationContext) return;
            setMemories((items) => items.map((item) => (item.id === updated.id ? updated : item)));
            setEditing(null);
            setDraft(null);
            message.success("Memory 已更新");
        } catch (reason) {
            if (contextRef.current === mutationContext) message.error(errorMessage(reason, "Memory 更新失败"));
        } finally {
            if (contextRef.current === mutationContext) setSaving(false);
        }
    }

    async function remove(memoryId: string) {
        const mutationContext = contextRef.current;
        setDeletingId(memoryId);
        try {
            await deleteStoryboardMemory(projectId, memoryId);
            if (contextRef.current !== mutationContext) return;
            setMemories((items) => items.filter((item) => item.id !== memoryId));
            message.success("Memory 已删除");
        } catch (reason) {
            if (contextRef.current === mutationContext) message.error(errorMessage(reason, "Memory 删除失败"));
        } finally {
            if (contextRef.current === mutationContext) setDeletingId("");
        }
    }

    return (
        <section className="space-y-4" aria-label="Brainstorm Memory 管理">
            <Alert type="info" showIcon title="这里只管理已确认的服务端 Memory" description="Memory 候选必须在 Tool 审批卡中确认后才保存，不会在这里静默创建。" />
            {loading ? (
                <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
                    <Spin size="small" /> 正在加载 Memory...
                </div>
            ) : error ? (
                <Alert type="error" showIcon title="Memory 加载失败" description={error} />
            ) : memories.length ? (
                <div className="space-y-3">
                    {memories.map((item) => (
                        <article key={item.id} className="rounded-lg border p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Tag>{item.kind}</Tag>
                                        <Tag>{scopeLabels[item.scope]}</Tag>
                                        <span className="text-xs text-muted-foreground">路径：{item.path || "—"}</span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-1">{item.tags.length ? item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <span className="text-xs text-muted-foreground">无标签</span>}</div>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <Button type="text" size="small" aria-label={`编辑 Memory ${item.id}`} icon={<Pencil className="size-3.5" />} disabled={disabled} onClick={() => openEditor(item)} />
                                    <Popconfirm title="删除这条 Memory？" description="删除后无法恢复。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} disabled={disabled} onConfirm={() => void remove(item.id)}>
                                        <Button type="text" danger size="small" aria-label={`删除 Memory ${item.id}`} icon={<Trash2 className="size-3.5" />} disabled={disabled} loading={deletingId === item.id} />
                                    </Popconfirm>
                                </div>
                            </div>
                            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>
                            <p className="mt-3 break-all text-xs text-muted-foreground">
                                来源消息 {item.sourceMessageId} · 更新于 {formatUpdatedAt(item.updatedAt)}
                            </p>
                        </article>
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已确认 Memory" />
            )}

            <Modal
                title="编辑 Memory"
                open={Boolean(editing && draft)}
                centered
                destroyOnHidden
                onCancel={() => {
                    setEditing(null);
                    setDraft(null);
                }}
                footer={
                    <>
                        <Button
                            disabled={saving}
                            onClick={() => {
                                setEditing(null);
                                setDraft(null);
                            }}
                        >
                            取消
                        </Button>
                        <Button type="primary" loading={saving} disabled={disabled || !draft?.kind.trim() || !draft?.content.trim() || (draft.scope !== "project" && !draft.path.trim())} onClick={() => void save()}>
                            保存
                        </Button>
                    </>
                }
            >
                {draft ? (
                    <div className="space-y-4 pt-2">
                        <label className="block text-sm font-medium">
                            类型
                            <Input className="mt-2" aria-label="Memory 类型" value={draft.kind} disabled={disabled || saving} onChange={(event) => setDraft({ ...draft, kind: event.target.value })} />
                        </label>
                        <div>
                            <div className="mb-2 text-sm font-medium">范围</div>
                            <Radio.Group
                                aria-label="Memory 范围"
                                value={draft.scope}
                                disabled={disabled || saving}
                                onChange={(event) => {
                                    const scope = event.target.value as StoryboardMemoryScope;
                                    setDraft({ ...draft, scope, path: scope === editing?.scope ? editing.path : "" });
                                }}
                                options={[
                                    { label: "项目", value: "project" },
                                    { label: "场景", value: "scene" },
                                    { label: "镜头", value: "shot" },
                                ]}
                            />
                        </div>
                        {draft.scope !== "project" ? (
                            <label className="block text-sm font-medium">
                                路径
                                <Input className="mt-2" aria-label="Memory 路径" value={draft.path} disabled={disabled || saving} onChange={(event) => setDraft({ ...draft, path: event.target.value })} />
                            </label>
                        ) : null}
                        <label className="block text-sm font-medium">
                            标签
                            <Input className="mt-2" aria-label="Memory 标签" value={draft.tags} disabled={disabled || saving} placeholder="用逗号分隔" onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
                        </label>
                        <label className="block text-sm font-medium">
                            内容
                            <Input.TextArea aria-label="Memory 内容" className="mt-2" value={draft.content} disabled={disabled || saving} autoSize={{ minRows: 5, maxRows: 12 }} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
                        </label>
                    </div>
                ) : null}
            </Modal>
        </section>
    );
}
