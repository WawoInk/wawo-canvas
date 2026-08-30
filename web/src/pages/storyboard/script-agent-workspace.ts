import type { ScriptItem } from "./script-agent";
import type { ScriptAgentWorkspaceRecord } from "./script-agent-storage";

type EditableArtifact = "source" | "storySkeleton" | "adaptationStrategy";

function touch(workspace: ScriptAgentWorkspaceRecord, changes: Partial<ScriptAgentWorkspaceRecord>): ScriptAgentWorkspaceRecord {
    return { ...workspace, ...changes, version: workspace.version + 1, updatedAt: new Date().toISOString() };
}

function reconcileScriptStage(workspace: ScriptAgentWorkspaceRecord, scripts: readonly ScriptItem[]) {
    const total = workspace.projectConfig?.totalEpisodes || 0;
    if (!total) return workspace.currentStage;
    const episodes = new Set(scripts.map((script) => script.episodeNumber));
    const complete = Array.from({ length: total }, (_, index) => index + 1).every((episode) => episodes.has(episode));
    const canComplete = workspace.currentStage === "ready_for_script" || workspace.currentStage === "selecting_script_batch" || workspace.currentStage === "script_batch_completed" || workspace.currentStage === "completed";
    if (complete && canComplete) return "completed";
    if (!complete && workspace.currentStage === "completed") return "ready_for_script";
    return workspace.currentStage;
}

export function saveWorkspaceArtifact(workspace: ScriptAgentWorkspaceRecord, artifact: EditableArtifact, content: string) {
    return touch(workspace, { [artifact]: content.trim() });
}

export function createWorkspaceScript(scripts: readonly ScriptItem[], name = "", content = ""): ScriptItem {
    const used = new Set(scripts.map((script) => script.episodeNumber));
    let episodeNumber = 1;
    while (used.has(episodeNumber)) episodeNumber += 1;
    return { episodeNumber, name: name.trim() || `第 ${episodeNumber} 集`, content: content.trim(), sourceChapterIndexes: [], version: 1 };
}

export function upsertWorkspaceScript(workspace: ScriptAgentWorkspaceRecord, script: ScriptItem): ScriptAgentWorkspaceRecord {
    const existing = workspace.scripts.find((item) => item.episodeNumber === script.episodeNumber);
    const next = {
        ...script,
        name: script.name.trim(),
        content: script.content.trim(),
        version: existing ? (existing.version || 0) + 1 : script.version || 1,
    };
    const scripts = [...workspace.scripts.filter((item) => item.episodeNumber !== script.episodeNumber), next].sort((a, b) => a.episodeNumber - b.episodeNumber);
    return touch(workspace, { scripts, currentStage: reconcileScriptStage(workspace, scripts) });
}

export function removeWorkspaceScript(workspace: ScriptAgentWorkspaceRecord, episodeNumber: number): ScriptAgentWorkspaceRecord {
    const scripts = workspace.scripts.filter((script) => script.episodeNumber !== episodeNumber);
    return scripts.length === workspace.scripts.length ? workspace : touch(workspace, { scripts, currentStage: reconcileScriptStage(workspace, scripts) });
}
