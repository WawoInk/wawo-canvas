import { useState } from "react";
import { Button, Input, Modal, Spin } from "antd";
import { ArrowRight, FilePenLine, FilePlus2, Pencil, Trash2 } from "lucide-react";

import type { ScriptAgentProjectSummary } from "./script-agent-storage";

type ScriptAgentSpaceProps = {
    projects: ScriptAgentProjectSummary[];
    loading?: boolean;
    onCreate: (title: string, source: string) => void | Promise<void>;
    onOpen: (projectId: string) => void;
    onRename: (projectId: string, title: string) => void | Promise<void>;
    onDelete: (projectId: string) => void | Promise<void>;
};

type PendingAction = "create" | "rename" | "delete" | "";

function formatUpdatedAt(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ScriptAgentSpace({ projects, loading = false, onCreate, onOpen, onRename, onDelete }: ScriptAgentSpaceProps) {
    const [createOpen, setCreateOpen] = useState(false);
    const [createTitle, setCreateTitle] = useState("");
    const [createSource, setCreateSource] = useState("");
    const [renameProject, setRenameProject] = useState<ScriptAgentProjectSummary | null>(null);
    const [renameTitle, setRenameTitle] = useState("");
    const [deleteProject, setDeleteProject] = useState<ScriptAgentProjectSummary | null>(null);
    const [pending, setPending] = useState<PendingAction>("");

    const openCreate = () => {
        setCreateTitle("");
        setCreateSource("");
        setCreateOpen(true);
    };
    const create = async () => {
        const title = createTitle.trim();
        const source = createSource.trim();
        if (!title) return;
        setPending("create");
        try {
            await onCreate(title, source);
            setCreateOpen(false);
        } finally {
            setPending("");
        }
    };
    const rename = async () => {
        const title = renameTitle.trim();
        if (!renameProject || !title) return;
        setPending("rename");
        try {
            await onRename(renameProject.projectId, title);
            setRenameProject(null);
        } finally {
            setPending("");
        }
    };
    const remove = async () => {
        if (!deleteProject) return;
        setPending("delete");
        try {
            await onDelete(deleteProject.projectId);
            setDeleteProject(null);
        } finally {
            setPending("");
        }
    };

    return (
        <main className="min-h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
                <header className="flex flex-col gap-6 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground">剧本 AGENT</p>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight">剧本空间</h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">集中管理你的剧本项目，进入剧本后继续创作、修改与迭代。</p>
                    </div>
                    <Button type="primary" size="large" icon={<FilePlus2 className="size-4" />} onClick={openCreate}>
                        创建剧本
                    </Button>
                </header>

                {loading ? (
                    <section className="flex min-h-[360px] items-center justify-center border-b text-sm text-muted-foreground">
                        <Spin size="small" />
                        <span className="ml-3">正在加载剧本...</span>
                    </section>
                ) : projects.length === 0 ? (
                    <section className="flex min-h-[420px] flex-col items-center justify-center border-b px-6 text-center">
                        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                            <FilePenLine className="size-6" />
                        </div>
                        <h2 className="mt-6 text-xl font-medium">还没有剧本</h2>
                        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">创建第一个剧本，把原作素材、创作对话和生成内容整理在同一个长期工作空间中。</p>
                        <Button className="mt-6" onClick={openCreate}>
                            创建剧本
                        </Button>
                    </section>
                ) : (
                    <section className="grid grid-cols-1 gap-4 py-8 md:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <article key={project.projectId} className="group flex min-h-56 flex-col justify-between rounded-2xl bg-card p-5 transition hover:shadow-[0_8px_30px_rgba(1,199,253,0.12)]">
                                <div>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <h2 className="truncate text-xl font-semibold">{project.title}</h2>
                                            <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{project.source || "尚未添加原作素材"}</p>
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <Button
                                                type="text"
                                                size="small"
                                                shape="circle"
                                                icon={<Pencil className="size-4" />}
                                                aria-label={`重命名《${project.title}》`}
                                                onClick={() => {
                                                    setRenameProject(project);
                                                    setRenameTitle(project.title);
                                                }}
                                            />
                                            <Button type="text" danger size="small" shape="circle" icon={<Trash2 className="size-4" />} aria-label={`删除《${project.title}》`} onClick={() => setDeleteProject(project)} />
                                        </div>
                                    </div>
                                    <p className="mt-5 text-xs text-muted-foreground">版本 {project.version}</p>
                                </div>
                                <div className="mt-8 flex items-center justify-between gap-4 border-t pt-4">
                                    <p className="text-xs text-muted-foreground">更新于 {formatUpdatedAt(project.updatedAt)}</p>
                                    <Button type="link" className="px-0" onClick={() => onOpen(project.projectId)}>
                                        进入剧本 <ArrowRight className="ml-1 size-4" />
                                    </Button>
                                </div>
                            </article>
                        ))}
                    </section>
                )}
            </div>

            <Modal
                title="创建新剧本"
                open={createOpen}
                centered
                destroyOnHidden
                onCancel={() => setCreateOpen(false)}
                footer={
                    <>
                        <Button onClick={() => setCreateOpen(false)}>取消</Button>
                        <Button type="primary" loading={pending === "create"} disabled={!createTitle.trim()} onClick={() => void create()}>
                            创建
                        </Button>
                    </>
                }
            >
                <div className="space-y-5 pt-2">
                    <label className="block text-sm font-medium">
                        剧本名称
                        <Input className="mt-2" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如：雾城追凶" aria-label="剧本名称" autoFocus />
                    </label>
                    <label className="block text-sm font-medium">
                        原作素材（可选）
                        <Input.TextArea className="mt-2" value={createSource} onChange={(event) => setCreateSource(event.target.value)} placeholder="粘贴小说、故事梗概或创作素材" aria-label="原作素材" autoSize={{ minRows: 6, maxRows: 12 }} />
                    </label>
                </div>
            </Modal>

            <Modal
                title="重命名剧本"
                open={Boolean(renameProject)}
                centered
                destroyOnHidden
                onCancel={() => setRenameProject(null)}
                footer={
                    <>
                        <Button onClick={() => setRenameProject(null)}>取消</Button>
                        <Button type="primary" loading={pending === "rename"} disabled={!renameTitle.trim()} onClick={() => void rename()}>
                            保存
                        </Button>
                    </>
                }
            >
                <label className="block pt-2 text-sm font-medium">
                    剧本名称
                    <Input className="mt-2" value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} aria-label="剧本名称" autoFocus onPressEnter={() => void rename()} />
                </label>
            </Modal>

            <Modal
                title="删除剧本"
                open={Boolean(deleteProject)}
                centered
                onCancel={() => setDeleteProject(null)}
                footer={
                    <>
                        <Button onClick={() => setDeleteProject(null)}>取消</Button>
                        <Button danger type="primary" loading={pending === "delete"} onClick={() => void remove()}>
                            删除
                        </Button>
                    </>
                }
            >
                <p className="text-sm leading-6 text-muted-foreground">确定要删除剧本“{deleteProject?.title}”吗？剧本及其全部对话记录都会被删除，删除后将无法恢复。</p>
            </Modal>
        </main>
    );
}
