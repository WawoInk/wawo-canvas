import { useEffect, useMemo, useRef, useState } from "react";

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

export type BrainstormAgentState = {
    conversations: BrainstormConversation[];
    currentConversationId: string;
    messages: BrainstormAgentMessage[];
    awaitingApproval: BrainstormAgentAssistantMessage[];
    isLoading: boolean;
    error: string;
};

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function useBrainstormAgent(projectId: string, _runtime: BrainstormAgentRuntime): BrainstormAgentState {
    const accountId = useUserStore((state) => state.user?.id || "");
    const generationRef = useRef(0);
    const [conversations, setConversations] = useState<BrainstormConversation[]>([]);
    const [currentConversationId, setCurrentConversationId] = useState("");
    const [messagesByConversation, setMessagesByConversation] = useState<Record<string, BrainstormAgentMessage[]>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const generation = ++generationRef.current;
        setConversations([]);
        setCurrentConversationId("");
        setMessagesByConversation({});
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
                if (!selected) return;
                const messagePage = await fetchStoryboardBrainstormMessages(projectId, selected);
                if (generationRef.current !== generation) return;
                const recovered = await Promise.all(
                    (messagePage.items as BrainstormAgentMessage[]).map(async (message) => {
                        if (message.role !== "assistant" || (message.status !== "pending" && message.status !== "streaming")) return message;
                        return (await updateStoryboardBrainstormAssistant(projectId, selected, message.id, {
                            expectedRevision: message.revision,
                            status: "interrupted",
                            output: message.output,
                        })) as BrainstormAgentAssistantMessage;
                    }),
                );
                if (generationRef.current !== generation) return;
                setMessagesByConversation({ [selected]: recovered });
                setConversations((current) => current.map((item) => (item.id === selected ? (messagePage.conversation as BrainstormConversation) : item)));
            } catch (cause) {
                if (generationRef.current === generation) setError(errorMessage(cause));
            } finally {
                if (generationRef.current === generation) setIsLoading(false);
            }
        })();
        return () => {
            generationRef.current += 1;
        };
    }, [accountId, projectId]);

    const messages = messagesByConversation[currentConversationId] || [];
    const awaitingApproval = useMemo(
        () => messages.filter((message): message is BrainstormAgentAssistantMessage => message.role === "assistant" && message.status === "awaiting_approval"),
        [messages],
    );

    return { conversations, currentConversationId, messages, awaitingApproval, isLoading, error };
}

void createStoryboardBrainstormConversation;
void renameStoryboardBrainstormConversation;
void deleteStoryboardBrainstormConversation;
void createStoryboardBrainstormTurn;
void continueStoryboardBrainstormAssistant;
