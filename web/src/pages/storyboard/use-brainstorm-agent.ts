import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    continueStoryboardBrainstormAssistant,
    createStoryboardBrainstormConversation,
    createStoryboardBrainstormTurn,
    deleteStoryboardBrainstormConversation,
    fetchStoryboardBrainstormConversations,
    fetchStoryboardBrainstormMessages,
    renameStoryboardBrainstormConversation,
    updateStoryboardBrainstormAssistant,
    type StoryboardBrainstormAssistantMessage,
    type StoryboardBrainstormConversation,
    type StoryboardBrainstormMessage,
    type StoryboardBrainstormUserMessage,
} from "@/services/api/storyboard-brainstorm";
import { useUserStore } from "@/stores/use-user-store";

import type { BrainstormAssistantStatus, BrainstormOutputItem, BrainstormToolApprovalDecision, BrainstormTurnContinuation, BrainstormTurnEvent, BrainstormTurnResult } from "./brainstorm-agent";

export type BrainstormConversation = StoryboardBrainstormConversation;
export type BrainstormAgentUserMessage = StoryboardBrainstormUserMessage;
export type BrainstormAgentAssistantMessage = StoryboardBrainstormAssistantMessage;
export type BrainstormAgentMessage = StoryboardBrainstormMessage;

export type BrainstormAgentRuntimeInput = {
    mode: "append" | "regenerate" | "continue" | "approval";
    projectId: string;
    conversation: BrainstormConversation;
    messages: BrainstormAgentMessage[];
    assistantMessage: BrainstormAgentAssistantMessage;
    decision?: BrainstormToolApprovalDecision;
    /** Same-page Runner state; after reload the injected Runtime rebuilds from persisted messages/output. */
    continuation?: BrainstormTurnContinuation;
};

export type BrainstormAgentRuntime = {
    run: (input: BrainstormAgentRuntimeInput, options: { signal: AbortSignal; onEvent: (event: BrainstormTurnEvent) => void }) => Promise<BrainstormTurnResult>;
};

export type BrainstormAgentRunState = {
    assistantMessageId: string;
    status: BrainstormAssistantStatus;
    output: BrainstormOutputItem[];
    streamedText: string;
    retrying: boolean;
    active: boolean;
    stopState: "idle" | "requested" | "confirmed" | "failed";
    error: string;
};

export type BrainstormStopState = BrainstormAgentRunState["stopState"];

type BrainstormRunControl = {
    controller: AbortController;
    stopRequested: boolean;
    finished: Promise<BrainstormStopState>;
    finish: (state: BrainstormStopState) => void;
};

export type BrainstormAgentState = {
    conversations: BrainstormConversation[];
    currentConversationId: string;
    messages: BrainstormAgentMessage[];
    messagesByConversation: Record<string, BrainstormAgentMessage[]>;
    awaitingApproval: BrainstormAgentAssistantMessage[];
    runs: Record<string, BrainstormAgentRunState>;
    isLoading: boolean;
    error: string;
    selectConversation: (conversationId: string) => Promise<void>;
    createConversation: (title?: string) => Promise<BrainstormConversation>;
    renameConversation: (conversationId: string, title: string) => Promise<BrainstormConversation>;
    deleteConversation: (conversationId: string) => Promise<void>;
    send: (content: string, parentMessageId?: string) => Promise<BrainstormAgentAssistantMessage>;
    regenerate: (assistantMessageId: string) => Promise<BrainstormAgentAssistantMessage>;
    continueAssistant: (assistantMessageId: string) => Promise<BrainstormAgentAssistantMessage>;
    retry: (assistantMessageId: string) => Promise<BrainstormAgentAssistantMessage>;
    resolveApproval: (assistantMessageId: string, decision: BrainstormToolApprovalDecision) => Promise<void>;
    stop: (conversationId?: string) => Promise<BrainstormStopState>;
};

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function createId(prefix: string) {
    return `${prefix}-${crypto.randomUUID()}`;
}

function mergeMessages(current: BrainstormAgentMessage[], additions: BrainstormAgentMessage[]) {
    const next = [...current];
    for (const message of additions) {
        const index = next.findIndex((item) => item.id === message.id);
        if (index >= 0) next[index] = message;
        else next.push(message);
    }
    return next;
}

function appendStreamedText(output: BrainstormOutputItem[], streamedText: string) {
    if (!streamedText) return output;
    const next = [...output];
    const last = next.at(-1);
    if (last?.type === "text") next[next.length - 1] = { ...last, text: last.text + streamedText };
    else next.push({ type: "text", text: streamedText });
    return next;
}

const BRAINSTORM_PAGE_SIZE = 500;

async function fetchAllConversations(projectId: string) {
    const first = await fetchStoryboardBrainstormConversations(projectId, { page: 1, pageSize: BRAINSTORM_PAGE_SIZE });
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
        const next = await fetchStoryboardBrainstormConversations(projectId, { page, pageSize: BRAINSTORM_PAGE_SIZE });
        if (!next.items.length) break;
        items.push(...next.items);
    }
    return items;
}

async function fetchAllMessages(projectId: string, conversationId: string) {
    const first = await fetchStoryboardBrainstormMessages(projectId, conversationId, { page: 1, pageSize: BRAINSTORM_PAGE_SIZE });
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
        const next = await fetchStoryboardBrainstormMessages(projectId, conversationId, { page, pageSize: BRAINSTORM_PAGE_SIZE });
        if (!next.items.length) break;
        items.push(...next.items);
    }
    return { ...first, items };
}

export function useBrainstormAgent(projectId: string, runtime: BrainstormAgentRuntime): BrainstormAgentState {
    const accountId = useUserStore((state) => state.user?.id || "");
    const generationRef = useRef(0);
    const selectionRef = useRef(0);
    const controlsRef = useRef(new Map<string, BrainstormRunControl>());
    const continuationsRef = useRef(new Map<string, BrainstormTurnContinuation>());
    const submittingRef = useRef(new Map<string, symbol>());
    const [conversations, setConversations] = useState<BrainstormConversation[]>([]);
    const [currentConversationId, setCurrentConversationId] = useState("");
    const [messagesByConversation, setMessagesByConversation] = useState<Record<string, BrainstormAgentMessage[]>>({});
    const [runs, setRuns] = useState<Record<string, BrainstormAgentRunState>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const conversationsRef = useRef(conversations);
    const messagesRef = useRef(messagesByConversation);
    conversationsRef.current = conversations;
    messagesRef.current = messagesByConversation;

    const loadConversation = useCallback(
        async (conversationId: string, generation: number, selection: number) => {
            const messagePage = await fetchAllMessages(projectId, conversationId);
            if (generationRef.current !== generation || selectionRef.current !== selection) return;
            const recovered = await Promise.all(
                (messagePage.items as BrainstormAgentMessage[]).map(async (message) => {
                    if (message.role !== "assistant" || (message.status !== "pending" && message.status !== "streaming") || controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) return message;
                    return (await updateStoryboardBrainstormAssistant(projectId, conversationId, message.id, {
                        expectedRevision: message.revision,
                        status: "interrupted",
                        output: message.output,
                    })) as BrainstormAgentAssistantMessage;
                }),
            );
            if (generationRef.current !== generation || selectionRef.current !== selection) return;
            setMessagesByConversation((current) => ({ ...current, [conversationId]: recovered }));
            setConversations((current) => current.map((item) => (item.id === conversationId ? (messagePage.conversation as BrainstormConversation) : item)));
        },
        [projectId],
    );

    useEffect(() => {
        const generation = ++generationRef.current;
        const selection = ++selectionRef.current;
        for (const control of controlsRef.current.values()) control.controller.abort();
        controlsRef.current.clear();
        continuationsRef.current.clear();
        submittingRef.current.clear();
        setConversations([]);
        setCurrentConversationId("");
        setMessagesByConversation({});
        setRuns({});
        setError("");
        if (!projectId || !accountId) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        void (async () => {
            try {
                const items = (await fetchAllConversations(projectId)) as BrainstormConversation[];
                if (generationRef.current !== generation) return;
                setConversations(items);
                const selected = items[0]?.id || "";
                setCurrentConversationId(selected);
                if (selected) await loadConversation(selected, generation, selection);
            } catch (cause) {
                if (generationRef.current === generation && selectionRef.current === selection) setError(errorMessage(cause));
            } finally {
                if (generationRef.current === generation && selectionRef.current === selection) setIsLoading(false);
            }
        })();
        return () => {
            generationRef.current += 1;
            selectionRef.current += 1;
            for (const control of controlsRef.current.values()) control.controller.abort();
        };
    }, [accountId, loadConversation, projectId]);

    const selectConversation = useCallback(
        async (conversationId: string) => {
            const generation = generationRef.current;
            const selection = ++selectionRef.current;
            setCurrentConversationId(conversationId);
            setError("");
            setIsLoading(true);
            try {
                await loadConversation(conversationId, generation, selection);
            } catch (cause) {
                if (generationRef.current === generation && selectionRef.current === selection) setError(errorMessage(cause));
            } finally {
                if (generationRef.current === generation && selectionRef.current === selection) setIsLoading(false);
            }
        },
        [loadConversation],
    );

    const launchRun = useCallback(
        (
            mode: BrainstormAgentRuntimeInput["mode"],
            conversation: BrainstormConversation,
            confirmedMessages: BrainstormAgentMessage[],
            assistantMessage: BrainstormAgentAssistantMessage,
            decision?: BrainstormToolApprovalDecision,
            continuation?: BrainstormTurnContinuation,
        ) => {
            const generation = generationRef.current;
            const controller = new AbortController();
            let finishPromise!: (state: BrainstormStopState) => void;
            const finished = new Promise<BrainstormStopState>((resolve) => {
                finishPromise = resolve;
            });
            const control: BrainstormRunControl = { controller, stopRequested: false, finished, finish: finishPromise };
            controlsRef.current.set(conversation.id, control);
            let output = mode === "approval" ? assistantMessage.output.filter((item) => !(item.type === "tool_result" && item.status === "awaiting_approval")) : [...assistantMessage.output];
            let receivedOutputEvent = false;
            let streamedText = "";
            let status = assistantMessage.status;
            let persisted = assistantMessage;
            let persistenceError: unknown;
            let persistence = Promise.resolve();
            const checkpoint = (snapshot: BrainstormOutputItem[], checkpointStatus: BrainstormAssistantStatus) => {
                persistence = persistence
                    .then(async () => {
                        if (persistenceError || generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                        persisted = (await updateStoryboardBrainstormAssistant(projectId, conversation.id, assistantMessage.id, {
                            expectedRevision: persisted.revision,
                            status: checkpointStatus,
                            output: snapshot,
                        })) as BrainstormAgentAssistantMessage;
                        if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                        setMessagesByConversation((current) => ({ ...current, [conversation.id]: mergeMessages(current[conversation.id] || [], [persisted]) }));
                    })
                    .catch((cause) => {
                        persistenceError = cause;
                        controller.abort();
                    });
            };
            setRuns((current) => ({
                ...current,
                [conversation.id]: { assistantMessageId: assistantMessage.id, status, output, streamedText, retrying: false, active: true, stopState: "idle", error: "" },
            }));
            void (async () => {
                try {
                    const result = await runtime.run(
                        { mode, projectId, conversation, messages: confirmedMessages, assistantMessage, ...(decision ? { decision } : {}), ...(continuation ? { continuation } : {}) },
                        {
                            signal: controller.signal,
                            onEvent: (event) => {
                                if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                                if (event.type === "status") status = event.status;
                                else if (event.type === "text_delta") streamedText += event.delta;
                                else if (event.type === "output_item") {
                                    receivedOutputEvent = true;
                                    output = [...output, event.item];
                                    if (event.item.type === "text") streamedText = "";
                                    else {
                                        if (event.item.type === "tool_result" && event.item.status === "awaiting_approval") status = "awaiting_approval";
                                        checkpoint([...output], status);
                                    }
                                }
                                setRuns((current) => ({
                                    ...current,
                                    [conversation.id]: {
                                        ...current[conversation.id],
                                        status,
                                        output,
                                        streamedText,
                                        retrying: event.type === "retry" ? true : current[conversation.id]?.retrying || false,
                                    },
                                }));
                            },
                        },
                    );
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    if (result.status === "awaiting_approval") continuationsRef.current.set(assistantMessage.id, result.continuation);
                    else continuationsRef.current.delete(assistantMessage.id);
                    if (result.output.length && (mode === "approval" || !receivedOutputEvent)) {
                        const includesPrevious = assistantMessage.output.every((item: BrainstormOutputItem, index: number) => JSON.stringify(result.output[index]) === JSON.stringify(item));
                        output = mode === "approval" || includesPrevious ? result.output : [...assistantMessage.output, ...result.output];
                    }
                    await persistence;
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    if (persistenceError) throw persistenceError;
                    const finalMessage = (await updateStoryboardBrainstormAssistant(projectId, conversation.id, assistantMessage.id, {
                        expectedRevision: persisted.revision,
                        status: result.status,
                        output,
                    })) as BrainstormAgentAssistantMessage;
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    setMessagesByConversation((current) => ({ ...current, [conversation.id]: mergeMessages(current[conversation.id] || [], [finalMessage]) }));
                    const stopState: BrainstormStopState = control.stopRequested ? (finalMessage.status === "cancelled" ? "confirmed" : "failed") : "idle";
                    setRuns((current) => ({
                        ...current,
                        [conversation.id]: { ...current[conversation.id], status: finalMessage.status, output: finalMessage.output, streamedText: "", active: false, stopState },
                    }));
                    control.finish(stopState);
                } catch (cause) {
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    const stopRequestedAtFailure = control.stopRequested;
                    await persistence;
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    continuationsRef.current.delete(assistantMessage.id);
                    let finalMessage = persisted;
                    let finalError = persistenceError || cause;
                    try {
                        if (persisted.status === "pending" || persisted.status === "streaming" || persisted.status === "awaiting_approval") {
                            finalMessage = (await updateStoryboardBrainstormAssistant(projectId, conversation.id, assistantMessage.id, {
                                expectedRevision: persisted.revision,
                                status: stopRequestedAtFailure ? "cancelled" : "failed",
                                output: appendStreamedText(output, streamedText),
                            })) as BrainstormAgentAssistantMessage;
                            if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                            setMessagesByConversation((current) => ({ ...current, [conversation.id]: mergeMessages(current[conversation.id] || [], [finalMessage]) }));
                        }
                    } catch (saveError) {
                        finalError = saveError;
                    }
                    const stopState: BrainstormStopState = control.stopRequested ? (stopRequestedAtFailure && finalMessage.status === "cancelled" ? "confirmed" : "failed") : "idle";
                    setError(errorMessage(finalError));
                    setRuns((current) => ({
                        ...current,
                        [conversation.id]: {
                            ...current[conversation.id],
                            status: finalMessage.status,
                            output: finalMessage.output,
                            streamedText: "",
                            active: false,
                            stopState,
                            error: errorMessage(finalError),
                        },
                    }));
                    control.finish(stopState);
                } finally {
                    control.finish(control.stopRequested ? "failed" : "idle");
                    if (controlsRef.current.get(conversation.id) === control) controlsRef.current.delete(conversation.id);
                }
            })();
        },
        [projectId, runtime],
    );

    const createConversation = useCallback(
        async (title = "") => {
            const generation = generationRef.current;
            const normalizedTitle = title.trim();
            const created = (await createStoryboardBrainstormConversation(projectId, {
                id: createId("conversation"),
                ...(normalizedTitle ? { title: normalizedTitle } : {}),
            })) as BrainstormConversation;
            if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
            selectionRef.current += 1;
            setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
            setCurrentConversationId(created.id);
            setMessagesByConversation((current) => ({ ...current, [created.id]: current[created.id] || [] }));
            return created;
        },
        [projectId],
    );

    const renameConversation = useCallback(
        async (conversationId: string, title: string) => {
            const generation = generationRef.current;
            const renamed = (await renameStoryboardBrainstormConversation(projectId, conversationId, title)) as BrainstormConversation;
            if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
            setConversations((current) => current.map((item) => (item.id === conversationId ? renamed : item)));
            return renamed;
        },
        [projectId],
    );

    const deleteConversation = useCallback(
        async (conversationId: string) => {
            if (controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) throw new Error("当前对话已有正在执行的任务");
            const generation = generationRef.current;
            await deleteStoryboardBrainstormConversation(projectId, conversationId);
            if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
            const remaining = conversationsRef.current.filter((item) => item.id !== conversationId);
            for (const message of messagesRef.current[conversationId] || []) continuationsRef.current.delete(message.id);
            setConversations(remaining);
            setMessagesByConversation((current) => {
                const next = { ...current };
                delete next[conversationId];
                return next;
            });
            setRuns((current) => {
                const next = { ...current };
                delete next[conversationId];
                return next;
            });
            if (currentConversationId === conversationId) {
                const selection = ++selectionRef.current;
                const nextId = remaining[0]?.id || "";
                setCurrentConversationId(nextId);
                if (nextId && !messagesRef.current[nextId]) await loadConversation(nextId, generation, selection);
            }
        },
        [currentConversationId, loadConversation, projectId],
    );

    const send = useCallback(
        async (content: string, parentMessageId?: string) => {
            const conversationId = currentConversationId;
            const conversation = conversationsRef.current.find((item) => item.id === conversationId);
            if (!conversation) throw new Error("请选择脑暴对话");
            if (controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) throw new Error("当前对话已有正在执行的任务");
            const submission = Symbol();
            submittingRef.current.set(conversationId, submission);
            const generation = generationRef.current;
            try {
                const turn = await createStoryboardBrainstormTurn(projectId, conversationId, {
                    mode: "append",
                    clientRequestId: createId("request"),
                    parentMessageId: parentMessageId ?? conversation.currentMessageId,
                    userMessage: { id: createId("message"), content },
                    assistantMessageId: createId("message"),
                });
                if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
                const confirmedConversation = turn.conversation as BrainstormConversation;
                const assistant = turn.assistantMessage as BrainstormAgentAssistantMessage;
                const additions = [...(turn.userMessage ? [turn.userMessage as BrainstormAgentUserMessage] : []), assistant];
                const confirmedMessages = mergeMessages(messagesRef.current[conversationId] || [], additions);
                setConversations((current) => current.map((item) => (item.id === conversationId ? confirmedConversation : item)));
                setMessagesByConversation((current) => ({ ...current, [conversationId]: mergeMessages(current[conversationId] || [], additions) }));
                launchRun("append", confirmedConversation, confirmedMessages, assistant);
                return assistant;
            } finally {
                if (submittingRef.current.get(conversationId) === submission) submittingRef.current.delete(conversationId);
            }
        },
        [currentConversationId, launchRun, projectId],
    );

    const regenerate = useCallback(
        async (assistantMessageId: string) => {
            const conversationId = currentConversationId;
            const conversation = conversationsRef.current.find((item) => item.id === conversationId);
            const target = messagesRef.current[conversationId]?.find((message): message is BrainstormAgentAssistantMessage => message.id === assistantMessageId && message.role === "assistant");
            if (!conversation || !target) throw new Error("未找到脑暴回复");
            if (controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) throw new Error("当前对话已有正在执行的任务");
            const submission = Symbol();
            submittingRef.current.set(conversationId, submission);
            const generation = generationRef.current;
            try {
                const turn = await createStoryboardBrainstormTurn(projectId, conversationId, {
                    mode: "regenerate",
                    clientRequestId: createId("request"),
                    targetMessageId: assistantMessageId,
                    assistantMessageId: createId("message"),
                });
                if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
                const confirmedConversation = turn.conversation as BrainstormConversation;
                const assistant = turn.assistantMessage as BrainstormAgentAssistantMessage;
                const confirmedMessages = mergeMessages(messagesRef.current[conversationId] || [], [assistant]);
                setConversations((current) => current.map((item) => (item.id === conversationId ? confirmedConversation : item)));
                setMessagesByConversation((current) => ({ ...current, [conversationId]: mergeMessages(current[conversationId] || [], [assistant]) }));
                launchRun("regenerate", confirmedConversation, confirmedMessages, assistant);
                return assistant;
            } finally {
                if (submittingRef.current.get(conversationId) === submission) submittingRef.current.delete(conversationId);
            }
        },
        [currentConversationId, launchRun, projectId],
    );

    const continueAssistant = useCallback(
        async (assistantMessageId: string) => {
            const conversationId = currentConversationId;
            const conversation = conversationsRef.current.find((item) => item.id === conversationId);
            const target = messagesRef.current[conversationId]?.find((message): message is BrainstormAgentAssistantMessage => message.id === assistantMessageId && message.role === "assistant");
            if (!conversation || !target) throw new Error("未找到脑暴回复");
            if (controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) throw new Error("当前对话已有正在执行的任务");
            const submission = Symbol();
            submittingRef.current.set(conversationId, submission);
            const generation = generationRef.current;
            try {
                const turn = await continueStoryboardBrainstormAssistant(projectId, conversationId, assistantMessageId, {
                    clientRequestId: createId("request"),
                    expectedRevision: target.revision,
                });
                if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
                const confirmedConversation = turn.conversation as BrainstormConversation;
                const assistant = turn.assistantMessage as BrainstormAgentAssistantMessage;
                const confirmedMessages = mergeMessages(messagesRef.current[conversationId] || [], [assistant]);
                setConversations((current) => current.map((item) => (item.id === conversationId ? confirmedConversation : item)));
                setMessagesByConversation((current) => ({ ...current, [conversationId]: mergeMessages(current[conversationId] || [], [assistant]) }));
                launchRun("continue", confirmedConversation, confirmedMessages, assistant);
                return assistant;
            } finally {
                if (submittingRef.current.get(conversationId) === submission) submittingRef.current.delete(conversationId);
            }
        },
        [currentConversationId, launchRun, projectId],
    );

    const resolveApproval = useCallback(
        async (assistantMessageId: string, decision: BrainstormToolApprovalDecision) => {
            const conversationId = currentConversationId;
            const conversation = conversationsRef.current.find((item) => item.id === conversationId);
            const assistant = messagesRef.current[conversationId]?.find((message): message is BrainstormAgentAssistantMessage => message.id === assistantMessageId && message.role === "assistant");
            if (!conversation || !assistant || assistant.status !== "awaiting_approval") throw new Error("未找到待审批的脑暴回复");
            if (controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) throw new Error("当前对话已有正在执行的任务");
            const submission = Symbol();
            submittingRef.current.set(conversationId, submission);
            const generation = generationRef.current;
            try {
                const claimed = (await updateStoryboardBrainstormAssistant(projectId, conversationId, assistantMessageId, {
                    expectedRevision: assistant.revision,
                    status: "streaming",
                    output: assistant.output,
                })) as BrainstormAgentAssistantMessage;
                if (generationRef.current !== generation) throw new Error("脑暴项目或账号已切换");
                const confirmedMessages = mergeMessages(messagesRef.current[conversationId] || [], [claimed]);
                setMessagesByConversation((current) => ({ ...current, [conversationId]: mergeMessages(current[conversationId] || [], [claimed]) }));
                launchRun("approval", conversation, confirmedMessages, claimed, decision, continuationsRef.current.get(assistantMessageId));
            } finally {
                if (submittingRef.current.get(conversationId) === submission) submittingRef.current.delete(conversationId);
            }
        },
        [currentConversationId, launchRun, projectId],
    );

    const retry = regenerate;

    const stop = useCallback(
        async (conversationId = currentConversationId) => {
            const control = controlsRef.current.get(conversationId);
            if (!control) return runs[conversationId]?.stopState || "idle";
            control.stopRequested = true;
            setRuns((current) => ({
                ...current,
                [conversationId]: { ...current[conversationId], stopState: "requested" },
            }));
            control.controller.abort();
            return control.finished;
        },
        [currentConversationId, runs],
    );

    const messages = messagesByConversation[currentConversationId] || [];
    const awaitingApproval = useMemo(() => messages.filter((message): message is BrainstormAgentAssistantMessage => message.role === "assistant" && message.status === "awaiting_approval"), [messages]);

    return {
        conversations,
        currentConversationId,
        messages,
        messagesByConversation,
        awaitingApproval,
        runs,
        isLoading,
        error,
        selectConversation,
        createConversation,
        renameConversation,
        deleteConversation,
        send,
        regenerate,
        continueAssistant,
        retry,
        resolveApproval,
        stop,
    };
}
