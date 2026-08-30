import { useEffect, useState } from "react";
import { App } from "antd";
import { LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";
import { ScriptAgentSpace } from "./script-agent-space";
import { ScriptAgentStudio } from "./script-agent-studio";
import {
    createScriptAgentProject,
    deleteScriptAgentWorkspace,
    loadScriptAgentProjects,
    renameScriptAgentProject,
    saveScriptAgentProjects,
    type ScriptAgentWorkspaceRecord,
} from "./script-agent-storage";

export function ScriptAgentPage({ projectId }: { projectId?: string }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const accountId = useUserStore((state) => state.user?.id || "anonymous");
    const [projects, setProjects] = useState<ScriptAgentWorkspaceRecord[] | null>(null);

    useEffect(() => {
        let active = true;
        setProjects(null);
        void loadScriptAgentProjects(accountId)
            .then((value) => {
                if (active) setProjects(value);
            })
            .catch(() => {
                if (active) {
                    setProjects([]);
                    message.error("剧本空间加载失败");
                }
            });
        return () => {
            active = false;
        };
    }, [accountId, message]);

    const selected = projectId && projects?.find((item) => item.projectId === projectId);

    useEffect(() => {
        if (projects && projectId && !selected) navigate("/storyboard/script-agent", { replace: true });
    }, [navigate, projectId, projects, selected]);

    async function persist(next: ScriptAgentWorkspaceRecord[]) {
        setProjects(next);
        try {
            setProjects(await saveScriptAgentProjects(accountId, next));
        } catch {
            message.warning("剧本空间已更新，但保存失败");
        }
    }

    async function create(title: string, source: string) {
        const project = createScriptAgentProject(title, source);
        await persist([...(await loadScriptAgentProjects(accountId)), project]);
        navigate(`/storyboard/script-agent/${encodeURIComponent(project.projectId)}`);
    }

    function syncWorkspace(workspace: ScriptAgentWorkspaceRecord) {
        setProjects((current) => current?.map((item) => (item.projectId === workspace.projectId ? workspace : item)) || [workspace]);
    }

    if (!projects) {
        return (
            <div className="flex min-h-[420px] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在加载剧本空间…
            </div>
        );
    }

    if (selected) return <ScriptAgentStudio projectId={selected.projectId} onBack={() => navigate("/storyboard/script-agent")} onWorkspaceChange={syncWorkspace} />;

    return (
        <ScriptAgentSpace
            projects={projects}
            onCreate={create}
            onOpen={(id) => navigate(`/storyboard/script-agent/${encodeURIComponent(id)}`)}
            onRename={async (id, title) => persist(renameScriptAgentProject(await loadScriptAgentProjects(accountId), id, title))}
            onDelete={async (id) => setProjects(await deleteScriptAgentWorkspace(accountId, id))}
        />
    );
}
