import {
    createScriptProject,
    deleteScriptProject,
    fetchScriptProject,
    fetchScriptProjects,
    renameScriptProject,
    updateScriptProject,
    type ScriptProjectConversation,
    type ScriptProjectDetail,
    type ScriptProjectMessage,
    type ScriptProjectSummary,
    type ScriptProjectWorkspace,
} from "@/services/api/script-projects";
import type { ScriptAgentWorkspace, ScriptProjectConfigInput } from "./script-agent";

export type ScriptAgentMessage = ScriptProjectMessage;
export type ScriptAgentConversation = ScriptProjectConversation;
export type ScriptAgentProjectSummary = ScriptProjectSummary;
export type ScriptAgentWorkspaceRecord = ScriptAgentWorkspace & {
    title: string;
    source: string;
    configDraft?: Partial<ScriptProjectConfigInput>;
    messages: ScriptAgentMessage[];
    conversations: ScriptAgentConversation[];
    activeConversationId: string;
    revision?: number;
    createdAt?: string;
};

function id(prefix: string) {
    return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now() {
    return new Date().toISOString();
}

function createConversation(title = "新对话"): ScriptAgentConversation {
    const createdAt = now();
    return { id: id("conversation"), title: title.trim() || "新对话", messages: [], createdAt, updatedAt: createdAt };
}

export function createDefaultScriptAgentWorkspace(): ScriptAgentWorkspaceRecord {
    const createdAt = now();
    const conversation = createConversation();
    return {
        id: id("workspace"),
        projectId: "script-agent-default",
        title: "",
        source: "",
        currentStage: "collecting_config",
        projectConfig: null,
        configDraft: {},
        storySkeleton: "",
        storySkeletonStatus: "empty",
        adaptationStrategy: "",
        adaptationStatus: "empty",
        scripts: [],
        messages: [],
        conversations: [conversation],
        activeConversationId: conversation.id,
        version: 0,
        revision: 0,
        createdAt,
        updatedAt: createdAt,
    };
}

function projectSummary(project: ScriptProjectSummary): ScriptAgentProjectSummary {
    return {
        id: project.id,
        projectId: project.projectId || project.id,
        title: project.title,
        source: project.source,
        currentStage: project.currentStage,
        version: project.version,
        revision: project.revision,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

function workspaceRecord(project: ScriptProjectDetail): ScriptAgentWorkspaceRecord {
    const conversations = project.conversations.length ? project.conversations : [createConversation()];
    const activeConversationId = conversations.some((item) => item.id === project.activeConversationId) ? project.activeConversationId : conversations[0].id;
    const active = conversations.find((item) => item.id === activeConversationId) || conversations[0];
    return {
        ...project,
        projectId: project.projectId || project.id,
        conversations,
        activeConversationId,
        messages: active.messages,
    };
}

function workspacePayload(workspace: ScriptAgentWorkspaceRecord): ScriptProjectWorkspace {
    const active = workspace.conversations.find((item) => item.id === workspace.activeConversationId) || workspace.conversations[0];
    return { ...workspace, messages: active?.messages || [] };
}

export async function loadScriptAgentProjects(): Promise<ScriptAgentProjectSummary[]> {
    return (await fetchScriptProjects()).map(projectSummary);
}

export async function loadScriptAgentWorkspace(projectId: string): Promise<ScriptAgentWorkspaceRecord> {
    return workspaceRecord(await fetchScriptProject(projectId));
}

export async function createScriptAgentWorkspace(title: string, source: string): Promise<ScriptAgentWorkspaceRecord> {
    const workspace = createDefaultScriptAgentWorkspace();
    const projectId = id("project");
    return workspaceRecord(await createScriptProject({ ...workspace, id: projectId, projectId, title: title.trim() || "未命名剧本", source: source.trim() }));
}

export async function saveScriptAgentWorkspace(workspace: ScriptAgentWorkspaceRecord): Promise<ScriptAgentWorkspaceRecord> {
    return workspaceRecord(await updateScriptProject(workspace.projectId, workspacePayload(workspace), workspace.revision ?? 0));
}

export async function renameScriptAgentWorkspace(project: ScriptAgentProjectSummary, title: string): Promise<ScriptAgentProjectSummary> {
    return projectSummary(await renameScriptProject(project.projectId, title.trim(), project.revision));
}

export async function deleteScriptAgentWorkspace(projectId: string): Promise<void> {
    await deleteScriptProject(projectId);
}

export function scriptAgentConflictWorkspace(error: unknown): ScriptAgentWorkspaceRecord | null {
    if (!error || typeof error !== "object" || Number((error as { status?: number }).status) !== 409) return null;
    const current = (error as { data?: { current?: unknown } }).data?.current;
    if (!current || typeof current !== "object" || !Array.isArray((current as ScriptProjectDetail).conversations)) return null;
    return workspaceRecord(current as ScriptProjectDetail);
}

function withWorkspaceMessage(workspace: ScriptAgentWorkspaceRecord, conversation: ScriptAgentConversation, changes: Partial<ScriptAgentWorkspaceRecord> = {}): ScriptAgentWorkspaceRecord {
    return { ...workspace, ...changes, messages: conversation.messages, conversations: workspace.conversations.map((item) => (item.id === conversation.id ? conversation : item)), version: workspace.version + 1, updatedAt: now() };
}

export function appendScriptAgentMessage(workspace: ScriptAgentWorkspaceRecord, role: ScriptAgentMessage["role"], content: string): ScriptAgentWorkspaceRecord {
    const message = content.trim();
    if (!message) return workspace;
    const active = workspace.conversations.find((item) => item.id === workspace.activeConversationId) || workspace.conversations[0];
    const conversation = { ...active, messages: [...active.messages, { id: id("message"), role, content: message, createdAt: now() }], updatedAt: now() };
    return withWorkspaceMessage(workspace, conversation);
}

export function createScriptAgentConversation(workspace: ScriptAgentWorkspaceRecord, title = "新对话"): ScriptAgentWorkspaceRecord {
    const conversation = createConversation(title);
    return withWorkspaceMessage({ ...workspace, conversations: [...workspace.conversations, conversation], activeConversationId: conversation.id }, conversation);
}

export function selectScriptAgentConversation(workspace: ScriptAgentWorkspaceRecord, conversationId: string): ScriptAgentWorkspaceRecord {
    const conversation = workspace.conversations.find((item) => item.id === conversationId);
    return conversation ? { ...workspace, activeConversationId: conversation.id, messages: conversation.messages } : workspace;
}

export function clearScriptAgentConversation(workspace: ScriptAgentWorkspaceRecord): ScriptAgentWorkspaceRecord {
    const active = workspace.conversations.find((item) => item.id === workspace.activeConversationId);
    if (!active || !active.messages.length) return { ...workspace, messages: active?.messages || [] };
    return withWorkspaceMessage(workspace, { ...active, messages: [], updatedAt: now() });
}

export function renameScriptAgentConversation(workspace: ScriptAgentWorkspaceRecord, conversationId: string, title: string): ScriptAgentWorkspaceRecord {
    const nextTitle = title.trim();
    if (!nextTitle) return workspace;
    const conversations = workspace.conversations.map((item) => (item.id === conversationId ? { ...item, title: nextTitle, updatedAt: now() } : item));
    return { ...workspace, conversations, version: workspace.version + 1, updatedAt: now() };
}
