import { useRef, useState } from "react";
import { App, Button, Empty, Input, Popconfirm, Spin } from "antd";
import { Check, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";

import type { BrainstormConversation } from "./use-brainstorm-agent";

type BrainstormAgentConversationsProps = {
    conversations: BrainstormConversation[];
    currentConversationId: string;
    loading?: boolean;
    disabled?: boolean;
    runningConversationIds?: string[];
    onCreate: () => Promise<unknown> | unknown;
    onSelect: (id: string) => Promise<unknown> | unknown;
    onRename: (id: string, title: string) => Promise<unknown> | unknown;
    onDelete: (id: string) => Promise<unknown> | unknown;
};

export function BrainstormAgentConversations({ conversations, currentConversationId, loading = false, disabled = false, runningConversationIds = [], onCreate, onSelect, onRename, onDelete }: BrainstormAgentConversationsProps) {
    const { message } = App.useApp();
    const submittingRef = useRef(false);
    const [pending, setPending] = useState("");
    const [editingId, setEditingId] = useState("");
    const [title, setTitle] = useState("");
    const busy = loading || disabled || Boolean(pending);
    const runningIds = new Set(runningConversationIds);

    async function run(key: string, action: () => Promise<unknown> | unknown, errorText: string) {
        if (loading || disabled || submittingRef.current) return false;
        submittingRef.current = true;
        setPending(key);
        try {
            await action();
            return true;
        } catch {
            message.error(errorText);
            return false;
        } finally {
            submittingRef.current = false;
            setPending("");
        }
    }

    async function rename(conversationId: string) {
        const nextTitle = title.trim();
        if (!nextTitle) return;
        if (await run(`rename:${conversationId}`, () => onRename(conversationId, nextTitle), "重命名对话失败")) setEditingId("");
    }

    return (
        <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r bg-muted/15">
            <div className="flex items-center justify-between gap-3 border-b px-3 py-3">
                <h3 className="font-semibold">历史记录</h3>
                <Button type="text" size="small" icon={<MessageSquarePlus className="size-4" />} loading={pending === "create"} disabled={busy} onClick={() => void run("create", onCreate, "新建对话失败")}>
                    新建对话
                </Button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                        <Spin size="small" />
                        <span className="ml-2">正在加载对话...</span>
                    </div>
                ) : conversations.length ? (
                    conversations.map((conversation) => {
                        const active = conversation.id === currentConversationId;
                        const running = runningIds.has(conversation.id);
                        if (editingId === conversation.id) {
                            return (
                                <div key={conversation.id} className="flex items-center gap-1 rounded-md bg-primary/10 p-1.5">
                                    <Input aria-label="会话名称" size="small" autoFocus value={title} disabled={busy || running} onChange={(event) => setTitle(event.target.value)} onPressEnter={() => void rename(conversation.id)} />
                                    <Button
                                        type="text"
                                        size="small"
                                        aria-label="保存名称"
                                        icon={<Check className="size-4" />}
                                        loading={pending === `rename:${conversation.id}`}
                                        disabled={busy || running || !title.trim()}
                                        onClick={() => void rename(conversation.id)}
                                    />
                                    <Button type="text" size="small" aria-label="取消重命名" icon={<X className="size-4" />} disabled={busy} onClick={() => setEditingId("")} />
                                </div>
                            );
                        }
                        return (
                            <div key={conversation.id} className={`group flex items-center rounded-md transition-colors ${active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                                <button
                                    type="button"
                                    aria-label={conversation.title}
                                    aria-pressed={active}
                                    disabled={busy}
                                    className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm font-medium"
                                    onClick={() => void run(`select:${conversation.id}`, () => onSelect(conversation.id), "切换对话失败")}
                                >
                                    {conversation.title}
                                </button>
                                <Button
                                    className="opacity-60 group-hover:opacity-100"
                                    type="text"
                                    size="small"
                                    aria-label={`重命名${conversation.title}`}
                                    icon={<Pencil className="size-3.5" />}
                                    disabled={busy || running}
                                    onClick={() => {
                                        setEditingId(conversation.id);
                                        setTitle(conversation.title);
                                    }}
                                />
                                <Popconfirm
                                    title={`确定删除“${conversation.title}”吗？`}
                                    description="删除后将无法恢复。"
                                    okText="确认删除"
                                    cancelText="取消"
                                    okButtonProps={{ danger: true }}
                                    disabled={busy || running}
                                    onConfirm={() => run(`delete:${conversation.id}`, () => onDelete(conversation.id), "删除对话失败")}
                                >
                                    <Button className="mr-1 opacity-60 group-hover:opacity-100" type="text" size="small" aria-label={`删除${conversation.title}`} icon={<Trash2 className="size-3.5" />} disabled={busy || running} />
                                </Popconfirm>
                            </div>
                        );
                    })
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无对话" className="py-12" />
                )}
            </div>
        </aside>
    );
}
