import { useState } from "react";
import { Button, Input, Popconfirm } from "antd";
import { Check, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";

import { clearScriptAgentConversation, createScriptAgentConversation, renameScriptAgentConversation, selectScriptAgentConversation, type ScriptAgentWorkspaceRecord } from "./script-agent-storage";

type ScriptAgentConversationsProps = {
    workspace: ScriptAgentWorkspaceRecord;
    busy?: boolean;
    onChange: (workspace: ScriptAgentWorkspaceRecord) => void | Promise<void>;
};

export function ScriptAgentConversations({ workspace, busy = false, onChange }: ScriptAgentConversationsProps) {
    const [editingId, setEditingId] = useState("");
    const [title, setTitle] = useState("");
    const activeConversation = workspace.conversations.find((conversation) => conversation.id === workspace.activeConversationId);

    function saveTitle(conversationId: string) {
        const next = renameScriptAgentConversation(workspace, conversationId, title);
        if (next !== workspace) void onChange(next);
        setEditingId("");
    }

    return (
        <aside className="flex h-72 min-h-0 w-full shrink-0 flex-col border-b bg-muted/15 md:h-auto md:w-64 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-3 border-b px-3 py-3">
                <h3 className="font-semibold">历史记录</h3>
                <Button
                    type="text"
                    size="small"
                    icon={<MessageSquarePlus className="size-4" />}
                    disabled={busy}
                    onClick={() => void onChange(createScriptAgentConversation(workspace))}
                >
                    新建对话
                </Button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {workspace.conversations.map((conversation) => {
                    const active = conversation.id === workspace.activeConversationId;
                    if (editingId === conversation.id) {
                        return (
                            <div key={conversation.id} className="flex items-center gap-1 rounded-md bg-primary/10 p-1.5">
                                <Input
                                    aria-label="会话名称"
                                    size="small"
                                    autoFocus
                                    value={title}
                                    disabled={busy}
                                    onChange={(event) => setTitle(event.target.value)}
                                    onPressEnter={() => saveTitle(conversation.id)}
                                />
                                <Button type="text" size="small" aria-label="保存名称" icon={<Check className="size-4" />} disabled={busy || !title.trim()} onClick={() => saveTitle(conversation.id)} />
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
                                className="min-w-0 flex-1 px-3 py-2 text-left"
                                onClick={() => void onChange(selectScriptAgentConversation(workspace, conversation.id))}
                            >
                                <div className="truncate text-sm font-medium">{conversation.title}</div>
                                <div className="mt-1 text-xs opacity-70">{conversation.messages.length} 条消息</div>
                            </button>
                            <Button
                                className="mr-1 opacity-60 group-hover:opacity-100"
                                type="text"
                                size="small"
                                aria-label={`重命名${conversation.title}`}
                                icon={<Pencil className="size-3.5" />}
                                disabled={busy}
                                onClick={() => {
                                    setEditingId(conversation.id);
                                    setTitle(conversation.title);
                                }}
                            />
                        </div>
                    );
                })}
            </div>
            <div className="border-t p-2">
                <Popconfirm
                    title="确定要清空当前对话记录吗？"
                    description="清空后将无法恢复。"
                    okText="确认清空"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    disabled={busy || !activeConversation?.messages.length}
                    onConfirm={() => onChange(clearScriptAgentConversation(workspace))}
                >
                    <Button block type="text" danger icon={<Trash2 className="size-4" />} disabled={busy || !activeConversation?.messages.length}>
                        清空对话记录
                    </Button>
                </Popconfirm>
            </div>
        </aside>
    );
}
