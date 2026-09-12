import { create } from "zustand";

import i18n from "@/i18n";
import type { CanvasAgentOp } from "../utils/canvas-agent-ops";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; url: string; dataUrl: string };
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[] } };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentPanelTab = "chat" | "setup" | "history" | "log";
export type CanvasAgentSessionEpoch = { canvasId: string; epoch: number };
export type CanvasAgentRequestEpoch = CanvasAgentSessionEpoch & { kind: string; requestEpoch: number };

let currentSession: CanvasAgentSessionEpoch = { canvasId: "", epoch: 0 };
const requestEpochs = new Map<string, number>();

export function beginCanvasAgentSession(canvasId: string) {
    currentSession = { canvasId, epoch: currentSession.epoch + 1 };
    requestEpochs.clear();
    return currentSession;
}

export function captureCanvasAgentSession() {
    return currentSession;
}

export function isCurrentCanvasAgentSession(session: CanvasAgentSessionEpoch) {
    return session.canvasId === currentSession.canvasId && session.epoch === currentSession.epoch;
}

export function beginCanvasAgentRequest(kind: string, session = currentSession): CanvasAgentRequestEpoch {
    const requestEpoch = (requestEpochs.get(kind) || 0) + 1;
    requestEpochs.set(kind, requestEpoch);
    return { ...session, kind, requestEpoch };
}

export function isCurrentCanvasAgentRequest(request: CanvasAgentRequestEpoch) {
    return isCurrentCanvasAgentSession(request) && requestEpochs.get(request.kind) === request.requestEpoch;
}

type CanvasAgentStore = {
    width: number;
    url: string;
    token: string;
    canvasId: string;
    connected: boolean;
    enabled: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    activity: string;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    setAgentState: (patch: Partial<Omit<CanvasAgentStore, "setAgentState" | "addMessage" | "addEventLog" | "clearEventLogs">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const useCanvasAgentStore = create<CanvasAgentStore>((set) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    canvasId: "",
    connected: false,
    enabled: false,
    prompt: "",
    attachments: [],
    sending: false,
    waiting: false,
    messages: [],
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: true,
    activity: i18n.t("canvas.agent.status.ready"),
    connectError: "",
    pendingTool: null,
    setAgentState: (patch) => set(patch),
    addMessage: (item) => set((state) => ({ messages: [...state.messages.slice(-120), item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
