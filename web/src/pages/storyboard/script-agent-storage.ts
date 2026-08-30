import localforage from "localforage";

import { accountStoreName } from "@/lib/account-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { ScriptAgentWorkspace, ScriptProjectConfigInput } from "./script-agent";

export type ScriptAgentMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
};

export type ScriptAgentConversation = {
    id: string;
    title: string;
    messages: ScriptAgentMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ScriptAgentWorkspaceRecord = ScriptAgentWorkspace & {
    title: string;
    source: string;
    configDraft?: Partial<ScriptProjectConfigInput>;
    messages: ScriptAgentMessage[];
    conversations: ScriptAgentConversation[];
    activeConversationId: string;
};

const WORKSPACE_KEY = "default";
const PROJECTS_KEY = "projects";

function currentUserId() {
    return useUserStore.getState().user?.id || "anonymous";
}

function workspaceStore(userId = currentUserId()) {
    return localforage.createInstance({ name: "infinite-canvas", storeName: accountStoreName("script_agent_workspaces", userId) });
}

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
        updatedAt: now(),
    };
}

export function createScriptAgentProject(title = "", source = ""): ScriptAgentWorkspaceRecord {
    const workspace = createDefaultScriptAgentWorkspace();
    const projectId = id("project");
    return { ...workspace, id: projectId, projectId, title: title.trim() || "未命名剧本", source: source.trim() };
}

function normalizeConversation(value: unknown): ScriptAgentConversation | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<ScriptAgentConversation>;
    if (typeof item.id !== "string") return null;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : now();
    const messages = Array.isArray(item.messages) ? normalizeMessages(item.messages) : [];
    return { id: item.id, title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "新对话", messages, createdAt, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt };
}

function normalizeMessages(value: unknown[]): ScriptAgentMessage[] {
    return value
        .filter((message): message is ScriptAgentMessage => Boolean(message && typeof message === "object" && (message as ScriptAgentMessage).role && typeof (message as ScriptAgentMessage).content === "string"))
        .map((message) => ({
            id: typeof message.id === "string" ? message.id : id("message"),
            role: message.role === "user" ? "user" : "assistant",
            content: message.content,
            createdAt: typeof message.createdAt === "string" ? message.createdAt : now(),
        }));
}

function safeRecord(value: unknown): ScriptAgentWorkspaceRecord | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<ScriptAgentWorkspaceRecord>;
    if (typeof record.id !== "string" || typeof record.projectId !== "string" || !record.currentStage) return null;
    const fallback = createDefaultScriptAgentWorkspace();
    const legacyMessages = Array.isArray(record.messages) ? normalizeMessages(record.messages) : [];
    const conversations = Array.isArray(record.conversations) ? record.conversations.map(normalizeConversation).filter((item): item is ScriptAgentConversation => Boolean(item)) : [];
    const normalizedConversations = conversations.length ? conversations : [{ ...fallback.conversations[0], messages: legacyMessages, updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt }];
    const activeConversationId = normalizedConversations.some((item) => item.id === record.activeConversationId) ? record.activeConversationId! : normalizedConversations[0].id;
    const active = normalizedConversations.find((item) => item.id === activeConversationId) || normalizedConversations[0];
    return {
        ...fallback,
        ...record,
        title: typeof record.title === "string" ? record.title : "",
        source: typeof record.source === "string" ? record.source : "",
        conversations: normalizedConversations,
        activeConversationId,
        messages: active.messages,
    };
}

function persistedRecord(workspace: ScriptAgentWorkspaceRecord): ScriptAgentWorkspaceRecord {
    const allowedConfigKeys: (keyof ScriptProjectConfigInput)[] = ["totalEpisodes", "episodeMinutes", "startChapter", "endChapter", "chapterIndexes", "platform", "aspectRatio", "style", "paywall"];
    const configDraft = workspace.configDraft ? Object.fromEntries(allowedConfigKeys.flatMap((key) => (workspace.configDraft?.[key] === undefined ? [] : [[key, workspace.configDraft[key]]]))) : undefined;
    return {
        id: workspace.id,
        projectId: workspace.projectId,
        title: workspace.title,
        source: workspace.source,
        currentStage: workspace.currentStage,
        projectConfig: workspace.projectConfig,
        configDraft,
        storySkeleton: workspace.storySkeleton,
        storySkeletonStatus: workspace.storySkeletonStatus,
        storySkeletonReview: workspace.storySkeletonReview,
        adaptationStrategy: workspace.adaptationStrategy,
        adaptationStatus: workspace.adaptationStatus,
        adaptationReview: workspace.adaptationReview,
        scripts: workspace.scripts,
        messages: workspace.messages,
        conversations: workspace.conversations,
        activeConversationId: workspace.activeConversationId,
        version: workspace.version,
        updatedAt: workspace.updatedAt,
    };
}

export async function loadScriptAgentProjects(userId = currentUserId()): Promise<ScriptAgentWorkspaceRecord[]> {
    const store = workspaceStore(userId);
    const stored = await store.getItem<unknown>(PROJECTS_KEY);
    if (Array.isArray(stored)) return stored.map(safeRecord).filter((item): item is ScriptAgentWorkspaceRecord => Boolean(item));
    const legacy = safeRecord(await store.getItem<unknown>(WORKSPACE_KEY));
    return legacy ? [legacy] : [];
}

export async function saveScriptAgentProjects(userId: string | undefined, projects: ScriptAgentWorkspaceRecord[]) {
    const store = workspaceStore(userId || currentUserId());
    const records = projects.map(persistedRecord);
    await store.setItem(PROJECTS_KEY, records);
    return records;
}

export async function loadScriptAgentWorkspace(userId = currentUserId(), projectId?: string): Promise<ScriptAgentWorkspaceRecord> {
    const projects = await loadScriptAgentProjects(userId);
    if (projectId) return projects.find((item) => item.projectId === projectId) || createScriptAgentProject();
    return projects[0] || safeRecord(await workspaceStore(userId).getItem<unknown>(WORKSPACE_KEY)) || createDefaultScriptAgentWorkspace();
}

export async function saveScriptAgentWorkspace(userId: string | undefined, workspace: ScriptAgentWorkspaceRecord) {
    const accountId = userId || currentUserId();
    const record = persistedRecord(workspace);
    const projects = await loadScriptAgentProjects(accountId);
    const next = [...projects.filter((item) => item.projectId !== record.projectId), record];
    await workspaceStore(accountId).setItem(PROJECTS_KEY, next);
    await workspaceStore(accountId).setItem(WORKSPACE_KEY, record);
    return record;
}

export async function deleteScriptAgentWorkspace(userId: string | undefined, projectId: string) {
    const accountId = userId || currentUserId();
    const projects = await loadScriptAgentProjects(accountId);
    const next = projects.filter((item) => item.projectId !== projectId);
    await workspaceStore(accountId).setItem(PROJECTS_KEY, next.map(persistedRecord));
    const current = await workspaceStore(accountId).getItem<unknown>(WORKSPACE_KEY);
    if (safeRecord(current)?.projectId === projectId) await workspaceStore(accountId).removeItem(WORKSPACE_KEY);
    return next;
}

export async function clearScriptAgentWorkspace(userId = currentUserId()) {
    await workspaceStore(userId).removeItem(WORKSPACE_KEY);
    await workspaceStore(userId).removeItem(PROJECTS_KEY);
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
    if (!active || !active.messages.length) return { ...workspace, messages: [] };
    return withWorkspaceMessage(workspace, { ...active, messages: [], updatedAt: now() });
}

export function renameScriptAgentConversation(workspace: ScriptAgentWorkspaceRecord, conversationId: string, title: string): ScriptAgentWorkspaceRecord {
    const nextTitle = title.trim();
    if (!nextTitle) return workspace;
    const conversations = workspace.conversations.map((item) => (item.id === conversationId ? { ...item, title: nextTitle, updatedAt: now() } : item));
    return { ...workspace, conversations, version: workspace.version + 1, updatedAt: now() };
}

export function renameScriptAgentProject(projects: ScriptAgentWorkspaceRecord[], projectId: string, title: string): ScriptAgentWorkspaceRecord[] {
    const nextTitle = title.trim();
    return nextTitle ? projects.map((item) => (item.projectId === projectId ? { ...item, title: nextTitle, updatedAt: now() } : item)) : projects;
}

export function deleteScriptAgentProject(projects: ScriptAgentWorkspaceRecord[], projectId: string): ScriptAgentWorkspaceRecord[] {
    return projects.filter((item) => item.projectId !== projectId);
}
