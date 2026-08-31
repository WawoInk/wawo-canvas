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
} from "@/services/api/storyboard-brainstorm";
import { useUserStore } from "@/stores/use-user-store";

import type { BrainstormAssistantStatus, BrainstormOutputItem, BrainstormTurnEvent, BrainstormTurnResult } from "./brainstorm-agent";

export type BrainstormConversation = {
    id: string;
    projectId: string;
    title: string;
    currentMessageId: string;
    createdAt: string;
    updatedAt: string;
};

export type BrainstormAgentUserMessage = {
    id: string;
    projectId: string;
    conversationId: string;
    parentId: string;
    role: "user";
    content: string;
    status?: never;
    output?: never;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type BrainstormAgentAssistantMessage = {
    id: string;
    projectId: string;
    conversationId: string;
    parentId: string;
    role: "assistant";
    content?: never;
    status: BrainstormAssistantStatus;
    output: BrainstormOutputItem[];
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type BrainstormAgentMessage = BrainstormAgentUserMessage | BrainstormAgentAssistantMessage;

export type BrainstormAgentRuntimeInput = {
    mode: "append" | "regenerate" | "continue" | "approval";
    projectId: string;
    conversation: BrainstormConversation;
    messages: BrainstormAgentMessage[];
    assistantMessage: BrainstormAgentAssistantMessage;
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
    send: (content: string, parentMessageId?: string) => Promise<BrainstormAgentAssistantMessage>;
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

export function useBrainstormAgent(projectId: string, runtime: BrainstormAgentRuntime): BrainstormAgentState {
    const accountId = useUserStore((state) => state.user?.id || "");
    const generationRef = useRef(0);
    const controlsRef = useRef(new Map<string, { id: string; controller: AbortController }>());
    const submittingRef = useRef(new Set<string>());
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
        async (conversationId: string, generation: number) => {
            const messagePage = await fetchStoryboardBrainstormMessages(projectId, conversationId);
            if (generationRef.current !== generation) return;
            const recovered = await Promise.all(
                (messagePage.items as BrainstormAgentMessage[]).map(async (message) => {
                    if (message.role !== "assistant" || (message.status !== "pending" && message.status !== "streaming") || controlsRef.current.has(conversationId)) return message;
                    return (await updateStoryboardBrainstormAssistant(projectId, conversationId, message.id, {
                        expectedRevision: message.revision,
                        status: "interrupted",
                        output: message.output,
                    })) as BrainstormAgentAssistantMessage;
                }),
            );
            if (generationRef.current !== generation) return;
            setMessagesByConversation((current) => ({ ...current, [conversationId]: recovered }));
            setConversations((current) => current.map((item) => (item.id === conversationId ? (messagePage.conversation as BrainstormConversation) : item)));
        },
        [projectId],
    );

    useEffect(() => {
        const generation = ++generationRef.current;
        for (const control of controlsRef.current.values()) control.controller.abort();
        controlsRef.current.clear();
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
                const page = await fetchStoryboardBrainstormConversations(projectId);
                if (generationRef.current !== generation) return;
                const items = page.items as BrainstormConversation[];
                setConversations(items);
                const selected = items[0]?.id || "";
                setCurrentConversationId(selected);
                if (selected) await loadConversation(selected, generation);
            } catch (cause) {
                if (generationRef.current === generation) setError(errorMessage(cause));
            } finally {
                if (generationRef.current === generation) setIsLoading(false);
            }
        })();
        return () => {
            generationRef.current += 1;
            for (const control of controlsRef.current.values()) control.controller.abort();
        };
    }, [accountId, loadConversation, projectId]);

    const selectConversation = useCallback(
        async (conversationId: string) => {
            const generation = generationRef.current;
            setCurrentConversationId(conversationId);
            setError("");
            setIsLoading(true);
            try {
                await loadConversation(conversationId, generation);
            } catch (cause) {
                if (generationRef.current === generation) setError(errorMessage(cause));
            } finally {
                if (generationRef.current === generation) setIsLoading(false);
            }
        },
        [loadConversation],
    );

    const launchRun = useCallback(
        (mode: BrainstormAgentRuntimeInput["mode"], conversation: BrainstormConversation, confirmedMessages: BrainstormAgentMessage[], assistantMessage: BrainstormAgentAssistantMessage) => {
            const generation = generationRef.current;
            const id = createId("run");
            const controller = new AbortController();
            const control = { id, controller };
            controlsRef.current.set(conversation.id, control);
            let output = [...assistantMessage.output];
            let streamedText = "";
            let status = assistantMessage.status;
            setRuns((current) => ({
                ...current,
                [conversation.id]: { assistantMessageId: assistantMessage.id, status, output, streamedText, retrying: false, active: true, stopState: "idle", error: "" },
            }));
            void (async () => {
                try {
                    const result = await runtime.run(
                        { mode, projectId, conversation, messages: confirmedMessages, assistantMessage },
                        {
                            signal: controller.signal,
                            onEvent: (event) => {
                                if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                                if (event.type === "status") status = event.status;
                                else if (event.type === "text_delta") streamedText += event.delta;
                                else if (event.type === "output_item") {
                                    output = [...output, event.item];
                                    if (event.item.type === "text") streamedText = "";
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
                    if (result.output.length) output = result.output;
                    const persisted = (await updateStoryboardBrainstormAssistant(projectId, conversation.id, assistantMessage.id, {
                        expectedRevision: assistantMessage.revision,
                        status: result.status,
                        output,
                    })) as BrainstormAgentAssistantMessage;
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    setMessagesByConversation((current) => ({ ...current, [conversation.id]: mergeMessages(current[conversation.id] || [], [persisted]) }));
                    setRuns((current) => ({
                        ...current,
                        [conversation.id]: { ...current[conversation.id], status: persisted.status, output: persisted.output, streamedText: "", active: false },
                    }));
                } catch (cause) {
                    if (generationRef.current !== generation || controlsRef.current.get(conversation.id) !== control) return;
                    setError(errorMessage(cause));
                    setRuns((current) => ({
                        ...current,
                        [conversation.id]: { ...current[conversation.id], active: false, error: errorMessage(cause) },
                    }));
                } finally {
                    if (controlsRef.current.get(conversation.id) === control) controlsRef.current.delete(conversation.id);
                }
            })();
        },
        [projectId, runtime],
    );

    const send = useCallback(
        async (content: string, parentMessageId?: string) => {
            const conversationId = currentConversationId;
            const conversation = conversationsRef.current.find((item) => item.id === conversationId);
            if (!conversation) throw new Error("Brainstorm conversation is not selected.");
            if (controlsRef.current.has(conversationId) || submittingRef.current.has(conversationId)) throw new Error("Conversation already has an active Turn.");
            submittingRef.current.add(conversationId);
            const generation = generationRef.current;
            try {
                const turn = await createStoryboardBrainstormTurn(projectId, conversationId, {
                    mode: "append",
                    clientRequestId: createId("request"),
                    parentMessageId: parentMessageId ?? conversation.currentMessageId,
                    userMessage: { id: createId("message"), content },
                    assistantMessageId: createId("message"),
                });
                if (generationRef.current !== generation) throw new Error("Brainstorm scope changed before the Turn was confirmed.");
                const confirmedConversation = turn.conversation as BrainstormConversation;
                const assistant = turn.assistantMessage as BrainstormAgentAssistantMessage;
                const additions = [...(turn.userMessage ? [turn.userMessage as BrainstormAgentUserMessage] : []), assistant];
                const confirmedMessages = mergeMessages(messagesRef.current[conversationId] || [], additions);
                setConversations((current) => current.map((item) => (item.id === conversationId ? confirmedConversation : item)));
                setMessagesByConversation((current) => ({ ...current, [conversationId]: mergeMessages(current[conversationId] || [], additions) }));
                launchRun("append", confirmedConversation, confirmedMessages, assistant);
                return assistant;
            } finally {
                submittingRef.current.delete(conversationId);
            }
        },
        [currentConversationId, launchRun, projectId],
    );

    const messages = messagesByConversation[currentConversationId] || [];
    const awaitingApproval = useMemo(
        () => messages.filter((message): message is BrainstormAgentAssistantMessage => message.role === "assistant" && message.status === "awaiting_approval"),
        [messages],
    );

    return { conversations, currentConversationId, messages, messagesByConversation, awaitingApproval, runs, isLoading, error, selectConversation, send };
}

void createStoryboardBrainstormConversation;
void renameStoryboardBrainstormConversation;
void deleteStoryboardBrainstormConversation;
void createStoryboardBrainstormTurn;
void continueStoryboardBrainstormAssistant;
