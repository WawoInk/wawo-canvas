import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";
import { ScriptAgentSpace } from "./script-agent-space";
import { ScriptAgentStudio } from "./script-agent-studio";
import { createScriptAgentWorkspace, deleteScriptAgentWorkspace, loadScriptAgentProjects, renameScriptAgentWorkspace, type ScriptAgentProjectSummary, type ScriptAgentWorkspaceRecord } from "./script-agent-storage";

function workspaceSummary(workspace: ScriptAgentWorkspaceRecord): ScriptAgentProjectSummary {
    return {
        id: workspace.projectId,
        projectId: workspace.projectId,
        title: workspace.title,
        source: workspace.source,
        currentStage: workspace.currentStage,
        version: workspace.version,
        revision: workspace.revision ?? 0,
        createdAt: workspace.createdAt || workspace.updatedAt,
        updatedAt: workspace.updatedAt,
    };
}

export function ScriptAgentPage({ projectId }: { projectId?: string }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const accountId = useUserStore((state) => state.user?.id || "");
    const activeAccountRef = useRef(accountId);
    const [projects, setProjects] = useState<ScriptAgentProjectSummary[] | null>(null);

    useEffect(() => {
        activeAccountRef.current = accountId;
        let active = true;
        setProjects(null);
        void loadScriptAgentProjects()
            .then((value) => {
                if (active && activeAccountRef.current === accountId) setProjects(value);
            })
            .catch(() => {
                if (active && activeAccountRef.current === accountId) {
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

    async function create(title: string, source: string) {
        try {
            const project = await createScriptAgentWorkspace(title, source);
            if (activeAccountRef.current !== accountId) return;
            setProjects((current) => [...(current || []), workspaceSummary(project)]);
            navigate(`/storyboard/script-agent/${encodeURIComponent(project.projectId)}`);
        } catch (error) {
            message.error("剧本创建失败");
            throw error;
        }
    }

    async function rename(projectId: string, title: string) {
        const project = projects?.find((item) => item.projectId === projectId);
        if (!project) return;
        try {
            const saved = await renameScriptAgentWorkspace(project, title);
            if (activeAccountRef.current === accountId) setProjects((current) => current?.map((item) => (item.projectId === projectId ? saved : item)) || []);
        } catch (error) {
            message.error("剧本重命名失败");
            throw error;
        }
    }

    async function remove(projectId: string) {
        try {
            await deleteScriptAgentWorkspace(projectId);
            if (activeAccountRef.current === accountId) setProjects((current) => current?.filter((item) => item.projectId !== projectId) || []);
        } catch (error) {
            message.error("剧本删除失败");
            throw error;
        }
    }

    function syncWorkspace(workspace: ScriptAgentWorkspaceRecord) {
        const summary = workspaceSummary(workspace);
        setProjects((current) => {
            if (!current) return [summary];
            return current.some((item) => item.projectId === workspace.projectId) ? current.map((item) => (item.projectId === workspace.projectId ? summary : item)) : [...current, summary];
        });
    }

    if (!projects) {
        return (
            <div className="flex min-h-[420px] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在加载剧本空间…
            </div>
        );
    }

    if (selected) return <ScriptAgentStudio projectId={selected.projectId} onBack={() => navigate("/storyboard/script-agent")} onWorkspaceChange={syncWorkspace} />;

    return <ScriptAgentSpace projects={projects} onCreate={create} onOpen={(id) => navigate(`/storyboard/script-agent/${encodeURIComponent(id)}`)} onRename={rename} onDelete={remove} />;
}
