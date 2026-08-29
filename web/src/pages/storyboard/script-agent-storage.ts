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

export type ScriptAgentWorkspaceRecord = ScriptAgentWorkspace & {
    title: string;
    source: string;
    configDraft?: Partial<ScriptProjectConfigInput>;
    messages: ScriptAgentMessage[];
};

const WORKSPACE_KEY = "default";

function currentUserId() {
    return useUserStore.getState().user?.id || "anonymous";
}

function workspaceStore(userId = currentUserId()) {
    return localforage.createInstance({ name: "infinite-canvas", storeName: accountStoreName("script_agent_workspaces", userId) });
}

function id(prefix: string) {
    return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultScriptAgentWorkspace(): ScriptAgentWorkspaceRecord {
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
        version: 0,
        updatedAt: new Date().toISOString(),
    };
}

function safeRecord(value: unknown): ScriptAgentWorkspaceRecord | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<ScriptAgentWorkspaceRecord>;
    if (typeof record.id !== "string" || typeof record.projectId !== "string" || !record.currentStage) return null;
    return {
        ...createDefaultScriptAgentWorkspace(),
        ...record,
        title: typeof record.title === "string" ? record.title : "",
        source: typeof record.source === "string" ? record.source : "",
        messages: Array.isArray(record.messages)
            ? record.messages.filter((message): message is ScriptAgentMessage => Boolean(message && typeof message === "object" && (message as ScriptAgentMessage).role && typeof (message as ScriptAgentMessage).content === "string")).map((message) => ({
                  id: typeof message.id === "string" ? message.id : id("message"),
                  role: message.role === "user" ? "user" : "assistant",
                  content: message.content,
                  createdAt: typeof message.createdAt === "string" ? message.createdAt : new Date().toISOString(),
              }))
            : [],
    };
}

function persistedRecord(workspace: ScriptAgentWorkspaceRecord): ScriptAgentWorkspaceRecord {
    const allowedConfigKeys: (keyof ScriptProjectConfigInput)[] = ["totalEpisodes", "episodeMinutes", "startChapter", "endChapter", "chapterIndexes", "platform", "aspectRatio", "style", "paywall"];
    const configDraft = workspace.configDraft
        ? Object.fromEntries(allowedConfigKeys.flatMap((key) => (workspace.configDraft?.[key] === undefined ? [] : [[key, workspace.configDraft[key]]])))
        : undefined;
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
        version: workspace.version,
        updatedAt: workspace.updatedAt,
    };
}

export async function loadScriptAgentWorkspace(userId = currentUserId()): Promise<ScriptAgentWorkspaceRecord> {
    const stored = safeRecord(await workspaceStore(userId).getItem<unknown>(WORKSPACE_KEY));
    return stored || createDefaultScriptAgentWorkspace();
}

export async function saveScriptAgentWorkspace(userId: string | undefined, workspace: ScriptAgentWorkspaceRecord) {
    const record = persistedRecord(workspace);
    await workspaceStore(userId || currentUserId()).setItem(WORKSPACE_KEY, record);
    return record;
}

export async function clearScriptAgentWorkspace(userId = currentUserId()) {
    await workspaceStore(userId).removeItem(WORKSPACE_KEY);
}

export function appendScriptAgentMessage(workspace: ScriptAgentWorkspaceRecord, role: ScriptAgentMessage["role"], content: string): ScriptAgentWorkspaceRecord {
    const message = content.trim();
    if (!message) return workspace;
    return {
        ...workspace,
        messages: [...workspace.messages, { id: id("message"), role, content: message, createdAt: new Date().toISOString() }],
        version: workspace.version + 1,
        updatedAt: new Date().toISOString(),
    };
}
